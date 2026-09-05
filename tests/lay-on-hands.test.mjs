import assert from "node:assert/strict";
import test from "node:test";

import { irvenWeber, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { visibleActionsForMode } from "../src/engine/actions.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executeFeatureAction, validateFeatureAction } from "../src/engine/feature-actions.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter(character, currentHitPoints) {
  const state = createEncounter(character, generateScriptedScenario("A close fight in an open training yard."));
  return {
    ...state,
    combatants: state.combatants.map((combatant) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10,
      initiativeRolled: true,
      hitPoints: combatant.side === "player" ? { ...combatant.hitPoints, current: currentHitPoints } : combatant.hitPoints,
    })),
  };
}

test("Lay on Hands keeps its 2014 Action and 2024 Bonus Action provenance", () => {
  const legacy = visibleActionsForMode(surinaDaardendrian, "dnd-2014", "beginner", readyEncounter(surinaDaardendrian, 6));
  const current = visibleActionsForMode(irvenWeber, "dnd-2024", "beginner", readyEncounter(irvenWeber, 7));
  assert.equal(legacy.find((action) => action.id === "lay-on-hands").cost, "action");
  assert.equal(current.find((action) => action.id === "lay-on-hands").cost, "bonus-action");
});

test("2014 Lay on Hands spends the chosen pool amount, heals, and consumes the Action", () => {
  const state = readyEncounter(surinaDaardendrian, 6);
  const feature = surinaDaardendrian.featureActions.find((candidate) => candidate.id === "lay-on-hands");
  const result = executeFeatureAction(state, feature, { resourceAmount: 3, targetCombatantId: surinaDaardendrian.id });
  assert.equal(result.legal, true);
  const player = result.encounter.combatants.find((combatant) => combatant.id === surinaDaardendrian.id);
  assert.equal(player.hitPoints.current, 9);
  assert.equal(player.resources.find((resource) => resource.id === "lay-on-hands").current, 2);
  assert.equal(result.encounter.turn.action, false);
  assert.equal(result.encounter.turn.bonusAction, true);
  assert.match(result.summary, /regains 3 Hit Points/);
});

test("2024 Lay On Hands spends the chosen pool amount and consumes the Bonus Action", () => {
  const state = readyEncounter(irvenWeber, 7);
  const feature = irvenWeber.featureActions.find((candidate) => candidate.id === "lay-on-hands");
  const result = executeFeatureAction(state, feature, { resourceAmount: 4, targetCombatantId: irvenWeber.id });
  assert.equal(result.legal, true);
  const player = result.encounter.combatants.find((combatant) => combatant.id === irvenWeber.id);
  assert.equal(player.hitPoints.current, 11);
  assert.equal(player.resources.find((resource) => resource.id === "lay-on-hands").current, 1);
  assert.equal(result.encounter.turn.action, true);
  assert.equal(result.encounter.turn.bonusAction, false);
});

test("Lay on Hands can restore an adjacent ally from 0 Hit Points", () => {
  const state = readyEncounter(surinaDaardendrian, 6);
  const source = state.combatants.find((combatant) => combatant.id === surinaDaardendrian.id);
  const ally = {
    ...source,
    id: "ally",
    name: "Ally",
    position: { x: source.position.x + 1, y: source.position.y },
    hitPoints: { current: 0, maximum: 8 },
    resources: [],
    deathSaves: { successes: 1, failures: 2 },
    stabilized: true,
  };
  const withAlly = { ...state, combatants: [...state.combatants, ally] };
  const feature = surinaDaardendrian.featureActions.find((candidate) => candidate.id === "lay-on-hands");
  const result = executeFeatureAction(withAlly, feature, { resourceAmount: 2, targetCombatantId: ally.id });
  assert.equal(result.legal, true);
  const healed = result.encounter.combatants.find((combatant) => combatant.id === ally.id);
  assert.equal(healed.hitPoints.current, 2);
  assert.deepEqual(healed.deathSaves, { successes: 0, failures: 0 });
  assert.equal(healed.stabilized, false);
});

test("Lay on Hands rejects missing, excessive and out-of-touch choices, but can heal a reachable hostile creature", () => {
  const state = readyEncounter(surinaDaardendrian, 9);
  const feature = surinaDaardendrian.featureActions.find((candidate) => candidate.id === "lay-on-hands");
  const enemy = state.combatants.find((combatant) => combatant.side === "enemy");
  assert.match(validateFeatureAction(state, feature).reason, /Choose how many points/i);
  assert.match(validateFeatureAction(state, feature, { resourceAmount: 3 }).reason, /at most 2 Hit Points/i);

  const source = state.combatants.find((combatant) => combatant.id === surinaDaardendrian.id);
  const reachable = { ...state, combatants: state.combatants.map((c) => c.id === enemy.id ? { ...c, creatureType: "humanoid", position: { x: source.position.x + 1, y: source.position.y }, hitPoints: { current: 1, maximum: 10 } } : c) };
  assert.equal(executeFeatureAction(reachable, feature, { resourceAmount: 1, targetCombatantId: enemy.id }).legal, true);
  const distantAlly = { ...source, id: "distant-ally", position: { x: source.position.x + 2, y: source.position.y }, hitPoints: { current: 5, maximum: 8 }, resources: [] };
  const withDistantAlly = { ...state, combatants: [...state.combatants, distantAlly] };
  assert.match(validateFeatureAction(withDistantAlly, feature, { resourceAmount: 1, targetCombatantId: distantAlly.id }).reason, /requires touch/i);
});
