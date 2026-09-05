import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { createEncounter, endTurn } from "../src/engine/encounter.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { applyEffect, endConcentration, canMaintainConcentration, canCastSpells, outgoingAttackRollMode, abilityCheckRollMode } from "../src/engine/effects.ts";
import { applyDamageToCombatant, executeSpellChoice, validateSpellAvailability } from "../src/engine/combat-options.ts";
import { executePointSpell } from "../src/engine/point-effects.ts";
import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { queueConcentrationCheck } from "../src/engine/defensive-responses.ts";
import { resolveConcentrationResponse } from "../src/engine/responses.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/coverage.ts";

const character = (id) => BUILT_IN_CHARACTERS.find((c) => c.id === id);
function ready(id) {
  const c = character(id);
  const s = createEncounter(c, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  return { ...s, activeIndex: 0, combatants: s.combatants.map((a, i) => ({ ...a, initiativeRolled: true, initiative: 20 - i, position: { x: 1 + i, y: 1 } })) };
}
const actor = (s) => s.combatants[0];
const seven = [
  ["cleira-oestwilde", "dancing-lights"], ["cleira-oestwilde", "detect-magic"],
  ["irven-weber", "heroism"], ["irven-weber", "create-bonfire"],
  ["pharos", "true-strike"], ["pharos", "guidance"], ["pharos", "expeditious-retreat"],
];

for (const [id, spellId] of seven) test(`${id}: ${spellId} stops on incapacitation, death, or voluntary release`, () => {
  const s = ready(id);
  const spell = character(id).spells.find((v) => v.id === spellId);
  s.selectedTargetId = spell.targetSide === "hostile" ? s.combatants[1].id : id;
  const cast = spell.target === "point"
    ? executePointSpell(s, spell, [{ x: 1, y: 2 }], () => 0.5)
    : executeSpellChoice(s, spell, () => 0.5);
  assert.equal(cast.legal, true, cast.reason);
  assert.ok(cast.encounter.effects.some((e) => e.concentration && e.sourceCombatantId === id));
  const released = endConcentration(cast.encounter, id, "player choice");
  assert.equal(released.effects.some((e) => e.concentration && e.sourceCombatantId === id), false);
  assert.deepEqual(released.turn, cast.encounter.turn);
  assert.deepEqual(actor(released).resources, actor(cast.encounter).resources);
  for (const condition of ["incapacitated", "stunned", "paralyzed", "petrified", "unconscious"]) {
    const disabled = applyEffect(cast.encounter, { name: "Condition fixture", description: "Test", sourceCombatantId: s.combatants[1].id, targetCombatantId: id, conditionGranted: condition });
    assert.equal(canMaintainConcentration(disabled, id), false);
    assert.equal(disabled.effects.some((e) => e.concentration && e.sourceCombatantId === id), false, condition);
    assert.equal(validateSpellAvailability({ ...disabled, turn: { ...disabled.turn, action: true, bonusAction: true } }, spell).legal, false);
  }
  const defeated = applyDamageToCombatant(cast.encounter, id, 10000, { allowDamageReduction: false });
  assert.equal(defeated.effects.some((e) => e.concentration && e.sourceCombatantId === id), false);
});

test("Rage ends concentration, prohibits spells, and ends on incapacitation", () => {
  const id = "goliath-barbarian";
  const s = ready(id);
  const concentration = applyEffect(s, { name: "Borrowed concentration fixture", description: "Test", sourceCombatantId: id, targetCombatantId: id, concentration: true });
  const rage = character(id).featureActions.find((f) => f.id === "rage");
  const result = executeFeatureAction(concentration, rage);
  assert.equal(result.legal, true);
  assert.equal(result.encounter.effects.some((e) => e.concentration), false);
  assert.equal(canCastSpells(result.encounter, id), false);
  const rejected = applyEffect(result.encounter, { name: "New concentration", description: "Test", sourceCombatantId: id, targetCombatantId: id, concentration: true });
  assert.strictEqual(rejected, result.encounter);
  const stunned = applyEffect(result.encounter, { name: "Stun", description: "Test", sourceCombatantId: s.combatants[1].id, targetCombatantId: id, conditionGranted: "stunned" });
  assert.equal(stunned.effects.some((e) => e.name === "Rage"), false);
  assert.equal(executeFeatureAction({ ...stunned, turn: { ...stunned.turn, bonusAction: true } }, rage).legal, false);
});

test("2014 Lay on Hands excludes undead and constructs before spending resources", () => {
  const id = "surina-daardendrian";
  const f = character(id).featureActions.find((v) => v.id === "lay-on-hands");
  for (const type of ["undead", "construct"]) {
    const s = ready(id);
    s.combatants[0] = { ...actor(s), creatureType: type, hitPoints: { current: 1, maximum: 12 } };
    const result = executeFeatureAction(s, f, { resourceAmount: 1 });
    assert.equal(result.legal, false);
    assert.match(result.reason, /no effect/);
    assert.strictEqual(result.encounter, s);
  }
});

test("2024 Lay on Hands removes Poisoned at full HP and while healing is blocked", () => {
  const id = "irven-weber";
  const f = character(id).featureActions.find((v) => v.id === "lay-on-hands");
  let s = ready(id);
  s = applyEffect(s, { name: "Poison", description: "Test", sourceCombatantId: s.combatants[1].id, targetCombatantId: id, conditionGranted: "Poisoned", turnStartDamage: "1 poison" });
  s = applyEffect(s, { name: "Healing block", description: "Test", sourceCombatantId: s.combatants[1].id, targetCombatantId: id, modifiers: { healingPrevented: true } });
  const result = executeFeatureAction(s, f, { resourceAmount: 0, removePoisoned: true });
  assert.equal(result.legal, true, result.reason);
  assert.equal(outgoingAttackRollMode(s, id), "disadvantage");
  assert.equal(abilityCheckRollMode(s, id, "strength"), "disadvantage");
  assert.equal(outgoingAttackRollMode(result.encounter, id), "normal");
  assert.equal(abilityCheckRollMode(result.encounter, id, "strength"), "normal");
  assert.equal(actor(result.encounter).conditions.includes("Poisoned"), false);
  assert.equal(result.encounter.effects.some((e) => e.name === "Poison"), false);
  assert.ok(result.encounter.effects.some((e) => e.name === "Healing block"));
  assert.deepEqual(actor(result.encounter).hitPoints, actor(s).hitPoints);
  assert.equal(actor(result.encounter).resources.find((r) => r.name === f.resourceName).current, 0);
  assert.equal(result.encounter.turn.action, true);
  assert.equal(result.encounter.turn.bonusAction, false);
  assert.strictEqual(executeFeatureAction(s, f, { resourceAmount: 1, removePoisoned: true }).encounter, s);
});

test("2024 Lay on Hands combines healing and removal; insufficient points and stale targets spend nothing", () => {
  const id = "irven-weber";
  const f = character(id).featureActions[0];
  const s = ready(id);
  s.combatants[0] = { ...actor(s), creatureType: "construct", conditions: ["poisoned"], hitPoints: { current: 0, maximum: 12 }, deathSaves: { successes: 1, failures: 1 } };
  // Another conscious Paladin applies the same feature to the downed target.
  const healer = { ...actor(s), id: "healer", conditions: [], hitPoints: { current: 12, maximum: 12 }, position: { x: 1, y: 2 }, resources: actor(s).resources.map((r) => ({ ...r, current: 10, maximum: 10 })) };
  s.combatants.push(healer); s.activeIndex = s.combatants.length - 1;
  const result = executeFeatureAction(s, f, { targetCombatantId: id, resourceAmount: 3, removePoisoned: true });
  assert.equal(result.legal, true, result.reason);
  assert.equal(actor(result.encounter).hitPoints.current, 3);
  assert.deepEqual(actor(result.encounter).deathSaves, { successes: 0, failures: 0 });
  assert.equal(result.encounter.combatants.at(-1).resources.find((r) => r.name === f.resourceName).current, 2);
  for (const options of [{ targetCombatantId: "missing", resourceAmount: 0, removePoisoned: true }, { targetCombatantId: id, resourceAmount: 6, removePoisoned: true }]) {
    assert.strictEqual(executeFeatureAction(s, f, options).encounter, s);
  }
});

test("ending concentration during its pending save avoids a roll and preserves the turn", () => {
  const id = "pharos";
  const s = applyEffect(ready(id), { name: "Guidance", description: "Test", sourceCombatantId: id, targetCombatantId: id, concentration: true });
  const pending = queueConcentrationCheck(s, id, 8);
  const released = endConcentration(pending, id, "voluntary");
  const resolved = resolveConcentrationResponse(released, () => { throw new Error("No roll should occur"); });
  assert.equal(resolved.playerRoll, null);
  assert.equal(resolved.encounter.pendingResponse, null);
  assert.deepEqual(resolved.encounter.turn, s.turn);
});

test("concentration DC follows the caster edition, and persisted incapacitation is cleaned before a turn", () => {
  for (const [id, dc] of [["pharos", 40], ["irven-weber", 30]]) {
    const s = applyEffect(ready(id), { name: "Concentration", description: "Test", sourceCombatantId: id, targetCombatantId: id, concentration: true });
    assert.equal(queueConcentrationCheck(s, id, 80).pendingResponse.dc, dc);
    s.combatants[0] = { ...actor(s), conditions: ["stunned"] };
    assert.equal(endTurn(s).effects.some((e) => e.concentration), false);
  }
});

test("coverage distinguishes descriptive Control Flames and keeps unfinished mechanics partial", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  const sum = (key) => reports.reduce((n, r) => n + r.supportSummary[key], 0);
  assert.equal(sum("fullySupported"), 84);
  assert.equal(sum("partial"), 14);
  assert.equal(sum("descriptive"), 1);
  assert.equal(sum("needsReview"), 0);
  assert.equal(reports.reduce((n, r) => n + r.total, 0), 99);
  const rage = reports.flatMap((r) => r.entries).find((e) => e.kind === "feature" && e.entityId === "rage");
  assert.equal(rage.status, "partial");
  assert.match(rage.missingCapabilities.join(" "), /duration extension/);
});
