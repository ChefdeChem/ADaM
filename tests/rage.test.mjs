import assert from "node:assert/strict";
import test from "node:test";

import { goliathBarbarian } from "../src/characters/verified-pdf-characters.ts";
import { applyDamageToCombatant, resolveAttackDamage } from "../src/engine/combat-options.ts";
import { applyEffect } from "../src/engine/effects.ts";
import { createEncounter, endTurn } from "../src/engine/encounter.ts";
import { executeFeatureAction, validateFeatureAction } from "../src/engine/feature-actions.ts";
import { resolveDamageReductionReaction } from "../src/engine/responses.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter() {
  const state = createEncounter(goliathBarbarian, generateScriptedScenario("A close fight in an open training yard."));
  return {
    ...state,
    combatants: state.combatants.map((combatant) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10,
      initiativeRolled: true,
    })),
  };
}

function activateRage(encounter = readyEncounter()) {
  const feature = goliathBarbarian.featureActions.find((candidate) => candidate.id === "rage");
  const result = executeFeatureAction(encounter, feature);
  assert.equal(result.legal, true);
  return { feature, result };
}

function withoutStoneReaction(encounter) {
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === goliathBarbarian.id
      ? { ...combatant, reactionAvailable: false }
      : combatant),
  };
}

test("Rage is an executable partial 2024 feature with official provenance", () => {
  const rage = buildCharacterMechanicCoverage(goliathBarbarian).entries.find((entry) => entry.entityId === "rage" && entry.kind === "feature");
  assert.equal(rage.rulesetId, "dnd-2024");
  assert.equal(rage.sourceId, "srd-5.2.1");
  assert.equal(rage.status, "partial");
  assert.equal(rage.executable, true);
  assert.deepEqual(rage.components, ["action-economy", "resource-spend", "resource-recovery", "duration", "damage-resistance"]);
  assert.match(rage.missingCapabilities.join(" "), /Rage Damage/i);
});

test("Rage spends one use and the Bonus Action, then creates a self effect", () => {
  const { feature, result } = activateRage();
  const player = result.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  const effect = result.encounter.effects.find((candidate) => candidate.name === "Rage");
  assert.equal(result.encounter.turn.action, true);
  assert.equal(result.encounter.turn.bonusAction, false);
  assert.equal(player.resources.find((resource) => resource.id === "rage").current, 1);
  assert.deepEqual(effect.modifiers.damageResistances, ["bludgeoning", "piercing", "slashing"]);
  assert.deepEqual(effect.expiresAt, { round: 2, combatantId: goliathBarbarian.id, phase: "end" });
  assert.match(validateFeatureAction(result.encounter, feature).reason, /Bonus Action|already active/i);
});

test("Rage resistance halves typed physical damage after rolling and rounds down", () => {
  const { result } = activateRage();
  const ready = withoutStoneReaction(result.encounter);
  const physical = applyDamageToCombatant(ready, goliathBarbarian.id, 9, { damageType: "slashing" });
  assert.equal(physical.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 10);
  assert.match(physical.log[0], /reduces 9 slashing damage to 4/i);

  const elemental = applyDamageToCombatant(ready, goliathBarbarian.id, 9, { damageType: "fire" });
  assert.equal(elemental.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 5);
});

test("weapon damage carries its parsed type into Rage resistance", () => {
  const { result } = activateRage();
  const ready = withoutStoneReaction(result.encounter);
  const attack = { id: "test-sword", name: "Test Sword", kind: "melee", attackBonus: 0, damage: "1d8 + 1 slashing", normalRangeFeet: 5 };
  const damage = resolveAttackDamage(ready, attack, goliathBarbarian.id, false, () => 0.99);
  assert.equal(damage.legal, true);
  assert.equal(damage.roll.total, 9);
  assert.equal(damage.damageApplied, 4);
  assert.equal(damage.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id).hitPoints.current, 10);
  assert.match(damage.summary, /4 applied after resistance/i);
});

test("Stone's Endurance reduces damage before Rage resistance, and Rage ends concentration", () => {
  const concentrating = applyEffect(readyEncounter(), {
    name: "Test concentration",
    description: "Regression fixture.",
    sourceCombatantId: goliathBarbarian.id,
    targetCombatantId: goliathBarbarian.id,
    durationRounds: 10,
    concentration: true,
  });
  const { result } = activateRage(concentrating);
  const pending = applyDamageToCombatant(result.encounter, goliathBarbarian.id, 9, { damageType: "piercing" });
  assert.equal(pending.pendingResponse.type, "damage-reduction-reaction");
  assert.equal(pending.pendingResponse.damageTaken, 9);
  assert.equal(pending.pendingResponse.damageType, "piercing");

  const resolved = resolveDamageReductionReaction(pending, true, () => 0);
  const player = resolved.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id);
  assert.equal(resolved.damageRoll.total, 3);
  assert.equal(player.hitPoints.current, 11);
  assert.equal(resolved.encounter.pendingResponse, null);
  assert.equal(resolved.encounter.effects.some((effect) => effect.concentration), false);
  assert.match(resolved.summary, /resistance further reduces it to 3/i);
});

test("Rage remains through the next turn and expires at that turn's end", () => {
  const { result } = activateRage();
  let next = endTurn(result.encounter);
  while (next.combatants[next.activeIndex].id !== goliathBarbarian.id) next = endTurn(next);
  assert.equal(next.round, 2);
  assert.equal(next.effects.some((effect) => effect.name === "Rage"), true);
  next = endTurn(next);
  assert.equal(next.effects.some((effect) => effect.name === "Rage"), false);
});
