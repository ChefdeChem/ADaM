import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { irvenWeber, pharos } from "../src/characters/verified-pdf-characters.ts";
import { consumeAction, visibleActionsForMode } from "../src/engine/actions.ts";
import { executeSpellChoice, resolveAttackRoll, resolveSpellAttackRoll, resolveSpellDamage, validateSpellAvailability } from "../src/engine/combat-options.ts";
import { canRegainHitPoints, endConcentration, outgoingAttackRollMode } from "../src/engine/effects.ts";
import { createEncounter, endTurn } from "../src/engine/encounter.ts";
import { validateFeatureAction } from "../src/engine/feature-actions.ts";
import { resolvePostHitSpellChoice } from "../src/engine/responses.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter(character) {
  const state = createEncounter(character, generateScriptedScenario({
    prompt: "A clear training yard",
    environment: "market",
    objective: "defeat",
    difficulty: "easy",
  }));
  const enemy = state.combatants.find((combatant) => combatant.side === "enemy");
  return {
    ...state,
    activeIndex: 0,
    selectedTargetId: enemy.id,
    combatants: state.combatants.map((combatant) => ({
      ...combatant,
      hitPoints: combatant.side === "enemy" ? { current: 40, maximum: 40 } : combatant.hitPoints,
      initiative: combatant.side === "player" ? 20 : 10,
      initiativeRolled: true,
      position: combatant.side === "player" ? { x: 1, y: 1 } : { x: 2, y: 1 },
    })),
  };
}

function sequence(...values) {
  return () => values.shift() ?? 0;
}

function nextPlayerTurn(encounter, random = () => 0.5) {
  return endTurn(endTurn(encounter, random), random);
}

test("the five spells add five executable official entries without changing the registry size", () => {
  const reports = BUILT_IN_CHARACTERS.map((character) => buildCharacterMechanicCoverage(character));
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(reports.reduce((total, report) => total + report.executable, 0), 60);
  const entries = reports.flatMap((report) => report.entries).filter((entry) =>
    ["chill-touch", "true-strike", "expeditious-retreat", "heroism", "searing-smite"].includes(entry.entityId));
  assert.equal(entries.length, 5);
  assert.ok(entries.every((entry) => entry.status === "supported" && entry.executable));
  assert.deepEqual(entries.map((entry) => entry.sourceId).sort(), ["srd-5.1", "srd-5.1", "srd-5.1", "srd-5.2.1", "srd-5.2.1"]);
});

test("Chill Touch applies healing prevention and its undead rider only after a hit", () => {
  const state = readyEncounter(pharos);
  const enemyId = state.selectedTargetId;
  const undead = { ...state, combatants: state.combatants.map((combatant) => combatant.id === enemyId ? { ...combatant, creatureType: "undead" } : combatant) };
  const spell = pharos.spells.find((candidate) => candidate.id === "chill-touch");
  const attack = resolveSpellAttackRoll(undead, spell, () => 0.6);
  assert.equal(attack.legal, true);
  assert.equal(attack.hit, true);
  const damage = resolveSpellDamage(attack.encounter, spell, enemyId, false, () => 0);
  assert.equal(damage.legal, true);
  assert.equal(canRegainHitPoints(damage.encounter, enemyId), false);
  assert.equal(outgoingAttackRollMode(damage.encounter, enemyId, pharos.id), "disadvantage");
  assert.equal(outgoingAttackRollMode(damage.encounter, enemyId, "someone-else"), "normal");
  assert.equal(damage.encounter.effects.filter((effect) => effect.name.startsWith("Chill Touch")).length, 2);
});

test("Chill Touch healing prevention blocks healing actions and expires before its undead rider", () => {
  const state = readyEncounter(pharos);
  const enemyId = state.selectedTargetId;
  const spell = pharos.spells.find((candidate) => candidate.id === "chill-touch");
  const attack = resolveSpellAttackRoll({ ...state, combatants: state.combatants.map((combatant) => combatant.id === enemyId ? { ...combatant, creatureType: "undead" } : combatant) }, spell, () => 0.6);
  const damaged = resolveSpellDamage(attack.encounter, spell, enemyId, false, () => 0).encounter;
  const atCasterStart = nextPlayerTurn(damaged);
  assert.equal(canRegainHitPoints(atCasterStart, enemyId), true);
  assert.equal(outgoingAttackRollMode(atCasterStart, enemyId, pharos.id), "disadvantage");
  const afterCasterEnd = endTurn(atCasterStart);
  assert.equal(outgoingAttackRollMode(afterCasterEnd, enemyId, pharos.id), "normal");

  const selfBlocked = { ...readyEncounter(irvenWeber), effects: [{
    id: "blocked-healing", name: "Blocked Healing", description: "No healing", sourceCombatantId: enemyId,
    targetCombatantId: irvenWeber.id, concentration: false, modifiers: { healingPrevented: true },
  }], combatants: readyEncounter(irvenWeber).combatants.map((combatant) => combatant.id === irvenWeber.id ? { ...combatant, hitPoints: { ...combatant.hitPoints, current: 5 } } : combatant) };
  const layOnHands = irvenWeber.featureActions.find((feature) => feature.id === "lay-on-hands");
  assert.match(validateFeatureAction(selfBlocked, layOnHands, { resourceAmount: 1, targetCombatantId: irvenWeber.id }).reason, /cannot regain/i);
});

test("True Strike waits for the caster's next turn and only benefits the chosen target", () => {
  const state = readyEncounter(pharos);
  const enemyId = state.selectedTargetId;
  const spell = pharos.spells.find((candidate) => candidate.id === "true-strike");
  const cast = executeSpellChoice(state, spell);
  assert.equal(cast.legal, true);
  assert.equal(outgoingAttackRollMode(cast.encounter, pharos.id, enemyId), "normal");
  assert.equal(outgoingAttackRollMode(nextPlayerTurn(cast.encounter), pharos.id, enemyId), "advantage");
  assert.equal(outgoingAttackRollMode(nextPlayerTurn(cast.encounter), pharos.id, "other-target"), "normal");

  const ready = { ...nextPlayerTurn(cast.encounter), selectedTargetId: enemyId };
  const dagger = pharos.attacks.find((attack) => attack.id === "dagger");
  const attack = resolveAttackRoll(ready, dagger, sequence(0, 0.99));
  assert.deepEqual(attack.roll.rolls, [1, 20]);
  assert.equal(attack.roll.kept, 20);
  assert.equal(attack.encounter.effects.some((effect) => effect.name === "True Strike"), false);
});

test("Expeditious Retreat dashes on cast and grants a recurring Bonus Action Dash", () => {
  const state = readyEncounter(pharos);
  const spell = pharos.spells.find((candidate) => candidate.id === "expeditious-retreat");
  const cast = executeSpellChoice(state, spell);
  assert.equal(cast.legal, true);
  assert.equal(cast.encounter.turn.movementRemaining, 60);
  assert.equal(cast.encounter.turn.bonusAction, false);
  const nextTurn = nextPlayerTurn(cast.encounter);
  const dash = visibleActionsForMode(pharos, "dnd-2014", "beginner", nextTurn).find((action) => action.id === "expeditious-retreat-dash");
  assert.ok(dash);
  const dashed = consumeAction(dash, nextTurn);
  assert.equal(dashed.turn.movementRemaining, 60);
  assert.equal(dashed.turn.bonusAction, false);
  const ended = endConcentration(nextTurn, pharos.id, "test");
  assert.equal(visibleActionsForMode(pharos, "dnd-2014", "beginner", ended).some((action) => action.id === "expeditious-retreat-dash"), false);
});

test("Heroism removes Frightened and refreshes temporary hit points at turn start", () => {
  const state = readyEncounter(irvenWeber);
  const frightened = { ...state, selectedTargetId: irvenWeber.id, combatants: state.combatants.map((combatant) => combatant.id === irvenWeber.id ? { ...combatant, conditions: ["frightened"], temporaryHitPoints: 5 } : combatant) };
  const spell = irvenWeber.spells.find((candidate) => candidate.id === "heroism");
  const cast = executeSpellChoice(frightened, spell);
  assert.equal(cast.legal, true);
  assert.deepEqual(cast.encounter.combatants.find((combatant) => combatant.id === irvenWeber.id).conditions, []);
  const refreshed = nextPlayerTurn(cast.encounter);
  assert.equal(refreshed.combatants.find((combatant) => combatant.id === irvenWeber.id).temporaryHitPoints, 5);
  const spent = { ...refreshed, combatants: refreshed.combatants.map((combatant) => combatant.id === irvenWeber.id ? { ...combatant, temporaryHitPoints: 0 } : combatant) };
  const nextRefresh = nextPlayerTurn(spent);
  assert.equal(nextRefresh.combatants.find((combatant) => combatant.id === irvenWeber.id).temporaryHitPoints, 2);
});

test("Searing Smite appears only after a qualifying hit and preserves resources when declined", () => {
  const state = readyEncounter(irvenWeber);
  const spell = irvenWeber.spells.find((candidate) => candidate.id === "searing-smite");
  assert.match(validateSpellAvailability(state, spell).reason, /after you hit/i);
  const attack = resolveAttackRoll(state, irvenWeber.attacks.find((candidate) => candidate.id === "longsword"), () => 0.6);
  assert.equal(attack.hit, true);
  assert.equal(attack.encounter.pendingResponse.type, "post-hit-spell-choice");
  const slotBefore = attack.encounter.combatants[0].resources.find((resource) => resource.id === "spell-slot-1").current;
  const declined = resolvePostHitSpellChoice(attack.encounter, false);
  assert.equal(declined.encounter.pendingResponse, null);
  assert.equal(declined.encounter.turn.bonusAction, true);
  assert.equal(declined.encounter.combatants[0].resources.find((resource) => resource.id === "spell-slot-1").current, slotBefore);
});

test("Searing Smite doubles its immediate dice on a critical and resolves recurring damage then save", () => {
  const state = readyEncounter(irvenWeber);
  const attack = resolveAttackRoll(state, irvenWeber.attacks.find((candidate) => candidate.id === "quarterstaff"), () => 0.99);
  assert.equal(attack.critical, true);
  const smite = resolvePostHitSpellChoice(attack.encounter, true, () => 0);
  assert.deepEqual(smite.damageRoll.rolls, [1, 1]);
  assert.equal(smite.encounter.turn.bonusAction, false);
  assert.equal(smite.encounter.combatants[0].resources.find((resource) => resource.id === "spell-slot-1").current, 1);
  assert.equal(smite.encounter.effects.some((effect) => effect.name === "Searing Smite"), true);
  const targetId = state.selectedTargetId;
  const hpBefore = smite.encounter.combatants.find((combatant) => combatant.id === targetId).hitPoints.current;
  const targetTurn = endTurn(smite.encounter, sequence(0, 0.99));
  assert.equal(targetTurn.combatants.find((combatant) => combatant.id === targetId).hitPoints.current, hpBefore - 1);
  assert.equal(targetTurn.effects.some((effect) => effect.name === "Searing Smite"), false);
});

test("a ranged hit and missing resources do not open Searing Smite's post-hit choice", () => {
  const state = readyEncounter(irvenWeber);
  const ranged = resolveAttackRoll(state, irvenWeber.attacks.find((candidate) => candidate.id === "thrown-javelin"), () => 0.6);
  assert.equal(ranged.hit, true);
  assert.notEqual(ranged.encounter.pendingResponse?.type, "post-hit-spell-choice");
  const empty = { ...state, combatants: state.combatants.map((combatant) => combatant.id === irvenWeber.id ? { ...combatant, resources: combatant.resources.map((resource) => resource.id === "spell-slot-1" ? { ...resource, current: 0 } : resource) } : combatant) };
  const melee = resolveAttackRoll(empty, irvenWeber.attacks.find((candidate) => candidate.id === "quarterstaff"), () => 0.6);
  assert.equal(melee.hit, true);
  assert.notEqual(melee.encounter.pendingResponse?.type, "post-hit-spell-choice");
});
