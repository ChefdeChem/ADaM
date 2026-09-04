import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { goliathBarbarian, irvenWeber, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { executeAttackChoice, resolveAttackRoll, validateAttackChoice } from "../src/engine/combat-options.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function encounterFor(character, enemyPosition = { x: 2, y: 6 }) {
  const state = createEncounter(character, generateScriptedScenario({
    prompt: "A clear weapon training yard",
    environment: "market",
    objective: "defeat",
    difficulty: "easy",
  }));
  const target = state.combatants.find((combatant) => combatant.side === "enemy");
  return {
    ...state,
    selectedTargetId: target.id,
    combatants: state.combatants.map((combatant) => combatant.id === target.id
      ? { ...combatant, position: enemyPosition }
      : combatant),
  };
}

function player(state) {
  return state.combatants.find((combatant) => combatant.side === "player");
}

test("the prior ten carried weapons remain executable", () => {
  const reports = BUILT_IN_CHARACTERS.map((character) => buildCharacterMechanicCoverage(character));
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(reports.reduce((total, report) => total + report.executable, 0), 99);

  const expected = [
    ["cleira-oestwilde", "equipment-1-dagger", "srd-5.1"],
    ["cleira-oestwilde", "equipment-2-rapier", "srd-5.1"],
    ["surina-daardendrian", "equipment-1-glaive", "srd-5.1"],
    ["surina-daardendrian", "equipment-2-longsword", "srd-5.1"],
    ["surina-daardendrian", "equipment-3-javelin", "srd-5.1"],
    ["goliath-barbarian", "equipment-0-spear", "srd-5.2.1"],
    ["goliath-barbarian", "equipment-1-maul", "srd-5.2.1"],
    ["irven-weber", "equipment-2-longsword", "srd-5.2.1"],
    ["irven-weber", "equipment-3-javelin", "srd-5.2.1"],
    ["irven-weber", "equipment-4-quarterstaff", "srd-5.2.1"],
  ];
  for (const [characterId, entityId, sourceId] of expected) {
    const entry = reports.find((report) => report.characterId === characterId).entries.find((candidate) => candidate.entityId === entityId);
    assert.equal(entry.status, "supported", `${characterId}:${entityId}`);
    assert.equal(entry.executable, true, `${characterId}:${entityId}`);
    assert.equal(entry.sourceId, sourceId, `${characterId}:${entityId}`);
    assert.ok(entry.components.includes("inventory"), `${characterId}:${entityId}`);
    assert.ok(entry.components.includes("attack-roll"), `${characterId}:${entityId}`);
    assert.deepEqual(entry.missingCapabilities, [], `${characterId}:${entityId}`);
  }
});

test("encounters copy all ten registered weapon quantities from the character profiles", () => {
  const expectations = [
    [cleiraOestwilde, { dagger: 1, rapier: 1 }],
    [surinaDaardendrian, { glaive: 1, longsword: 1, javelin: 5 }],
    [goliathBarbarian, { spear: 5, maul: 1 }],
    [irvenWeber, { longsword: 1, javelin: 6, quarterstaff: 1 }],
  ];
  for (const [character, quantities] of expectations) {
    const inventory = player(encounterFor(character)).inventory;
    assert.deepEqual(Object.fromEntries(inventory.filter((item) => item.attackIds.length).map((item) => [item.id, item.current])), quantities);
  }
});

test("a thrown dagger is consumed even when its attack misses", () => {
  const state = encounterFor(cleiraOestwilde);
  const attack = cleiraOestwilde.attacks.find((candidate) => candidate.id === "thrown-dagger");
  const result = resolveAttackRoll(state, attack, () => 0);
  assert.equal(result.legal, true);
  assert.equal(result.hit, false);
  assert.equal(player(result.encounter).inventory.find((item) => item.id === "dagger").current, 0);
});

test("throwing the last copy removes both melee and thrown variants", () => {
  const state = encounterFor(cleiraOestwilde);
  const attack = cleiraOestwilde.attacks.find((candidate) => candidate.id === "thrown-dagger");
  const result = resolveAttackRoll(state, attack, () => 0.5);
  const attackIds = player(result.encounter).attacks.map((candidate) => candidate.id);
  assert.equal(attackIds.includes("dagger"), false);
  assert.equal(attackIds.includes("thrown-dagger"), false);
  assert.equal(attackIds.includes("rapier"), true);
  assert.equal(attackIds.includes("unarmed-strike"), true);
});

test("a depleted weapon cannot be selected through a stale attack reference", () => {
  const state = encounterFor(cleiraOestwilde);
  const attack = cleiraOestwilde.attacks.find((candidate) => candidate.id === "thrown-dagger");
  const spent = resolveAttackRoll(state, attack, () => 0).encounter;
  const reset = { ...spent, turn: { ...spent.turn, action: true } };
  assert.match(validateAttackChoice(reset, attack).reason, /no longer in your carried inventory/i);
});

test("melee attacks with a throwable weapon do not consume inventory", () => {
  const state = encounterFor(irvenWeber);
  const attack = irvenWeber.attacks.find((candidate) => candidate.id === "javelin");
  const result = resolveAttackRoll(state, attack, () => 0.5);
  assert.equal(player(result.encounter).inventory.find((item) => item.id === "javelin").current, 6);
});

test("multiple thrown weapons remain available until the final copy is used", () => {
  let state = encounterFor(surinaDaardendrian);
  const attack = surinaDaardendrian.attacks.find((candidate) => candidate.id === "thrown-javelin");
  state = resolveAttackRoll(state, attack, () => 0.5).encounter;
  state = { ...state, turn: { ...state.turn, action: true } };
  state = resolveAttackRoll(state, attack, () => 0.5).encounter;
  assert.equal(player(state).inventory.find((item) => item.id === "javelin").current, 3);
  assert.ok(player(state).attacks.some((candidate) => candidate.id === "javelin"));
  assert.ok(player(state).attacks.some((candidate) => candidate.id === "thrown-javelin"));
});

test("the legacy combined attack path also consumes thrown inventory", () => {
  const state = encounterFor(goliathBarbarian);
  const attack = goliathBarbarian.attacks.find((candidate) => candidate.id === "thrown-spear");
  const result = executeAttackChoice(state, attack, () => 0.5);
  assert.equal(result.legal, true);
  assert.equal(player(result.encounter).inventory.find((item) => item.id === "spear").current, 4);
});

test("zero quantity or unequipped registered weapons are unavailable without affecting unarmed strikes", () => {
  const zeroDaggers = {
    ...cleiraOestwilde,
    profile: {
      ...cleiraOestwilde.profile,
      equipment: cleiraOestwilde.profile.equipment.map((item) => item.name === "Dagger" ? { ...item, quantity: 0 } : item),
    },
  };
  const zeroState = encounterFor(zeroDaggers);
  assert.equal(player(zeroState).attacks.some((attack) => attack.id === "dagger" || attack.id === "thrown-dagger"), false);
  assert.equal(player(zeroState).attacks.some((attack) => attack.id === "unarmed-strike"), true);

  const unequippedRapier = {
    ...cleiraOestwilde,
    equipmentRules: cleiraOestwilde.equipmentRules.map((rule) => rule.id === "rapier" ? { ...rule, equipped: false } : rule),
  };
  assert.equal(player(encounterFor(unequippedRapier)).attacks.some((attack) => attack.id === "rapier"), false);
});
