import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

function importedCharacter(features, overrides = {}) {
  return {
    id: "passive-import",
    name: "Passive Import",
    className: "Bard",
    level: 1,
    armorClass: 12,
    speedFeet: 30,
    hitPoints: { current: 10, maximum: 10 },
    proficiencyBonus: 2,
    abilities: { strength: 10, dexterity: 14, constitution: 12, intelligence: 10, wisdom: 12, charisma: 14 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { equipment: [], features },
    source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

const feyAncestry = "Advantage on saving throws against being charmed; magic cannot put you to sleep.";

test("Fey Ancestry requires printed Advantage on saves against Charmed", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Fey Ancestry", description: feyAncestry }]));
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution.savingThrowAdvantageAgainstConditions, ["charmed"]);
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Fey Ancestry", description: "Magic cannot put you to sleep." }]));
  assert.equal(mismatch.passiveFeatures?.length, 0);
});

test("Fey Ancestry requires printed immunity to magical sleep", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Fey Ancestry", description: feyAncestry }]));
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution.conditionImmunities, ["magical sleep"]);
  assert.deepEqual(linked.profile?.features?.[0]?.executableValueEvidence, ["Printed Advantage on saves against Charmed.", "Printed immunity to magical sleep."]);
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Fey Ancestry", description: "Advantage on saving throws against being charmed." }]));
  assert.equal(mismatch.passiveFeatures?.length, 0);
});

test("Keen Senses requires printed Perception proficiency", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Keen Senses", description: "You are proficient in Perception." }]));
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution, { type: "skill-proficiency", skill: "Perception", ability: "wisdom" });
  assert.deepEqual(linked.profile?.features?.[0]?.executableValueEvidence, ["Printed proficiency in Perception."]);
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Keen Senses", description: "You are proficient in Investigation." }]));
  assert.equal(mismatch.passiveFeatures?.length, 0);
});

test("Trance requires the printed four-hour semiconscious sleep alternative", () => {
  const description = "You do not need to sleep and instead meditate semiconsciously for 4 hours each day.";
  const linked = linkVerifiedImportedMechanics(importedCharacter([{ name: "Trance", description }]));
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution, { type: "rest-alternative", sleepRequired: false, meditationHours: 4, semiconscious: true });
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /sleep alternative.*4 hours/i);
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([{ name: "Trance", description: description.replace("4 hours", "8 hours") }]));
  assert.equal(mismatch.passiveFeatures?.length, 0);
});

test("Barbarian Unarmored Defense derives Dexterity, Constitution, and Shield compatibility", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Unarmored Defense", description: "While not wearing armor, your base AC is 15 plus any Shield bonus." },
  ], {
    className: "Barbarian",
    armorClass: 15,
    abilities: { strength: 16, dexterity: 16, constitution: 14, intelligence: 8, wisdom: 10, charisma: 10 },
    source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } },
  }));
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution, { type: "unarmored-defense", abilityModifiers: ["dexterity", "constitution"], allowsShield: true });
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Dexterity modifier \+3.*Constitution modifier \+2.*base AC 15.*Shield/i);
  const mismatch = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Unarmored Defense", description: "While not wearing armor, your base AC is 14 plus any Shield bonus." },
  ], { className: "Barbarian", source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } } }));
  assert.equal(mismatch.passiveFeatures?.length, 0);
});
