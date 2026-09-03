import assert from "node:assert/strict";
import test from "node:test";

import { pharos } from "../src/characters/verified-pdf-characters.ts";
import { visibleActionsForMode } from "../src/engine/actions.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executeFeatureAction, validateFeatureAction } from "../src/engine/feature-actions.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter() {
  const state = createEncounter(pharos, generateScriptedScenario("A close fight in an open training yard."));
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
