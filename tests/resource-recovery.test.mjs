import assert from "node:assert/strict";
import test from "node:test";

import { pharos, goliathBarbarian } from "../src/characters/verified-pdf-characters.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { recoverRestResources, recoveryAmount } from "../src/engine/resources.ts";

const scenario = {
  id: "rest-test",
  title: "Rest test",
  opening: "Test encounter.",
  objective: "defeat",
  environment: "crypt",
  difficulty: "easy",
  features: [],
  enemyProfileIds: ["ashen-scout"],
  grid: { width: 12, height: 8, terrain: [] },
};

function withResourceTotals(character, totals) {
  const encounter = createEncounter(character, scenario);
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === character.id
      ? { ...combatant, resources: combatant.resources.map((resource) => ({ ...resource, current: totals[resource.id] ?? resource.current })) }
      : combatant),
  };
}

test("Short Rest recovers short-rest pools but leaves long-rest pools spent", () => {
  const spent = withResourceTotals(pharos, {
    "spell-slot-1": 0,
    "adrenaline-rush": 0,
    "relentless-endurance": 0,
    "honeyed-words": 0,
  });
  const result = recoverRestResources(spent, pharos.id, "short-rest");
  assert.equal(result.legal, true);
  const resources = result.encounter.combatants.find((combatant) => combatant.id === pharos.id).resources;
  assert.equal(resources.find((resource) => resource.id === "spell-slot-1").current, 1);
  assert.equal(resources.find((resource) => resource.id === "adrenaline-rush").current, 2);
  assert.equal(resources.find((resource) => resource.id === "relentless-endurance").current, 0);
  assert.equal(resources.find((resource) => resource.id === "honeyed-words").current, 0);
  assert.deepEqual(result.recovered.map((resource) => resource.resourceId), ["spell-slot-1", "adrenaline-rush"]);
});

test("Long Rest recovers both short-rest and long-rest pools", () => {
  const spent = withResourceTotals(pharos, {
    "spell-slot-1": 0,
    "adrenaline-rush": 1,
    "relentless-endurance": 0,
    "honeyed-words": 0,
  });
  const result = recoverRestResources(spent, pharos.id, "long-rest");
  assert.equal(result.legal, true);
  const resources = result.encounter.combatants.find((combatant) => combatant.id === pharos.id).resources;
  assert.ok(resources.every((resource) => resource.current === resource.maximum));
  assert.match(result.summary, /Long Rest resource recovery/);
});

test("Barbarian Rage uses its special one-on-short and all-on-long schedule", () => {
  const spent = withResourceTotals(goliathBarbarian, { rage: 0 });
  const shortRest = recoverRestResources(spent, goliathBarbarian.id, "short-rest");
  assert.equal(shortRest.legal, true);
  const afterShort = shortRest.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id).resources.find((resource) => resource.id === "rage");
  assert.equal(afterShort.current, 1);
  const secondShortRest = recoverRestResources(shortRest.encounter, goliathBarbarian.id, "short-rest");
  const afterSecondShort = secondShortRest.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id).resources.find((resource) => resource.id === "rage");
  assert.equal(afterSecondShort.current, 2);

  const longRest = recoverRestResources(spent, goliathBarbarian.id, "long-rest");
  const afterLong = longRest.encounter.combatants.find((combatant) => combatant.id === goliathBarbarian.id).resources.find((resource) => resource.id === "rage");
  assert.equal(afterLong.current, 2);
});

test("Recovery clamps at maximum and reports no eligible resources when already full", () => {
  const resource = { id: "limited", name: "Limited", kind: "generic", current: 2, maximum: 2, recovery: "short-rest" };
  assert.equal(recoveryAmount(resource, "short-rest"), 0);
  const result = recoverRestResources(createEncounter(pharos, scenario), pharos.id, "short-rest");
  assert.equal(result.legal, true);
  assert.deepEqual(result.recovered, []);
  assert.match(result.summary, /no expended resources were eligible/);
});

test("Pending player responses block rest recovery without mutating the encounter", () => {
  const state = {
    ...withResourceTotals(pharos, { "adrenaline-rush": 0 }),
    pendingResponse: {
      type: "zero-hit-point-replacement",
      targetCombatantId: pharos.id,
      featureId: "relentless-endurance",
      damageTaken: 4,
    },
  };
  const result = recoverRestResources(state, pharos.id, "short-rest");
  assert.equal(result.legal, false);
  assert.equal(result.encounter, state);
  assert.match(result.reason, /pending player response/i);
});

test("Unregistered special recovery remains inert", () => {
  const resource = { id: "mystery", name: "Mystery", kind: "generic", current: 0, maximum: 3, recovery: "special" };
  assert.equal(recoveryAmount(resource, "short-rest"), 0);
  assert.equal(recoveryAmount(resource, "long-rest"), 0);
});
