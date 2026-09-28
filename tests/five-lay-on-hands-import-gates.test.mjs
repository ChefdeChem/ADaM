import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

const legacyDescription = "As an Action, touch a creature and draw power from the Lay on Hands pool to restore Hit Points. Spend 5 Hit Points from the pool to cure one disease or neutralize one poison. This feature has no effect on Undead and Constructs.";
const currentDescription = "As a Bonus Action, touch a creature and draw power from the Lay On Hands pool to restore Hit Points. Spend 5 Hit Points from the pool to remove the Poisoned condition.";

function importedPaladin(edition, description) {
  const current = edition === "dnd-2024";
  return {
    id: `lay-on-hands-${edition}`,
    name: `Lay On Hands ${edition}`,
    className: "Paladin",
    level: 1,
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 11, maximum: 11 },
    proficiencyBonus: 2,
    abilities: { strength: 16, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 14 },
    resources: [{
      id: "lay-on-hands-pool",
      name: current ? "Lay On Hands: Healing Pool" : "Lay on Hands Pool",
      kind: "generic",
      current: 5,
      maximum: 5,
      recovery: "long-rest",
    }],
    attacks: [],
    spells: [],
    profile: { equipment: [], features: [{ name: "Lay on Hands", description }] },
    source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition, confidence: "high", evidence: ["Fixture"] } },
  };
}

test("legacy Lay on Hands requires printed Action-cost touch healing", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin("dnd-2014", legacyDescription));
  assert.equal(linked.featureActions?.[0]?.cost, "action");
  assert.equal(linked.featureActions?.[0]?.resolution.type, "healing-pool");
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.[0] ?? "", /Action-cost touch healing/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin("dnd-2014", legacyDescription.replace("As an Action, ", ""))).featureActions?.length, 0);
});

test("legacy Lay on Hands requires the Undead and Construct exclusions", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin("dnd-2014", legacyDescription));
  assert.deepEqual(linked.featureActions?.[0]?.resolution.excludedCreatureTypes, ["undead", "construct"]);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Undead and Constructs/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin("dnd-2014", legacyDescription.replace(" and Constructs", ""))).featureActions?.length, 0);
});

test("legacy Lay on Hands requires the five-point disease-or-poison option", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin("dnd-2014", legacyDescription));
  assert.deepEqual(linked.featureActions?.[0]?.resolution.removesAfflictions, ["disease", "poison"]);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /5-point.*disease.*poison/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin("dnd-2014", legacyDescription.replace("5 Hit Points", "4 Hit Points"))).featureActions?.length, 0);
});

test("current Lay On Hands requires printed Bonus Action touch healing", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin("dnd-2024", currentDescription));
  assert.equal(linked.featureActions?.[0]?.cost, "bonus-action");
  assert.equal(linked.featureActions?.[0]?.resolution.type, "healing-pool");
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.[0] ?? "", /Bonus Action touch healing/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin("dnd-2024", currentDescription.replace("As a Bonus Action, ", ""))).featureActions?.length, 0);
});

test("current Lay On Hands requires five-point Poisoned removal", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin("dnd-2024", currentDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.removesPoisoned, true);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /5-point Poisoned-condition removal/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin("dnd-2024", currentDescription.replace("5 Hit Points", "4 Hit Points"))).featureActions?.length, 0);
});
