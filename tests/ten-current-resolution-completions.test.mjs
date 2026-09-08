import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { analyzeTarget } from "../src/engine/targeting.ts";
import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { applyEffect } from "../src/engine/effects.ts";
import { executeRitualSpell, executeSpellChoice, magicDetectionBlocked, revealDetectMagicAuras, resolveAttackDamage } from "../src/engine/combat-options.ts";
import { resolveDamageReductionReaction, resolvePostHitSpellChoice } from "../src/engine/responses.ts";
import { resolveTurnStartEffects } from "../src/engine/turn-effects.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/coverage.ts";

const character = (id) => BUILT_IN_CHARACTERS.find((candidate) => candidate.id === id);
function ready(id, override) {
  const source = override ?? character(id);
  const encounter = createEncounter(source, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  return { ...encounter, activeIndex: 0, selectedTargetId: encounter.combatants[1].id, map: { ...encounter.map, terrain: [] }, combatants: encounter.combatants.map((combatant, index) => ({ ...combatant, initiative: 20 - index, initiativeRolled: true, position: { x: 1 + index * 3, y: 1 }, hitPoints: { current: 50, maximum: 50 } })) };
}

const auditedWeapons = [
  ["cleira-oestwilde", "rapier"], ["surina-daardendrian", "glaive"], ["irven-weber", "quarterstaff"],
  ["pharos", "club"], ["pharos", "light-crossbow"], ["pharos", "dagger"],
];

test("six printed mastery labels are audited as not granted and do not execute riders", () => {
  for (const [characterId, attackId] of auditedWeapons) {
    const source = character(characterId);
    const attack = source.attacks.find((candidate) => candidate.id === attackId);
    assert.equal(attack.masteryOwnership, "not-granted", `${characterId}:${attackId}`);
    assert.equal(attack.mastery, undefined, `${characterId}:${attackId}`);
    const entry = buildCharacterMechanicCoverage(source).entries.find((candidate) => candidate.kind === "attack" && candidate.entityId === attackId);
    assert.equal(entry.status, "supported", `${characterId}:${attackId}`);
    const encounter = ready(characterId);
    const result = resolveAttackDamage(encounter, attack, encounter.selectedTargetId, false, () => 0, encounter.combatants[0].id);
    assert.notEqual(result.encounter.pendingResponse?.type, "weapon-mastery-choice", `${characterId}:${attackId}`);
  }
});

test("Large Form uses the nearest occupied squares for targeting", () => {
  const source = { ...character("goliath-barbarian"), level: 5 };
  let encounter = ready(source.id, source);
  encounter.combatants[1].position = { x: 4, y: 1 };
  encounter = executeFeatureAction(encounter, source.featureActions.find((feature) => feature.id === "large-form")).encounter;
  encounter.combatants[1].position = { x: 3, y: 1 };
  const analysis = analyzeTarget(encounter, encounter.combatants[1].id);
  assert.equal(analysis.distanceFeet, 5);
  assert.equal(analysis.lineOfSight, true);
});

test("Thunderwave moves unsecured objects in its cube and stops them at barriers", () => {
  const spell = character("cleira-oestwilde").spells.find((candidate) => candidate.id === "thunderwave");
  const encounter = ready("cleira-oestwilde");
  encounter.map.terrain = [
    { x: 2, y: 2, kind: "cover", label: "Loose crate", looseObject: { unsecured: true } },
    { x: 4, y: 4, kind: "wall", label: "Wall" },
  ];
  encounter.combatants[1].position = { x: 2, y: 2 };
  const result = executeSpellChoice(encounter, spell, () => 0);
  const crate = result.encounter.map.terrain.find((cell) => cell.looseObject);
  assert.deepEqual({ x: crate.x, y: crate.y }, { x: 3, y: 3 });
  assert.match(result.summary, /1 unsecured object was pushed/);
});

test("Detect Magic uses official material thresholds instead of generic cover", () => {
  const encounter = ready("cleira-oestwilde");
  const point = { x: 3, y: 1 };
  encounter.map.terrain = [{ x: 2, y: 1, kind: "wall", label: "Plate", magicBarrier: { material: "metal", thicknessInches: 0.5 } }];
  assert.equal(magicDetectionBlocked(encounter, encounter.combatants[0].id, point), false);
  encounter.map.terrain[0].magicBarrier.thicknessInches = 1;
  assert.equal(magicDetectionBlocked(encounter, encounter.combatants[0].id, point), true);
  encounter.map.terrain[0].magicBarrier = { material: "wood", thicknessInches: 11 };
  assert.equal(magicDetectionBlocked(encounter, encounter.combatants[0].id, point), false);
  encounter.map.terrain[0].magicBarrier.thicknessInches = 12;
  assert.equal(magicDetectionBlocked(encounter, encounter.combatants[0].id, point), true);
});

test("Detect Magic ritual spends ten minutes but no slot", () => {
  const source = character("cleira-oestwilde");
  const spell = source.spells.find((candidate) => candidate.id === "detect-magic");
  const encounter = createEncounter(source, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  const before = encounter.combatants[0].resources.find((resource) => resource.kind === "spell-slot").current;
  const result = executeRitualSpell(encounter, spell);
  assert.equal(result.legal, true, result.reason);
  assert.equal(result.encounter.recoveryState.elapsedMinutes, 10);
  assert.equal(result.encounter.combatants[0].resources.find((resource) => resource.kind === "spell-slot").current, before);
  assert.ok(result.encounter.effects.some((effect) => effect.name === "Detect Magic"));
});

test("Detect Magic reveals a registered spell school", () => {
  let encounter = ready("cleira-oestwilde"), id = encounter.combatants[0].id;
  encounter = applyEffect(encounter, { name: "Spell aura", description: "Fixture", magical: true, magicSchool: "evocation", sourceCombatantId: id, targetCombatantId: encounter.selectedTargetId });
  const cast = executeSpellChoice(encounter, character(id).spells.find((candidate) => candidate.id === "detect-magic"));
  const reveal = revealDetectMagicAuras({ ...cast.encounter, turn: { ...cast.encounter.turn, action: true } }, id);
  assert.match(reveal.summary, /evocation/);
});

test("Searing Smite resumes its save after a damage-reduction decision", () => {
  let encounter = ready("goliath-barbarian"), id = encounter.combatants[0].id;
  encounter = applyEffect(encounter, { name: "Searing Smite", description: "Fixture", magical: true, magicSchool: "evocation", sourceCombatantId: encounter.combatants[1].id, targetCombatantId: id, turnStartDamage: "1d6 fire", turnStartSave: { ability: "constitution", dc: 12, endsOnSuccess: true } });
  encounter = resolveTurnStartEffects(encounter, id, () => 0);
  assert.equal(encounter.pendingResponse.type, "damage-reduction-reaction");
  const resolved = resolveDamageReductionReaction(encounter, false, () => 0.99);
  assert.match(resolved.encounter.log.join(" "), /Constitution save and succeeds/i);
  assert.equal(resolved.encounter.effects.some((effect) => effect.name === "Searing Smite"), false);
});

test("Searing Smite upcasts immediate and recurring damage from the chosen slot", () => {
  let encounter = ready("irven-weber"), id = encounter.combatants[0].id;
  encounter.combatants[0].resources.push({ id: "spell-slots-2", name: "Level 2 Spell Slots", kind: "spell-slot", level: 2, current: 1, maximum: 1, recovery: "long-rest" });
  encounter.pendingResponse = { type: "post-hit-spell-choice", sourceCombatantId: id, targetCombatantId: encounter.selectedTargetId, spellId: "searing-smite", attackName: "Longsword", critical: false };
  const result = resolvePostHitSpellChoice(encounter, true, () => 0, { slotLevel: 2 });
  assert.equal(result.damageRoll.formula.diceCount, 2);
  assert.equal(result.encounter.effects.find((effect) => effect.name === "Searing Smite").turnStartDamage, "2d6 fire");
  assert.equal(result.encounter.combatants[0].resources.find((resource) => resource.level === 2).current, 0);
});

test("the ten-mechanic slice leaves only verified social and descriptive gaps", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  const sum = (key) => reports.reduce((total, report) => total + report.supportSummary[key], 0);
  assert.equal(sum("fullySupported"), 95);
  assert.equal(sum("partial"), 3);
  assert.equal(sum("descriptive"), 1);
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
});
