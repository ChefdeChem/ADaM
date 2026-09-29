import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

const bardicInspirationDescription = "As a Bonus Action, choose one creature other than yourself within 60 feet who can hear you. That creature gains one d6 Bardic Inspiration die. Within the next 10 minutes, it can add the die to one ability check, attack roll, or saving throw.";

function importedBard(description) {
  return {
    id: "bardic-inspiration-import",
    name: "Bardic Inspiration Import",
    className: "Bard",
    level: 1,
    armorClass: 13,
    speedFeet: 30,
    hitPoints: { current: 10, maximum: 10 },
    proficiencyBonus: 2,
    abilities: { strength: 8, dexterity: 15, constitution: 14, intelligence: 13, wisdom: 10, charisma: 15 },
    resources: [{ id: "bardic-inspiration", name: "Bardic Inspiration", kind: "generic", current: 2, maximum: 2, recovery: "long-rest" }],
    attacks: [],
    spells: [],
    profile: { equipment: [], features: [{ name: "Bardic Inspiration", description }] },
    source: { format: "flattened-pdf", importedAt: "2026-09-29T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
  };
}

test("Bardic Inspiration requires its printed Bonus Action cost", () => {
  const linked = linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription));
  assert.equal(linked.featureActions?.[0]?.cost, "bonus-action");
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Bonus Action cost/i);
  assert.equal(linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription.replace("As a Bonus Action, ", ""))).featureActions?.length, 0);
});

test("Bardic Inspiration requires another-creature targeting that excludes the bard", () => {
  const linked = linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.excludesSelf, true);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /another-creature target.*excludes the bard/i);
  assert.equal(linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription.replace("one creature other than yourself", "yourself"))).featureActions?.length, 0);
});

test("Bardic Inspiration requires a target who can hear the bard", () => {
  const linked = linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.requiresHearing, true);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /target can hear the bard/i);
  assert.equal(linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription.replace(" who can hear you", ""))).featureActions?.length, 0);
});

test("Bardic Inspiration requires all three eligible roll types", () => {
  const linked = linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription));
  assert.deepEqual(linked.featureActions?.[0]?.resolution.appliesTo, ["ability-check", "attack-roll", "saving-throw"]);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /ability check, attack roll, saving throw/i);
  assert.equal(linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription.replace(", or saving throw", ""))).featureActions?.length, 0);
});

test("Bardic Inspiration requires its printed 10-minute duration", () => {
  const linked = linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.durationRounds, 100);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /10 minutes \(100 rounds\)/i);
  assert.equal(linkVerifiedImportedMechanics(importedBard(bardicInspirationDescription.replace("10 minutes", "1 minute"))).featureActions?.length, 0);
});
