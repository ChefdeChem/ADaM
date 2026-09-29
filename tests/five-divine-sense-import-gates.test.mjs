import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

const divineSenseDescription = "As an Action, open your awareness until the end of your next turn. You know the location and type of any Celestial, Fiend, or Undead within 60 feet that is not behind Total Cover. In the same radius, you detect the presence of any place or object that has been consecrated or desecrated.";

function importedPaladin(description) {
  return {
    id: "divine-sense-import",
    name: "Divine Sense Import",
    className: "Paladin",
    level: 1,
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 11, maximum: 11 },
    proficiencyBonus: 2,
    abilities: { strength: 16, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 14 },
    resources: [{ id: "divine-sense", name: "Divine Sense", kind: "generic", current: 3, maximum: 3, recovery: "long-rest" }],
    attacks: [],
    spells: [],
    profile: { equipment: [], features: [{ name: "Divine Sense", description }] },
    source: { format: "flattened-pdf", importedAt: "2026-09-29T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
  };
}

test("Divine Sense requires its printed Action cost", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription));
  assert.equal(linked.featureActions?.[0]?.cost, "action");
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Action cost/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription.replace("As an Action, ", ""))).featureActions?.length, 0);
});

test("Divine Sense requires its printed end-of-next-turn duration", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.duration, "end-of-next-turn");
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /end-of-next-turn duration/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription.replace("until the end of your next turn", "for 1 minute"))).featureActions?.length, 0);
});

test("Divine Sense requires all three printed creature types", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription));
  assert.deepEqual(linked.featureActions?.[0]?.resolution.creatureTypes, ["celestial", "fiend", "undead"]);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /celestial, fiend, undead/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription.replace("Fiend, or ", ""))).featureActions?.length, 0);
});

test("Divine Sense requires its printed Total Cover boundary", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.blockedByTotalCover, true);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Total Cover boundary/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription.replace("that is not behind Total Cover", "regardless of cover"))).featureActions?.length, 0);
});

test("Divine Sense requires consecrated and desecrated presence detection", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription));
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /consecrated-or-desecrated/i);
  assert.equal(linkVerifiedImportedMechanics(importedPaladin(divineSenseDescription.replace(/ In the same radius,.+$/, ""))).featureActions?.length, 0);
});
