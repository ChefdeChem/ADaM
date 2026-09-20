import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { upsertRosterCharacter } from "../src/characters/roster.ts";
import { jsonImporter } from "../src/importers/json.ts";
import {
  expectedProficiencyBonus,
  validateAttacks,
  validateCoreStatistics,
  validateResources,
  validateSpells,
} from "../src/importers/validation.ts";

const abilities = { strength: 16, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 14 };

function character(overrides = {}) {
  return {
    id: "import-test",
    name: "Import Test",
    className: "Paladin",
    level: 1,
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 11, maximum: 11 },
    proficiencyBonus: 2,
    abilities,
    resources: [],
    attacks: [],
    spells: [],
    source: { format: "json", importedAt: "2026-09-20T00:00:00.000Z" },
    ...overrides,
  };
}

test("core-stat validation blocks impossible combat values and flags an edition-neutral proficiency mismatch", () => {
  const issues = validateCoreStatistics(character({
    level: 21,
    armorClass: 0,
    speedFeet: -5,
    hitPoints: { current: 12, maximum: 11 },
    proficiencyBonus: 9,
    abilities: { ...abilities, strength: 31 },
  }));
  assert.deepEqual(issues.filter((candidate) => candidate.severity === "error").map((candidate) => candidate.code), [
    "invalid-level",
    "invalid-armor-class",
    "invalid-speed",
    "invalid-current-hit-points",
    "invalid-strength",
  ]);
  const proficiency = validateCoreStatistics(character({ level: 5, proficiencyBonus: 2 }));
  assert.equal(expectedProficiencyBonus(5), 3);
  assert.equal(proficiency.find((candidate) => candidate.code === "unexpected-proficiency-bonus")?.severity, "warning");
});

test("attack validation catches duplicate IDs, unrollable damage, and reversed ranges", () => {
  const issues = validateAttacks([
    { id: "bow", name: "Shortbow", kind: "ranged", attackBonus: 4, damage: "1d6+2 piercing", normalRangeFeet: 80, longRangeFeet: 320 },
    { id: "bow", name: "Broken Bow", kind: "ranged", attackBonus: 4, damage: "special", normalRangeFeet: 80, longRangeFeet: 20 },
  ]);
  assert.deepEqual(issues.map((candidate) => candidate.code), ["duplicate-attack-id", "invalid-attack-damage", "invalid-long-range"]);
});

test("resource validation protects pool bounds, recovery schedules, and spell-slot levels", () => {
  const issues = validateResources([
    { id: "slot", name: "Level 10 Slot", kind: "spell-slot", level: 10, current: 2, maximum: 1, recovery: "long-rest" },
    { id: "slot", name: "Duplicate", kind: "generic", current: 1, maximum: 1, recovery: "short-rest" },
  ]);
  assert.deepEqual(issues.map((candidate) => candidate.code), ["invalid-resource-current", "invalid-spell-slot-level", "duplicate-resource-id"]);
});

test("spell validation blocks incomplete mechanics while preserving unverified user provenance as a warning", () => {
  const issues = validateSpells([
    { id: "spark", name: "Spark", level: 0, castingTime: "action", rangeFeet: 60, target: "single", requiresLineOfSight: true, damage: "1d10 fire" },
    { id: "spark", name: "Broken Spark", level: 12, castingTime: "action", rangeFeet: -1, target: "single", requiresLineOfSight: true, damage: "DM decides" },
  ]);
  assert.ok(issues.some((candidate) => candidate.code === "unverified-spell-provenance" && candidate.severity === "warning"));
  assert.deepEqual(issues.filter((candidate) => candidate.severity === "error").map((candidate) => candidate.code), [
    "duplicate-spell-id",
    "invalid-spell-level",
    "invalid-spell-range",
    "invalid-spell-damage",
  ]);
});

test("same-file re-import preserves declared provenance, replaces the roster record, and exposes validation blockers in the review UI", async () => {
  const firstPayload = character({
    id: "first-id",
    source: { format: "flattened-pdf", fileName: "original.pdf", importedAt: "2026-09-01T00:00:00.000Z" },
  });
  const secondPayload = character({
    id: "second-id",
    hitPoints: { current: 12, maximum: 12 },
    source: { format: "flattened-pdf", fileName: "original.pdf", importedAt: "2026-09-02T00:00:00.000Z" },
  });
  const first = await jsonImporter.import(new File([JSON.stringify(firstPayload)], "surina.json", { type: "application/json" }));
  const second = await jsonImporter.import(new File([JSON.stringify(secondPayload)], "surina.json", { type: "application/json" }));
  assert.equal(first.character.source.importKey, second.character.source.importKey);
  assert.deepEqual(first.character.source.declaredSource, firstPayload.source);
  const initial = upsertRosterCharacter([], first.character);
  const replaced = upsertRosterCharacter(initial.characters, second.character);
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.characters.length, 1);
  assert.equal(replaced.characters[0].id, "first-id");
  assert.deepEqual(replaced.characters[0].hitPoints, { current: 12, maximum: 12 });

  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Fix before combat/);
  assert.match(page, /disabled={!importValidation\?\.ready}/);
  assert.match(page, /re-imported and updated/);
});
