import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { importCrossReferenceChecks } from "../src/importers/cross-references.ts";
import {
  validateEquipmentInventory,
  validateEquipmentRuleLinks,
  validateFeatureDependencies,
  validateFeatureOwnershipLinks,
  validateImportedCharacter,
  validateWeaponEquipmentLinks,
} from "../src/importers/validation.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function character(overrides = {}) {
  return {
    id: "cross-reference-test",
    name: "Cross Reference Test",
    className: "Fighter",
    level: 1,
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 12, maximum: 12 },
    proficiencyBonus: 2,
    abilities: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    resources: [],
    attacks: [],
    spells: [],
    source: { format: "json", importedAt: "2026-09-20T00:00:00.000Z" },
    ...overrides,
  };
}

const provenance = { rulesetId: "dnd-2024", sourceId: "user-imported", sourceReference: "Import fixture" };

test("inventory records require unique names, usable quantities, and valid optional weights", () => {
  const imported = character({ profile: { equipment: [{ name: "Spear", quantity: 1 }, { name: "spear", quantity: -1, weightPounds: -3 }] } });
  assert.deepEqual(validateEquipmentInventory(imported).map((candidate) => candidate.code), ["duplicate-equipment-name", "invalid-equipment-quantity", "invalid-equipment-weight"]);
  assert.equal(importCrossReferenceChecks(imported).find((check) => check.id === "inventory-records").status, "blocked");
});

test("every executable equipment rule resolves to exactly one carried item", () => {
  const imported = character({ profile: { equipment: [{ name: "Shield", quantity: 1 }] }, equipmentRules: [
    { id: "shield", name: "Shield", equipped: true, description: "+2 AC", resolution: { type: "shield", armorClassBonus: 2, trainingRequiredForBenefit: true }, provenance },
    { id: "lantern", name: "Hooded Lantern", equipped: true, description: "Light", resolution: { type: "light-source", brightLightFeet: 30, dimLightFeet: 30, hoodedDimLightFeet: 5, fuelMinutes: 360, adjustmentCost: "action" }, provenance },
  ] });
  assert.deepEqual(validateEquipmentRuleLinks(imported).map((candidate) => candidate.code), ["missing-equipment-item"]);
  assert.equal(validateImportedCharacter(imported).ready, false);
});

test("weapon and ammunition rules resolve real attacks and executable inventory reaches combat", () => {
  const imported = character({
    attacks: [{ id: "crossbow", name: "Light Crossbow", kind: "ranged", attackBonus: 3, damage: "1d8 + 1 piercing", normalRangeFeet: 80, longRangeFeet: 320 }],
    profile: { equipment: [{ name: "Light Crossbow", quantity: 1 }, { name: "Bolts", quantity: 2 }] },
    equipmentRules: [
      { id: "crossbow-item", name: "Light Crossbow", equipped: true, description: "Weapon", resolution: { type: "weapon", attackIds: ["crossbow"] }, provenance },
      { id: "bolts", name: "Bolts", equipped: true, description: "Ammunition", resolution: { type: "ammunition", attackIds: ["crossbow"], expendOnAttackIds: ["crossbow"] }, provenance },
    ],
  });
  assert.deepEqual(validateWeaponEquipmentLinks(imported), []);
  const player = createEncounter(imported, generateScriptedScenario("easy crypt fight")).combatants[0];
  assert.equal(player.attacks[0].id, "crossbow");
  assert.equal(player.inventory.find((item) => item.id === "bolts").current, 2);
});

test("source feature ownership links must resolve before executable mechanics are trusted", () => {
  const imported = character({
    featureActions: [{ id: "surge", name: "Surge", cost: "bonus-action", description: "Move quickly.", resourceName: "Surge Uses", resourceCost: 1, resolution: { type: "dash-and-temporary-hit-points", temporaryHitPoints: "proficiency-bonus" }, provenance }],
    resources: [{ id: "surge-uses", name: "Surge Uses", kind: "generic", current: 1, maximum: 1, recovery: "short-rest" }],
    profile: { features: [{ name: "Surge", description: "Imported feature", executableActionId: "missing-surge", provenance }] },
  });
  assert.ok(validateFeatureOwnershipLinks(imported).some((candidate) => candidate.code === "unknown-feature-action-link" && candidate.severity === "error"));
  assert.ok(validateFeatureOwnershipLinks(imported).some((candidate) => candidate.code === "unowned-feature-action" && candidate.severity === "warning"));
});

test("feature resources and free-cast spells resolve and the review UI exposes all five gates", () => {
  const imported = character({
    passiveFeatures: [{ id: "free-ward", name: "Free Ward", description: "One free cast.", resolution: { type: "free-spell-cast", spellId: "ward", resourceName: "Ward Use" }, provenance }],
    profile: { features: [{ name: "Free Ward", description: "Imported feature", executablePassiveId: "free-ward", provenance }] },
  });
  assert.deepEqual(validateFeatureDependencies(imported).map((candidate) => candidate.code), ["missing-feature-resource", "missing-feature-spell"]);
  assert.equal(importCrossReferenceChecks(imported).find((check) => check.id === "feature-dependencies").status, "blocked");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Five equipment and feature gates/);
  assert.match(page, /Equipment and feature cross-reference checks/);
  for (const verified of BUILT_IN_CHARACTERS) assert.deepEqual(validateImportedCharacter(verified).errors, [], `${verified.name} should pass every cross-reference gate`);
});
