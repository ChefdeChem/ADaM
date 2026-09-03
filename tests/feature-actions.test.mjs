import assert from "node:assert/strict";
import test from "node:test";

import { goliathBarbarian, pharos } from "../src/characters/verified-pdf-characters.ts";
import { visibleActionsForMode } from "../src/engine/actions.ts";
import { applyDamageToCombatant } from "../src/engine/combat-options.ts";
import { applyEffect } from "../src/engine/effects.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executeFeatureAction, validateFeatureAction } from "../src/engine/feature-actions.ts";
import { resolveDamageReductionReaction, resolveZeroHitPointReplacement } from "../src/engine/responses.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter() {
  const state = createEncounter(pharos, generateScriptedScenario("A close fight in an open training yard."));
  return {
    ...state,
    combatants: state.combatants.map((combatant) => ({ ...combatant, initiative: combatant.side === "player" ? 20 : 10, initiativeRolled: true })),
  };
}

function readyGoliathEncounter() {
  const state = createEncounter(goliathBarbarian, generateScriptedScenario("A close fight in an open training yard."));
  return {
    ...state,
    combatants: state.combatants.map((combatant) => ({ ...combatant, initiative: combatant.side === "player" ? 20 : 10, initiativeRolled: true })),
  };
}

test("a 2024 species feature remains available on a 2014 class character", () => {
  const state = readyEncounter();
  const actions = visibleActionsForMode(pharos, pharos.rulesetId, "beginner", state);
  assert.equal(actions.some((action) => action.id === "adrenaline-rush" && action.cost === "bonus-action"), true);
});

test("Adrenaline Rush spends one use, consumes the bonus action, dashes, and grants PB temporary HP", () => {
  const state = readyEncounter();
  const feature = pharos.featureActions.find((candidate) => candidate.id === "adrenaline-rush");
  const result = executeFeatureAction(state, feature);
  assert.equal(result.legal, true);
  assert.equal(result.encounter.turn.action, true);
  assert.equal(result.encounter.turn.bonusAction, false);
  assert.equal(result.encounter.turn.movementRemaining, 60);
  assert.equal(result.encounter.combatants[0].temporaryHitPoints, 2);
  assert.equal(result.encounter.combatants[0].temporaryHitPointsSourceEffectId, undefined);
  assert.equal(result.encounter.combatants[0].resources.find((resource) => resource.id === "adrenaline-rush").current, 1);
});

test("Adrenaline Rush keeps higher temporary HP and blocks use after the bonus action or resource is spent", () => {
  const feature = pharos.featureActions.find((candidate) => candidate.id === "adrenaline-rush");
  const state = readyEncounter();
  const withMoreTemporaryHp = {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.side === "player" ? { ...combatant, temporaryHitPoints: 5 } : combatant),
  };
  const used = executeFeatureAction(withMoreTemporaryHp, feature);
  assert.equal(used.legal, true);
  assert.equal(used.encounter.combatants[0].temporaryHitPoints, 5);
  assert.match(validateFeatureAction(used.encounter, feature).reason, /Bonus Action/i);

  const empty = {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.side === "player"
      ? { ...combatant, resources: combatant.resources.map((resource) => resource.id === "adrenaline-rush" ? { ...resource, current: 0 } : resource) }
      : combatant),
  };
  assert.match(validateFeatureAction(empty, feature).reason, /only 0 remains/i);
});

test("Relentless Endurance pauses lethal-looking damage for the player's choice", () => {
  const state = readyEncounter();
  const damaged = applyDamageToCombatant(state, pharos.id, pharos.hitPoints.maximum);
  const player = damaged.combatants.find((combatant) => combatant.id === pharos.id);
  assert.equal(player.hitPoints.current, 0);
  assert.equal(player.resources.find((resource) => resource.id === "relentless-endurance").current, 1);
  assert.equal(damaged.pendingResponse.type, "zero-hit-point-replacement");
  assert.equal(damaged.pendingResponse.featureId, "relentless-endurance");
});

test("using Relentless Endurance spends its use, restores 1 HP, and prevents a second trigger", () => {
  const state = readyEncounter();
  const damaged = applyDamageToCombatant(state, pharos.id, pharos.hitPoints.maximum);
  const used = resolveZeroHitPointReplacement(damaged, true);
  const standing = used.encounter.combatants.find((combatant) => combatant.id === pharos.id);
  assert.equal(standing.hitPoints.current, 1);
  assert.deepEqual(standing.deathSaves, { successes: 0, failures: 0 });
  assert.equal(standing.resources.find((resource) => resource.id === "relentless-endurance").current, 0);
  assert.equal(used.encounter.pendingResponse, null);

  const damagedAgain = applyDamageToCombatant(used.encounter, pharos.id, 1);
  assert.equal(damagedAgain.combatants.find((combatant) => combatant.id === pharos.id).hitPoints.current, 0);
  assert.equal(damagedAgain.pendingResponse, null);
});

test("declining Relentless Endurance preserves its use and leaves the character unconscious", () => {
  const state = readyEncounter();
  const damaged = applyDamageToCombatant(state, pharos.id, pharos.hitPoints.maximum);
  const declined = resolveZeroHitPointReplacement(damaged, false);
  const player = declined.encounter.combatants.find((combatant) => combatant.id === pharos.id);
  assert.equal(player.hitPoints.current, 0);
  assert.equal(player.resources.find((resource) => resource.id === "relentless-endurance").current, 1);
  assert.equal(declined.encounter.pendingResponse, null);
});

test("Relentless Endurance does not trigger when excess damage kills outright", () => {
  const state = readyEncounter();
  const damaged = applyDamageToCombatant(state, pharos.id, pharos.hitPoints.maximum * 2);
  const player = damaged.combatants.find((combatant) => combatant.id === pharos.id);
  assert.equal(player.hitPoints.current, 0);
  assert.equal(damaged.pendingResponse, null);
  assert.equal(player.resources.find((resource) => resource.id === "relentless-endurance").current, 1);
});

test("Relentless Endurance queues concentration after the character remains conscious", () => {
  const state = applyEffect(readyEncounter(), {
    name: "Test concentration",
    description: "Regression fixture.",
    sourceCombatantId: pharos.id,
    targetCombatantId: pharos.id,
    durationRounds: 10,
    concentration: true,
  });
  const damaged = applyDamageToCombatant(state, pharos.id, pharos.hitPoints.maximum);
  const used = resolveZeroHitPointReplacement(damaged, true);
  assert.equal(used.encounter.combatants.find((combatant) => combatant.id === pharos.id).hitPoints.current, 1);
  assert.equal(used.encounter.pendingResponse.type, "concentration-check");
  assert.equal(used.encounter.pendingResponse.damageTaken, pharos.hitPoints.maximum);
});

test("Relentless Endurance resumes interrupted movement when no concentration check is needed", () => {
  const state = readyEncounter();
  const damaged = applyDamageToCombatant(state, pharos.id, pharos.hitPoints.maximum);
  const withContinuation = {
    ...damaged,
    pendingResponse: { ...damaged.pendingResponse, continuation: { combatantId: pharos.id, x: 2, y: 6, cost: 5 } },
  };
  const used = resolveZeroHitPointReplacement(withContinuation, true);
  const player = used.encounter.combatants.find((combatant) => combatant.id === pharos.id);
  assert.deepEqual(player.position, { x: 2, y: 6 });
  assert.equal(used.encounter.turn.movementRemaining, 25);
});

test("Stone's Endurance pauses damage before hit points or temporary hit points change", () => {
  const initial = readyGoliathEncounter();
  const state = {
    ...initial,
    combatants: initial.combatants.map((combatant) => combatant.side === "player" ? { ...combatant, temporaryHitPoints: 4 } : combatant),
  };
  const pending = applyDamageToCombatant(state, goliathBarbarian.id, 8);
  const player = pending.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  assert.equal(player.hitPoints.current, 14);
  assert.equal(player.temporaryHitPoints, 4);
  assert.equal(pending.pendingResponse.type, "damage-reduction-reaction");
  assert.equal(pending.pendingResponse.damageTaken, 8);
  const used = resolveDamageReductionReaction(pending, true, () => 0);
  const damagedPlayer = used.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  assert.equal(damagedPlayer.temporaryHitPoints, 0);
  assert.equal(damagedPlayer.hitPoints.current, 13);
});

test("Stone's Endurance rolls 1d12 + Constitution, spends its use and Reaction, then applies reduced damage", () => {
  const pending = applyDamageToCombatant(readyGoliathEncounter(), goliathBarbarian.id, 8);
  const used = resolveDamageReductionReaction(pending, true, () => 0);
  const player = used.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  assert.deepEqual(used.damageRoll.rolls, [1]);
  assert.equal(used.damageRoll.total, 3);
  assert.equal(player.hitPoints.current, 9);
  assert.equal(player.reactionAvailable, false);
  assert.equal(player.resources.find((resource) => resource.id === "stones-endurance").current, 1);
  assert.equal(used.encounter.pendingResponse, null);
});

test("declining Stone's Endurance preserves both its use and Reaction", () => {
  const pending = applyDamageToCombatant(readyGoliathEncounter(), goliathBarbarian.id, 8);
  const declined = resolveDamageReductionReaction(pending, false);
  const player = declined.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  assert.equal(player.hitPoints.current, 6);
  assert.equal(player.reactionAvailable, true);
  assert.equal(player.resources.find((resource) => resource.id === "stones-endurance").current, 2);
});

test("Stone's Endurance can reduce damage to zero without creating a concentration check", () => {
  const concentrating = applyEffect(readyGoliathEncounter(), {
    name: "Test concentration",
    description: "Regression fixture.",
    sourceCombatantId: goliathBarbarian.id,
    targetCombatantId: goliathBarbarian.id,
    durationRounds: 10,
    concentration: true,
  });
  const pending = applyDamageToCombatant(concentrating, goliathBarbarian.id, 2);
  const used = resolveDamageReductionReaction(pending, true, () => 0);
  assert.equal(used.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 14);
  assert.equal(used.encounter.pendingResponse, null);
  assert.equal(used.encounter.effects.length, 1);
});

test("Stone's Endurance chains the reduced damage into concentration", () => {
  const concentrating = applyEffect(readyGoliathEncounter(), {
    name: "Test concentration",
    description: "Regression fixture.",
    sourceCombatantId: goliathBarbarian.id,
    targetCombatantId: goliathBarbarian.id,
    durationRounds: 10,
    concentration: true,
  });
  const pending = applyDamageToCombatant(concentrating, goliathBarbarian.id, 14);
  const used = resolveDamageReductionReaction(pending, true, () => 0);
  assert.equal(used.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 3);
  assert.equal(used.encounter.pendingResponse.type, "concentration-check");
  assert.equal(used.encounter.pendingResponse.damageTaken, 11);
  assert.equal(used.encounter.pendingResponse.dc, 10);
});

test("Stone's Endurance resumes movement after reducing opportunity-attack damage", () => {
  const pending = applyDamageToCombatant(readyGoliathEncounter(), goliathBarbarian.id, 8);
  const withContinuation = {
    ...pending,
    pendingResponse: { ...pending.pendingResponse, continuation: { combatantId: goliathBarbarian.id, x: 2, y: 6, cost: 5 } },
  };
  const used = resolveDamageReductionReaction(withContinuation, true, () => 0);
  const player = used.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  assert.deepEqual(player.position, { x: 2, y: 6 });
  assert.equal(used.encounter.turn.movementRemaining, 25);
});

test("Stone's Endurance is not offered without a Reaction or a remaining use", () => {
  const state = readyGoliathEncounter();
  const unavailable = {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.side === "player" ? { ...combatant, reactionAvailable: false } : combatant),
  };
  const noReaction = applyDamageToCombatant(unavailable, goliathBarbarian.id, 8);
  assert.equal(noReaction.pendingResponse, null);
  assert.equal(noReaction.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 6);

  const empty = {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.side === "player"
      ? { ...combatant, resources: combatant.resources.map((resource) => resource.id === "stones-endurance" ? { ...resource, current: 0 } : resource) }
      : combatant),
  };
  const noUses = applyDamageToCombatant(empty, goliathBarbarian.id, 8);
  assert.equal(noUses.pendingResponse, null);
  assert.equal(noUses.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 6);
});
