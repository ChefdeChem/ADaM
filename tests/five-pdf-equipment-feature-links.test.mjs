import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { consumeAttackInventory } from "../src/engine/inventory.ts";
import { parseDndBeyondTokens } from "../src/importers/dnd-beyond.ts";
import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function importedCharacter(overrides = {}) {
  return {
    id: "linked-import",
    name: "Linked Import",
    className: "Adventurer",
    level: 1,
    armorClass: 12,
    speedFeet: 30,
    hitPoints: { current: 10, maximum: 10 },
    proficiencyBonus: 2,
    abilities: { strength: 10, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { equipment: [], features: [] },
    source: { format: "flattened-pdf", importedAt: "2026-09-21T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

const scenario = () => generateScriptedScenario("easy crypt fight");

test("links an explicitly carried weapon only to matching imported attacks", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({
    attacks: [
      { id: "dagger-melee", name: "Dagger", kind: "melee", attackBonus: 4, damage: "1d4 + 2 piercing", normalRangeFeet: 5 },
      { id: "unrelated", name: "Club", kind: "melee", attackBonus: 2, damage: "1d4 bludgeoning", normalRangeFeet: 5 },
    ],
    profile: { equipment: [{ name: "Dagger", quantity: 2 }], features: [] },
  }));
  const dagger = linked.equipmentRules.find((rule) => rule.name === "Dagger");
  assert.deepEqual(dagger?.resolution.attackIds, ["dagger-melee"]);
  assert.equal(dagger?.provenance.sourceId, "srd-5.1");
  assert.equal(linked.equipmentRules.some((rule) => rule.name === "Club"), false);
});

test("a verified thrown-weapon link expends one carried copy without removing remaining attacks", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({
    attacks: [
      { id: "dagger-melee", name: "Dagger", kind: "melee", attackBonus: 4, damage: "1d4 + 2 piercing", normalRangeFeet: 5 },
      { id: "dagger-thrown", name: "Thrown Dagger", kind: "ranged", attackBonus: 4, damage: "1d4 + 2 piercing", normalRangeFeet: 20, longRangeFeet: 60 },
    ],
    profile: { equipment: [{ name: "Dagger", quantity: 2 }], features: [] },
  }));
  const encounter = createPlayableEncounter(linked, scenario());
  const after = consumeAttackInventory(encounter, linked.id, "dagger-thrown");
  const actor = after.combatants.find((combatant) => combatant.id === linked.id);
  assert.equal(actor?.inventory.find((item) => item.name === "Dagger")?.current, 1);
  assert.deepEqual(actor?.attacks.map((attack) => attack.id).sort(), ["dagger-melee", "dagger-thrown"].sort());
});

test("verified ammunition links expend ammunition but preserve the carried launcher", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({
    attacks: [{ id: "crossbow-shot", name: "Light Crossbow", kind: "ranged", attackBonus: 4, damage: "1d8 + 2 piercing", normalRangeFeet: 80, longRangeFeet: 320 }],
    profile: { equipment: [{ name: "Light Crossbow", quantity: 1 }, { name: "Crossbow Bolts", quantity: 20 }], features: [] },
  }));
  const encounter = createPlayableEncounter(linked, scenario());
  const after = consumeAttackInventory(encounter, linked.id, "crossbow-shot");
  const inventory = after.combatants.find((combatant) => combatant.id === linked.id)?.inventory ?? [];
  assert.equal(inventory.find((item) => item.name === "Crossbow Bolts")?.current, 19);
  assert.equal(inventory.find((item) => item.name === "Light Crossbow")?.current, 1);
});

test("explicit armor training plus printed AC uniquely activates imported armor and shield defense", () => {
  const tokens = [
    "ABILITY SAVE DC", "Armor", "Reader", "Paladin", "1", "Player", "Human", "Guard", "(Milestone)",
    "15", "+2", "10", "+0", "14", "+2", "8", "-1", "12", "+1", "14", "+2",
    "+2", "+0", "+2", "-1", "+1", "+4", "P", "+4", "CHA", "+0", "DEX", "+2", "CON", "+2", "STR", "+1", "WIS", "-1", "INT",
    "18", "10", "12", "+2", "16", "+2", "30", "ft.", "(Walking)", "12", "--", "1d10",
    "Longsword", "+4", "1d8+2", "Slashing",
    "EQUIPMENT", "Chain Mail", "1", "Shield", "1",
    "PROFICIENCIES", "ARMOR", "Heavy Armor, Shields", "WEAPONS", "Martial Weapons, Simple Weapons",
  ];
  const parsed = parseDndBeyondTokens(tokens);
  assert.deepEqual(parsed?.profile.proficiencies?.armor, ["Heavy Armor", "Shields"]);
  const linked = linkVerifiedImportedMechanics(importedCharacter({
    armorClass: 18,
    abilities: { strength: 15, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 14 },
    source: { format: "flattened-pdf", importedAt: "2026-09-21T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } },
    profile: { equipment: [{ name: "Chain Mail", quantity: 1 }, { name: "Shield", quantity: 1 }], features: [], proficiencies: { armor: ["Heavy Armor", "Shields"], weapons: [], tools: [], languages: [] } },
  }));
  assert.deepEqual(linked.equipmentRules.filter((rule) => rule.equipped).map((rule) => rule.name).sort(), ["Chain Mail", "Shield"]);
  const actor = createPlayableEncounter(linked, scenario()).combatants.find((combatant) => combatant.id === linked.id);
  assert.equal(actor?.baseArmorClass, 18);
  assert.equal(actor?.hasEquippedShield, true);
});

test("links only dependency-ready official features and exposes the boundary in import review", async () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({
    profile: { equipment: [], features: [
      { name: "Fire Resistance", description: "Printed on the imported sheet." },
      { name: "Unverified Gift", description: "User-provided descriptive feature." },
    ] },
  }));
  assert.deepEqual(linked.passiveFeatures.map((feature) => feature.name), ["Fire Resistance"]);
  assert.equal(linked.profile.features[0].executablePassiveId, "fire-resistance");
  assert.equal(linked.profile.features[1].executablePassiveId, undefined);
  const actor = createPlayableEncounter(linked, scenario()).combatants.find((combatant) => combatant.id === linked.id);
  assert.deepEqual(actor?.damageResistances, ["fire"]);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Verified import links/);
  assert.match(page, /Unmatched records remain descriptive/);
});
