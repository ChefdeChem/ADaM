import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { executeFeatureAction, extendRageWithBonusAction } from "../src/engine/feature-actions.ts";
import { executeSpellChoice, revealDetectMagicAuras, resolveAttackDamage, resolveSpellDamage, validateSpellChoice } from "../src/engine/combat-options.ts";
import { abilityCheckRollMode, applyEffect, canRegainHitPoints, expireEffectsAtTurnStart, extendRage } from "../src/engine/effects.ts";
import { legalMovementDestinations } from "../src/engine/movement.ts";
import { pushTargetAway } from "../src/engine/areas.ts";
import { resolvePostHitSpellChoice } from "../src/engine/responses.ts";
import { resolveTurnStartEffects } from "../src/engine/turn-effects.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/coverage.ts";
import { elapseLightFuel } from "../src/engine/equipment-actions.ts";

const character = (id) => BUILT_IN_CHARACTERS.find((c) => c.id === id);
const spell = (id, name) => character(id).spells.find((s) => s.id === name);
function ready(id, override) {
  const e = createEncounter(override ?? character(id), generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  return { ...e, activeIndex: 0, selectedTargetId: e.combatants[1].id, map: { ...e.map, terrain: [] },
    combatants: e.combatants.map((c, i) => ({ ...c, initiative: 20-i, initiativeRolled: true, position: { x: 1+i*3, y: 1 }, hitPoints: { current: 50, maximum: 50 } })) };
}
const sequence = (...values) => () => values.shift() ?? 0;
function raging() {
  const c = character("goliath-barbarian");
  return executeFeatureAction(ready(c.id), c.featureActions.find((f) => f.id === "rage")).encounter;
}

test("Rage and Savage Attacker: either damage choice retains the same static bonus", () => {
  const e = raging(), attack = character("goliath-barbarian").attacks.find((a) => a.id === "maul");
  for (const choice of ["higher", "second"]) {
    const r = resolveAttackDamage(e, attack, e.selectedTargetId, false, sequence(0,0,0.99,0.99), e.combatants[0].id, { weaponDamageRerollChoice: choice });
    assert.equal(r.legal, true);
    assert.equal(r.roll.total, 16);
    assert.equal(r.roll.modifier, 4);
    assert.equal(r.encounter.turn.usedFeatureIds.length, 1);
  }
  const r = resolveAttackDamage(e, attack, e.selectedTargetId, true, () => 0, e.combatants[0].id, { weaponDamageRerollChoice: "second" });
  assert.equal(r.roll.total, 8, "critical doubles dice, not Rage");
});

test("Savage Attacker: unarmed and fixed damage neither reroll nor spend the use", () => {
  const e = raging();
  for (const attack of [{ id: "unarmed-strike", name: "Unarmed Strike", kind: "melee", damage: "1d4 + 2 bludgeoning", ability: "strength" }, { id: "fixed", name: "Fixed weapon", kind: "melee", damage: "3 bludgeoning" }]) {
    const state = { ...e, combatants: e.combatants.map((c,i) => i === 0 ? { ...c, attacks: [...c.attacks, attack] } : c) };
    const r = resolveAttackDamage(state, attack, e.selectedTargetId, false, () => 0, e.combatants[0].id, { weaponDamageRerollChoice: "second" });
    assert.equal(r.alternateRoll, undefined);
    assert.deepEqual(r.encounter.turn.usedFeatureIds, []);
  }
});

test("Rage: Athletics advantage cancels disadvantage and pending choices prevent extension", () => {
  const e = raging(), id = e.combatants[0].id;
  assert.equal(abilityCheckRollMode(e, id, "athletics"), "advantage");
  assert.equal(abilityCheckRollMode(e, id, "athletics", "disadvantage"), "normal");
  assert.equal(abilityCheckRollMode(e, id, "acrobatics"), "normal");
  const pending = { ...e, pendingResponse: { type: "concentration-check" }, round: 2, turn: { ...e.turn, bonusAction: true } };
  assert.equal(extendRageWithBonusAction(pending, id).legal, false);
  const later = { ...e, activeIndex: 0, effects: e.effects.map((f) => ({ ...f, sourceCombatantId: e.combatants[1].id, expiresAt: { ...f.expiresAt, round: 1 } })) };
  assert.equal(extendRage(later, later.combatants[1].id).effects[0].expiresAt.round, 1, "next turn can still occur in the current round");
});

test("2014 Lay on Hands: selecting one poison leaves the other active; blanket removal is rejected", () => {
  let e = ready("surina-daardendrian"), id = e.combatants[0].id;
  const f = character(id).featureActions.find((f) => f.id === "lay-on-hands");
  for (const name of ["Poison A", "Poison B"]) e = applyEffect(e, { name, description: "Fixture", sourceCombatantId: e.selectedTargetId, targetCombatantId: id, afflictionKind: "poison", conditionGranted: "Poisoned" });
  assert.equal(executeFeatureAction(e, f, { resourceAmount: 0, removePoisoned: true }).legal, false);
  const before = e.combatants[0].resources.find((r) => r.id === "lay-on-hands").current;
  const r = executeFeatureAction(e, f, { resourceAmount: 0, afflictionEffectIds: [e.effects[0].id, e.effects[0].id] });
  assert.equal(r.legal, true, r.reason);
  assert.deepEqual(r.encounter.effects.map((f) => f.name), ["Poison B"]);
  assert.ok(r.encounter.combatants[0].conditions.includes("Poisoned"));
  assert.equal(r.encounter.combatants[0].resources.find((r) => r.id === "lay-on-hands").current, before-5);
});

test("Detect Magic: only registered magical effects produce auras or presence", () => {
  let e = ready("cleira-oestwilde"), id = e.combatants[0].id;
  e = applyEffect(e, { name: "Rage", description: "Not magic", sourceCombatantId: id, targetCombatantId: id });
  e = applyEffect(e, { name: "Spell fixture", description: "Magic", magical: true, sourceCombatantId: id, targetCombatantId: e.selectedTargetId });
  const cast = executeSpellChoice(e, spell(id, "detect-magic"));
  assert.match(cast.summary, /Magic is present/);
  const r = revealDetectMagicAuras({ ...cast.encounter, turn: { ...cast.encounter.turn, action: true } }, id);
  assert.match(r.summary, /Spell fixture/);
  assert.doesNotMatch(r.summary, /Rage/);
  const blind = { ...cast.encounter, turn: { ...cast.encounter.turn, action: true }, combatants: cast.encounter.combatants.map((c,i) => i === 0 ? { ...c, conditions: ["blinded"] } : c) };
  assert.match(revealDetectMagicAuras(blind, id).summary, /no visible registered auras/);
});

test("Detect Magic: point aura uses its point, not its distant caster", () => {
  let e = ready("cleira-oestwilde"), id = e.combatants[0].id;
  e.combatants[1].position = { x: 11, y: 8 };
  e = applyEffect(e, { name: "Near illusion", description: "Fixture", magical: true, sourceCombatantId: e.selectedTargetId, targetCombatantId: e.selectedTargetId, points: [{ x: 2, y: 2 }] });
  const cast = executeSpellChoice(e, spell(id, "detect-magic"));
  const r = revealDetectMagicAuras({ ...cast.encounter, turn: { ...cast.encounter.turn, action: true } }, id);
  assert.match(r.summary, /Near illusion at its visible map points/);
});

test("Large Form: non-anchor difficult terrain costs extra and forced movement checks the footprint", () => {
  const c = { ...character("goliath-barbarian"), level: 5 };
  const e = executeFeatureAction(ready(c.id,c), c.featureActions.find((f) => f.id === "large-form")).encounter;
  e.map.terrain = [{ x: 1, y: 3, kind: "difficult" }];
  assert.equal(legalMovementDestinations(e).find((p) => p.x === 1 && p.y === 2).cost, 10);
  e.combatants[1].position = { x: 0, y: 1 };
  e.map.terrain = [{ x: 3, y: 2, kind: "wall" }];
  assert.strictEqual(pushTargetAway(e, e.combatants[1].id, c.id, 10), e);
});

for (const id of ["cleira-oestwilde", "pharos"]) test(`${id} Charm Person: harmful magic cannot target the charmer`, () => {
  let e = ready(id);
  e.combatants[1].creatureType = "humanoid";
  const cast = executeSpellChoice(e, spell(id, "charm-person"), () => 0);
  assert.equal(cast.legal, true, cast.reason);
  e = { ...cast.encounter, activeIndex: 1, selectedTargetId: id, turn: { ...cast.encounter.turn, action: true } };
  const harmful = { ...spell("cleira-oestwilde", "vicious-mockery"), level: 0 };
  const denied = validateSpellChoice(e, harmful);
  assert.equal(denied.legal, false);
  assert.match(denied.reason, /charmer/);
  assert.strictEqual(executeSpellChoice(e, harmful).encounter, e);
});

test("Vicious Mockery: deafness blocks the spell without spending the Action", () => {
  const e = ready("cleira-oestwilde"), s = spell("cleira-oestwilde", "vicious-mockery");
  e.combatants[1].conditions = ["Deafened"];
  const r = executeSpellChoice(e, s);
  assert.equal(r.legal, false);
  assert.match(r.reason, /cannot hear/);
  assert.strictEqual(r.encounter, e);
  e.combatants[1].conditions = [];
  assert.equal(executeSpellChoice(e, s, () => 0).legal, true);
});

test("Chill Touch: the hit still prevents healing when its damage drops the target to zero", () => {
  const e = ready("pharos"), id = e.combatants[0].id;
  e.combatants[1].side = "player";
  e.combatants[1].hitPoints.current = 1;
  const r = resolveSpellDamage(e, spell(id, "chill-touch"), e.selectedTargetId, false, () => 0);
  assert.equal(r.encounter.combatants[1].hitPoints.current, 0);
  assert.equal(canRegainHitPoints(r.encounter, e.selectedTargetId), false);
  assert.equal(canRegainHitPoints(expireEffectsAtTurnStart(r.encounter, e.round+1, id), e.selectedTargetId), true);
});

test("Searing Smite: ignition persists when damage drops the target to zero", () => {
  const e = ready("irven-weber"), id = e.combatants[0].id;
  e.combatants[1].hitPoints.current = 1;
  e.pendingResponse = { type: "post-hit-spell-choice", sourceCombatantId: id, targetCombatantId: e.selectedTargetId, spellId: "searing-smite", attackName: "Longsword", critical: false };
  const r = resolvePostHitSpellChoice(e, true, () => 0);
  assert.equal(r.encounter.combatants[1].hitPoints.current, 0);
  assert.ok(r.encounter.effects.some((f) => f.name === "Searing Smite" && f.magical));
  assert.equal(r.encounter.turn.bonusAction, false);
});

test("Searing Smite: recurring Constitution save honors disadvantage", () => {
  let e = ready("irven-weber"), id = e.combatants[1].id;
  e.combatants[1].savingThrowDisadvantages = ["constitution"];
  e = applyEffect(e, { ...spell("irven-weber", "searing-smite").effect, sourceCombatantId: e.combatants[0].id, targetCombatantId: id });
  const r = resolveTurnStartEffects(e, id, sequence(0,0.99,0));
  assert.ok(r.effects.some((f) => f.name === "Searing Smite"));
  assert.match(r.log.join(" "), /save and fails/);
});

test("coverage audit separates known gaps from executable paths", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  const sum = (key) => reports.reduce((n,r) => n+r.supportSummary[key],0);
  assert.equal(sum("fullySupported"), 85);
  assert.equal(sum("partial"), 13);
  assert.equal(sum("descriptive"), 1);
  assert.equal(reports.reduce((n,r) => n+r.total,0), 99);
});

test("supporting inventory regression: elapsed time leaves non-light items intact", () => {
  const e = ready("pharos");
  const r = elapseLightFuel(e, 1);
  const ordinary = e.combatants[0].inventory.filter((item) => !item.lightSource);
  assert.ok(ordinary.length > 0);
  for (const item of ordinary) assert.deepEqual(r.combatants[0].inventory.find((i) => i.id === item.id), item);
});
