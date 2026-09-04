import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { goliathBarbarian, irvenWeber, pharos, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { validateAttackChoice, validateSpellAvailability } from "../src/engine/combat-options.ts";
import { abilityCheckRollMode, savingThrowRollMode } from "../src/engine/effects.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function encounterFor(character) {
  return createEncounter(character, generateScriptedScenario({
    prompt: "A clear armor training yard",
    environment: "market",
    objective: "defeat",
    difficulty: "easy",
  }));
}

test("five equipped defenses raise executable coverage from 60 to 65", () => {
  const reports = BUILT_IN_CHARACTERS.map((character) => buildCharacterMechanicCoverage(character));
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(reports.reduce((total, report) => total + report.executable, 0), 99);

  const expected = [
    ["cleira-oestwilde", "equipment-0-leather-armor", "srd-5.1"],
    ["surina-daardendrian", "equipment-0-chain-mail", "srd-5.1"],
    ["irven-weber", "equipment-0-shield", "srd-5.2.1"],
    ["irven-weber", "equipment-1-chain-mail", "srd-5.2.1"],
    ["pharos", "equipment-0-leather-armor", "srd-5.1"],
  ];
  for (const [characterId, entityId, sourceId] of expected) {
    const entry = reports.find((report) => report.characterId === characterId).entries.find((candidate) => candidate.entityId === entityId);
    assert.equal(entry.status, "supported", `${characterId}:${entityId}`);
    assert.equal(entry.executable, true, `${characterId}:${entityId}`);
    assert.equal(entry.sourceId, sourceId, `${characterId}:${entityId}`);
    assert.ok(entry.components.includes("armor-calculation"), `${characterId}:${entityId}`);
    assert.deepEqual(entry.missingCapabilities, [], `${characterId}:${entityId}`);
  }
});

test("Leather Armor derives Cleira and Pharos AC from 11 plus Dexterity", () => {
  const cleira = encounterFor({ ...cleiraOestwilde, armorClass: 1 });
  const warlock = encounterFor({ ...pharos, armorClass: 1 });
  assert.equal(cleira.combatants[0].baseArmorClass, 13);
  assert.equal(warlock.combatants[0].baseArmorClass, 12);
  assert.equal(abilityCheckRollMode(cleira, cleiraOestwilde.id, "stealth"), "normal");
});

test("Chain Mail fixes AC at 16 without adding Dexterity", () => {
  const highDexterity = { ...surinaDaardendrian, armorClass: 1, abilities: { ...surinaDaardendrian.abilities, dexterity: 20 } };
  const encounter = encounterFor(highDexterity);
  assert.equal(encounter.combatants[0].baseArmorClass, 16);
});

test("Irven's trained Shield adds 2 AC to Chain Mail", () => {
  const encounter = encounterFor({ ...irvenWeber, armorClass: 1 });
  assert.equal(encounter.combatants[0].baseArmorClass, 18);

  const withoutShieldTraining = {
    ...irvenWeber,
    armorClass: 1,
    profile: { ...irvenWeber.profile, proficiencies: { ...irvenWeber.profile.proficiencies, armor: irvenWeber.profile.proficiencies.armor.filter((entry) => entry !== "Shields") } },
  };
  assert.equal(encounterFor(withoutShieldTraining).combatants[0].baseArmorClass, 16);
});

test("an unequipped Shield stops contributing to AC", () => {
  const unequipped = {
    ...irvenWeber,
    armorClass: 1,
    equipmentRules: irvenWeber.equipmentRules.map((rule) => rule.id === "shield" ? { ...rule, equipped: false } : rule),
  };
  assert.equal(encounterFor(unequipped).combatants[0].baseArmorClass, 16);
});

test("Chain Mail applies its Strength requirement and Stealth disadvantage", () => {
  const underStrength = { ...surinaDaardendrian, abilities: { ...surinaDaardendrian.abilities, strength: 12 } };
  const encounter = encounterFor(underStrength);
  assert.equal(encounter.combatants[0].baseSpeedFeet, 20);
  assert.equal(abilityCheckRollMode(encounter, surinaDaardendrian.id, "stealth"), "disadvantage");
  assert.equal(abilityCheckRollMode(encounter, surinaDaardendrian.id, "persuasion"), "normal");
});

test("wearing armor without training imposes Strength and Dexterity penalties and blocks spellcasting", () => {
  const untrained = {
    ...cleiraOestwilde,
    profile: { ...cleiraOestwilde.profile, proficiencies: { ...cleiraOestwilde.profile.proficiencies, armor: [] } },
  };
  const state = encounterFor(untrained);
  const target = state.combatants.find((combatant) => combatant.side === "enemy");
  const prepared = {
    ...state,
    selectedTargetId: target.id,
    combatants: state.combatants.map((combatant) => combatant.id === target.id ? { ...combatant, position: { x: 2, y: 6 } } : combatant),
  };
  const rapier = cleiraOestwilde.attacks.find((attack) => attack.id === "rapier");
  const healingWord = cleiraOestwilde.spells.find((spell) => spell.id === "healing-word");
  assert.equal(abilityCheckRollMode(state, cleiraOestwilde.id, "dexterity"), "disadvantage");
  assert.equal(savingThrowRollMode(state, cleiraOestwilde.id, undefined, "normal", "dexterity"), "disadvantage");
  assert.equal(validateAttackChoice(prepared, rapier).rollMode, "disadvantage");
  assert.match(validateSpellAvailability(state, healingWord).reason, /cannot cast spells.*without training/i);
});

test("equipment calculations preserve Unarmored Defense when no armor is equipped", () => {
  assert.equal(encounterFor({ ...goliathBarbarian, armorClass: 1 }).combatants[0].baseArmorClass, 13);
});
