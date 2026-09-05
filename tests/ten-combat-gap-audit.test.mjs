import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { goliathBarbarian } from "../src/characters/verified-pdf-characters.ts";
import { executeSpellChoice, revealDetectMagicAuras, resolveAttackDamage, resolveAttackRoll } from "../src/engine/combat-options.ts";
import { abilityCheckRollMode, applyEffect, occupiedCells, outgoingAttackRollMode, removeEffect, savingThrowRollMode } from "../src/engine/effects.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executeFeatureAction, extendRageWithBonusAction, validateFeatureAction } from "../src/engine/feature-actions.ts";
import { resolvePostHitSpellChoice, resolveWeaponMasteryChoice } from "../src/engine/responses.ts";
import { resolveTurnStartEffects } from "../src/engine/turn-effects.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/coverage.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

const character = (id) => BUILT_IN_CHARACTERS.find((candidate) => candidate.id === id);

function ready(id, override) {
  const source = override ?? character(id);
  const encounter = createEncounter(source, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  return {
    ...encounter,
    activeIndex: 0,
    selectedTargetId: encounter.combatants[1].id,
    map: { ...encounter.map, terrain: [] },
    combatants: encounter.combatants.map((combatant, index) => ({
      ...combatant,
      initiative: 20 - index,
      initiativeRolled: true,
      position: { x: 1 + index, y: 1 },
    })),
  };
}

test("Rage applies Strength benefits, extends, adds damage, and rejects Heavy armor", () => {
  const feature = goliathBarbarian.featureActions.find((candidate) => candidate.id === "rage");
  const started = executeFeatureAction(ready("goliath-barbarian"), feature);
  assert.equal(started.legal, true, started.reason);
  assert.equal(abilityCheckRollMode(started.encounter, goliathBarbarian.id, "strength"), "advantage");
  assert.equal(savingThrowRollMode(started.encounter, goliathBarbarian.id, undefined, "normal", "strength"), "advantage");
  const maul = goliathBarbarian.attacks.find((attack) => attack.id === "maul");
  const damage = resolveAttackDamage(started.encounter, maul, started.encounter.combatants[1].id, false, () => 0, goliathBarbarian.id);
  assert.equal(damage.legal, true);
  assert.equal(damage.roll.total, 6);
  const nextTurn = { ...started.encounter, round: 2, turn: { ...started.encounter.turn, bonusAction: true } };
  const extended = extendRageWithBonusAction(nextTurn, goliathBarbarian.id);
  assert.equal(extended.legal, true, extended.reason);
  assert.equal(extended.encounter.effects.find((effect) => effect.name === "Rage").expiresAt.round, 3);
  const heavy = ready("goliath-barbarian");
  heavy.combatants[0] = { ...heavy.combatants[0], armorCategory: "heavy" };
  assert.match(validateFeatureAction(heavy, feature).reason, /Heavy armor/);
});

test("2014 Lay on Hands removes multiple registered diseases or poisons for 5 points each", () => {
  const feature = character("surina-daardendrian").featureActions.find((candidate) => candidate.id === "lay-on-hands");
  let encounter = ready("surina-daardendrian");
  encounter.combatants[0] = {
    ...encounter.combatants[0],
    resources: encounter.combatants[0].resources.map((resource) => resource.id === "lay-on-hands" ? { ...resource, current: 10, maximum: 10 } : resource),
  };
  encounter = applyEffect(encounter, { name: "Registered disease", description: "Fixture", sourceCombatantId: encounter.combatants[1].id, targetCombatantId: encounter.combatants[0].id, afflictionKind: "disease" });
  encounter = applyEffect(encounter, { name: "Registered poison", description: "Fixture", sourceCombatantId: encounter.combatants[1].id, targetCombatantId: encounter.combatants[0].id, conditionGranted: "Poisoned", afflictionKind: "poison" });
  const afflictionEffectIds = encounter.effects.filter((effect) => effect.afflictionKind).map((effect) => effect.id);
  const result = executeFeatureAction(encounter, feature, { resourceAmount: 0, afflictionEffectIds });
  assert.equal(result.legal, true, result.reason);
  assert.equal(result.encounter.effects.some((effect) => effect.afflictionKind), false);
  assert.equal(result.encounter.combatants[0].conditions.includes("Poisoned"), false);
  assert.equal(result.encounter.combatants[0].resources.find((resource) => resource.id === "lay-on-hands").current, 0);
});

test("Detect Magic spends an Action to reveal visible registered auras within 30 feet", () => {
  const spell = character("cleira-oestwilde").spells.find((candidate) => candidate.id === "detect-magic");
  const encounter = ready("cleira-oestwilde");
  encounter.map = { ...encounter.map, terrain: [
    { x: 1, y: 2, kind: "cover", magicAura: "evocation" },
    { x: 2, y: 1, kind: "wall" },
    { x: 3, y: 1, kind: "cover", magicAura: "illusion" },
  ] };
  const cast = executeSpellChoice(encounter, spell, () => 0.5);
  assert.equal(cast.legal, true, cast.reason);
  const reveal = revealDetectMagicAuras({ ...cast.encounter, turn: { ...cast.encounter.turn, action: true } }, encounter.combatants[0].id);
  assert.equal(reveal.legal, true, reveal.reason);
  assert.match(reveal.summary, /evocation/i);
  assert.doesNotMatch(reveal.summary, /illusion/i);
  assert.equal(reveal.encounter.turn.action, false);
});

test("Thunderwave resolves its cube, push, loose-object notice, and 300-foot boom", () => {
  const spell = character("cleira-oestwilde").spells.find((candidate) => candidate.id === "thunderwave");
  const encounter = ready("cleira-oestwilde");
  const targetId = encounter.combatants[1].id;
  const result = executeSpellChoice(encounter, spell, () => 0);
  assert.equal(result.legal, true, result.reason);
  assert.match(result.summary, /unsecured objects/i);
  assert.match(result.summary, /audible to 300 feet/i);
  assert.equal(result.encounter.combatants.find((combatant) => combatant.id === targetId).position.x, 4);
});

test("Large Form requires space, occupies four cells, and can end without an action", () => {
  const levelFive = { ...goliathBarbarian, level: 5 };
  const feature = levelFive.featureActions.find((candidate) => candidate.id === "large-form");
  const open = ready(levelFive.id, levelFive);
  open.combatants[1] = { ...open.combatants[1], position: { x: 4, y: 1 } };
  const result = executeFeatureAction(open, feature);
  assert.equal(result.legal, true, result.reason);
  assert.equal(occupiedCells(result.encounter, levelFive.id).length, 4);
  const effect = result.encounter.effects.find((candidate) => candidate.name === "Large Form");
  const ended = removeEffect(result.encounter, effect.id, "player choice");
  assert.equal(occupiedCells(ended, levelFive.id).length, 1);
  assert.deepEqual(ended.turn, result.encounter.turn);
  const blocked = ready(levelFive.id, levelFive);
  blocked.map = { ...blocked.map, terrain: [{ x: 1, y: 2, kind: "wall" }] };
  assert.match(validateFeatureAction(blocked, feature).reason, /10-foot-by-10-foot/);
});

test("the Goliath Maul Topple mastery forces its registered save and can apply Prone", () => {
  const encounter = ready("goliath-barbarian");
  const attack = goliathBarbarian.attacks.find((candidate) => candidate.id === "maul");
  const damage = resolveAttackDamage(encounter, attack, encounter.combatants[1].id, false, () => 0, goliathBarbarian.id);
  assert.equal(damage.legal, true);
  assert.equal(damage.encounter.pendingResponse?.mastery, "topple");
  assert.equal(damage.encounter.pendingResponse?.saveDc, 12);
  const toppled = resolveWeaponMasteryChoice(damage.encounter, true, () => 0);
  assert.ok(toppled.encounter.combatants[1].conditions.includes("prone"));
});

test("the Goliath Spear Sap mastery applies disadvantage to the target's next attack", () => {
  const encounter = ready("goliath-barbarian");
  const attack = goliathBarbarian.attacks.find((candidate) => candidate.id === "spear");
  const result = resolveAttackRoll(encounter, attack, () => 0.99);
  assert.equal(result.legal, true);
  assert.equal(result.hit, true);
  assert.equal(outgoingAttackRollMode(result.encounter, encounter.combatants[1].id, goliathBarbarian.id), "disadvantage");
});

for (const id of ["cleira-oestwilde", "pharos"]) test(`${id} Charm Person reveals its source after the caster harms the target`, () => {
  const spell = character(id).spells.find((candidate) => candidate.id === "charm-person");
  const encounter = ready(id);
  const targetId = encounter.combatants[1].id;
  const cast = executeSpellChoice(encounter, spell, () => 0);
  assert.equal(cast.legal, true, cast.reason);
  assert.ok(cast.encounter.effects.some((effect) => effect.name === "Charm Person"));
  const ended = resolveAttackDamage(cast.encounter, { id: "fixture", name: "Fixture", kind: "melee", attackBonus: 0, damage: "1 bludgeoning", normalRangeFeet: 5 }, targetId, false, () => 0.5, id);
  assert.equal(ended.legal, true);
  assert.equal(ended.encounter.effects.some((effect) => effect.name === "Charm Person"), false);
  assert.ok(ended.encounter.combatants.find((combatant) => combatant.id === targetId).knownCharmSources.includes(id));
});

test("Searing Smite recurring damage queues concentration after the target's start-of-turn save", () => {
  const encounter = ready("irven-weber");
  const spell = character("irven-weber").spells.find((candidate) => candidate.id === "searing-smite");
  const attack = character("irven-weber").attacks.find((candidate) => candidate.id === "longsword");
  const hit = resolveAttackRoll(encounter, attack, () => 0.99);
  assert.equal(hit.legal, true);
  const smite = resolvePostHitSpellChoice(hit.encounter, true, () => 0);
  assert.ok(smite.encounter.effects.some((effect) => effect.name === "Searing Smite"));

  let targeted = applyEffect(ready("irven-weber"), { name: "Concentration fixture", description: "Fixture", sourceCombatantId: "irven-weber", targetCombatantId: "irven-weber", concentration: true });
  targeted = applyEffect(targeted, { ...spell.effect, sourceCombatantId: targeted.combatants[1].id, targetCombatantId: "irven-weber", durationRounds: spell.durationRounds });
  const started = resolveTurnStartEffects(targeted, "irven-weber", () => 0);
  assert.equal(started.pendingResponse?.type, "concentration-check");
  assert.match(started.log.join(" "), /Searing Smite.*Constitution save/i);
});

test("the audited registry remains 99 entries with disjoint support counts", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  const sum = (key) => reports.reduce((total, report) => total + report.supportSummary[key], 0);
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(sum("fullySupported"), 89);
  assert.equal(sum("partial"), 9);
  assert.equal(sum("descriptive"), 1);
  assert.equal(sum("needsReview"), 0);
});
