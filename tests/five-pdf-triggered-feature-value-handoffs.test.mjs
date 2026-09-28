import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

function importedCharacter(features, overrides = {}) {
  return {
    id: "trigger-value-import",
    name: "Trigger Value Import",
    className: "Barbarian",
    level: 1,
    armorClass: 13,
    speedFeet: 30,
    hitPoints: { current: 14, maximum: 14 },
    proficiencyBonus: 2,
    abilities: { strength: 14, dexterity: 12, constitution: 15, intelligence: 8, wisdom: 12, charisma: 10 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { equipment: [], features },
    source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

test("Stone's Endurance preserves its verified reduction die", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Stone's Endurance", description: "Twice per long rest, react after taking damage to reduce it by 1d12 + your Constitution modifier." },
  ], { resources: [{ id: "stones-endurance", name: "Stone's Endurance", kind: "generic", current: 2, maximum: 2, recovery: "long-rest" }] }));
  assert.equal(linked.triggeredFeatures?.[0]?.resolution.type, "reduce-damage-by-roll");
  assert.equal(linked.triggeredFeatures?.[0]?.resolution.die, "1d12");
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Stone's Endurance", description: "Twice per long rest, react after taking damage to reduce it by 1d10 + your Constitution modifier." },
  ], { resources: [{ id: "stones-endurance", name: "Stone's Endurance", kind: "generic", current: 2, maximum: 2, recovery: "long-rest" }] }));
  assert.equal(mismatch.triggeredFeatures?.length, 0);
});

test("Stone's Endurance derives its modifier from the imported Constitution score", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Stone's Endurance", description: "Twice per long rest, react after taking damage to reduce it by 1d12 + your Constitution modifier." },
  ], { abilities: { strength: 14, dexterity: 12, constitution: 18, intelligence: 8, wisdom: 12, charisma: 10 }, resources: [{ id: "stones-endurance", name: "Stone's Endurance", kind: "generic", current: 2, maximum: 2, recovery: "long-rest" }] }));
  assert.equal(linked.triggeredFeatures?.[0]?.resolution.type, "reduce-damage-by-roll");
  assert.equal(linked.triggeredFeatures?.[0]?.resolution.modifier, 4);
  assert.deepEqual(linked.profile?.features?.[0]?.executableValueEvidence, ["Printed reduction die 1d12.", "Imported Constitution modifier +4."]);
});

test("Dark One's Blessing derives temporary Hit Points from imported Warlock level and Charisma", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Dark One's Blessing", description: "When you reduce a hostile creature to 0 HP, gain temporary HP equal to your Charisma modifier + your Warlock level." },
  ], { className: "Warlock", level: 5, abilities: { strength: 8, dexterity: 12, constitution: 14, intelligence: 12, wisdom: 10, charisma: 18 }, source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } } }));
  assert.equal(linked.triggeredFeatures?.[0]?.resolution.type, "gain-temporary-hit-points");
  assert.equal(linked.triggeredFeatures?.[0]?.resolution.amount, 9);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Warlock level 5.*Charisma modifier \+4.*Hit Points 9/);
});

const largeFormDescription = "Starting at level 5, become Large for 10 minutes, gain advantage on Strength checks, and increase Speed by 10 feet.";
const largeFormCharacter = (description = largeFormDescription) => importedCharacter([{ name: "Large Form", description }], {
  level: 5,
  resources: [{ id: "large-form", name: "Large Form", kind: "generic", current: 1, maximum: 1, recovery: "long-rest" }],
});

test("Large Form requires the verified printed level gate and duration", () => {
  const linked = linkVerifiedImportedMechanics(largeFormCharacter());
  assert.equal(linked.featureActions?.[0]?.resolution.type, "activate-large-form");
  assert.deepEqual({ minimumLevel: linked.featureActions?.[0]?.resolution.minimumLevel, durationRounds: linked.featureActions?.[0]?.resolution.durationRounds }, { minimumLevel: 5, durationRounds: 100 });
  assert.equal(linkVerifiedImportedMechanics(largeFormCharacter(largeFormDescription.replace("level 5", "level 4"))).featureActions?.length, 0);
  assert.equal(linkVerifiedImportedMechanics(largeFormCharacter(largeFormDescription.replace("10 minutes", "1 minute"))).featureActions?.length, 0);
});

test("Large Form requires its verified printed Speed bonus and exposes all three values for review", async () => {
  const linked = linkVerifiedImportedMechanics(largeFormCharacter());
  assert.equal(linked.featureActions?.[0]?.resolution.type, "activate-large-form");
  assert.equal(linked.featureActions?.[0]?.resolution.speedBonusFeet, 10);
  assert.deepEqual(linked.profile?.features?.[0]?.executableValueEvidence, ["Printed level requirement 5.", "Printed duration 10 minutes.", "Printed Speed bonus 10 feet."]);
  assert.equal(linkVerifiedImportedMechanics(largeFormCharacter(largeFormDescription.replace("10 feet", "15 feet"))).featureActions?.length, 0);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Sheet-backed executable values/);
});
