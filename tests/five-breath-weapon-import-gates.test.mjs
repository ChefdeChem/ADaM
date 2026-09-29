import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

const breathDescription = "Once per short rest, use your Action to exhale fire in a 15-foot cone. Each creature in the area makes a DC 11 Dexterity save, taking 2d6 fire damage on a failed save and half as much damage on a successful one.";

function importedDragonborn(description) {
  return {
    id: "breath-weapon-import",
    name: "Imported Dragonborn",
    className: "Paladin",
    level: 1,
    rulesetId: "dnd-2014",
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 11, maximum: 11 },
    proficiencyBonus: 2,
    abilities: { strength: 17, dexterity: 8, constitution: 13, intelligence: 12, wisdom: 10, charisma: 15 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { features: [{ name: "Breath Weapon (Gold)", description }] },
    source: { format: "flattened-pdf", importedAt: "2026-09-29T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
  };
}

function linked(description = breathDescription) {
  return linkVerifiedImportedMechanics(importedDragonborn(description));
}

test("Breath Weapon requires its printed Action cost", () => {
  const accepted = linked();
  assert.equal(accepted.featureActions?.[0]?.cost, "action");
  assert.match(accepted.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Action cost/i);
  assert.equal(linked(breathDescription.replace("use your Action to ", "")).featureActions?.length, 0);
});

test("Breath Weapon requires a self-origin exhalation", () => {
  const accepted = linked();
  assert.equal(accepted.featureActions?.[0]?.resolution.area.origin, "self");
  assert.match(accepted.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /self-origin exhalation/i);
  assert.equal(linked(breathDescription.replace("your Action to exhale", "your Action to emit from a point")).featureActions?.length, 0);
});

test("Breath Weapon requires every creature in the area to save", () => {
  const accepted = linked();
  assert.equal(accepted.featureActions?.[0]?.resolution.area.affects, "all-creatures");
  assert.match(accepted.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /every-creature area targeting/i);
  assert.equal(linked(breathDescription.replace("Each creature in the area", "One enemy in the area")).featureActions?.length, 0);
});

test("Breath Weapon requires full damage on a failed save", () => {
  const accepted = linked();
  assert.equal(accepted.featureActions?.[0]?.resolution.damage, "2d6 fire");
  assert.match(accepted.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /full damage on a failed save/i);
  assert.equal(linked(breathDescription.replace(" on a failed save", "")).featureActions?.length, 0);
});

test("Breath Weapon requires half damage on a successful save", () => {
  const accepted = linked();
  assert.equal(accepted.featureActions?.[0]?.resolution.save.damageOnSuccess, "half");
  assert.match(accepted.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /half damage on a successful save/i);
  assert.equal(linked(breathDescription.replace("half as much damage on a successful one", "no damage on a successful one")).featureActions?.length, 0);
});
