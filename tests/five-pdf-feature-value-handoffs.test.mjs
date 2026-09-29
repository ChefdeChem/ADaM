import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

function importedCharacter(features, overrides = {}) {
  return {
    id: "feature-value-import",
    name: "Feature Value Import",
    className: "Paladin",
    level: 1,
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 11, maximum: 11 },
    proficiencyBonus: 2,
    abilities: { strength: 17, dexterity: 8, constitution: 13, intelligence: 12, wisdom: 10, charisma: 15 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { equipment: [], features },
    source: { format: "flattened-pdf", importedAt: "2026-09-21T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

const breathDescription = "Once per short rest, creatures in a 20-foot cone make a DC 14 Dexterity save; 3d6 fire damage on a failure and half on a success.";

test("hands an explicit printed save DC to the verified feature without accepting a mismatched save ability", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Breath Weapon (Gold)", description: breathDescription }]));
  assert.equal(linked.featureActions?.[0]?.resolution.type, "area-saving-throw");
  assert.equal(linked.featureActions?.[0]?.resolution.save.dc, 14);
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Breath Weapon (Gold)", description: breathDescription.replace("Dexterity", "Constitution") }]));
  assert.equal(mismatch.featureActions?.length, 0);
});

test("hands an explicit printed damage formula to the verified feature without changing its verified damage type", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Breath Weapon (Gold)", description: breathDescription }]));
  assert.equal(linked.featureActions?.[0]?.resolution.type, "area-saving-throw");
  assert.equal(linked.featureActions?.[0]?.resolution.damage, "3d6 fire");
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Breath Weapon (Gold)", description: breathDescription.replace("fire", "cold") }]));
  assert.equal(mismatch.featureActions?.length, 0);
});

test("hands explicit area geometry to the verified feature and rejects a different shape", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Breath Weapon (Gold)", description: breathDescription }]));
  assert.equal(linked.featureActions?.[0]?.resolution.type, "area-saving-throw");
  assert.deepEqual(linked.featureActions?.[0]?.resolution.area, { origin: "self", shape: "cone", sizeFeet: 20, affects: "all-creatures" });
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Breath Weapon (Gold)", description: breathDescription.replace("cone", "line") }]));
  assert.equal(mismatch.featureActions?.length, 0);
});

test("hands an explicit printed sense range to Divine Sense and leaves a missing range descriptive", () => {
  const description = "Three uses per long rest. As an Action, until the end of your next turn, sense Celestials, Fiends, and Undead within 90 feet that are not behind Total Cover, plus any place or object that is consecrated or desecrated.";
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Divine Sense", description }]));
  assert.equal(linked.featureActions?.[0]?.resolution.type, "sense-creature-types");
  assert.equal(linked.featureActions?.[0]?.resolution.rangeFeet, 90);
  const missing = linkVerifiedImportedMechanics(importedCharacter([{ name: "Divine Sense", description: description.replace(" within 90 feet", "") }]));
  assert.equal(missing.featureActions?.length, 0);
});

test("hands printed Bardic Inspiration range and die scaling to play and shows the evidence during review", async () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Bardic Inspiration", description: "Four uses per long rest. As a Bonus Action, grant another creature within 30 feet a d8 inspiration die." },
  ], { className: "Bard", level: 5, resources: [{ id: "bardic-inspiration", name: "Bardic Inspiration", kind: "generic", current: 4, maximum: 4, recovery: "long-rest" }] }));
  assert.equal(linked.featureActions?.[0]?.resolution.type, "grant-roll-bonus");
  assert.deepEqual({ rangeFeet: linked.featureActions?.[0]?.resolution.rangeFeet, die: linked.featureActions?.[0]?.resolution.die }, { rangeFeet: 30, die: "1d8" });
  assert.deepEqual(linked.profile?.features?.[0]?.executableValueEvidence, ["Printed range 30 feet.", "Printed bonus die 1d8."]);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Sheet-backed executable values/);
  assert.match(page, /Feature values and passive effects execute only when the sheet states them explicitly/);
});
