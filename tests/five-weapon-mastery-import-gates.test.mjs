import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

const slowDescription = "After hitting and damaging a creature with a javelin, you can reduce its Speed by 10 feet until the start of your next turn. Repeated Slow hits cannot make the Speed reduction exceed 10 feet.";
const sapDescription = "After hitting a creature with a longsword, that creature has Disadvantage on its next attack roll before the start of your next turn.";

function importedPaladin(features) {
  return {
    id: "mastery-import",
    name: "Imported Paladin",
    className: "Paladin",
    level: 1,
    rulesetId: "dnd-2024",
    armorClass: 18,
    speedFeet: 30,
    hitPoints: { current: 12, maximum: 12 },
    proficiencyBonus: 2,
    abilities: { strength: 15, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 12, charisma: 14 },
    savingThrowModifiers: { strength: 2, dexterity: 0, constitution: 2, intelligence: 0, wisdom: 3, charisma: 4 },
    resources: [],
    attacks: [
      { id: "sheet-javelin-melee", name: "Javelin", kind: "melee", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 5 },
      { id: "sheet-javelin-ranged", name: "Thrown Javelin", kind: "ranged", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 30, longRangeFeet: 120 },
      { id: "sheet-longsword", name: "Longsword", kind: "melee", attackBonus: 4, damage: "1d8 + 2 slashing", normalRangeFeet: 5 },
    ],
    profile: { features },
    source: { format: "flattened-pdf", importedAt: "2026-09-29T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } },
  };
}

function slowFeature(description = slowDescription) {
  return { id: "imported-slow", name: "Javelin Mastery (Slow)", description };
}

function sapFeature(description = sapDescription) {
  return { id: "imported-sap", name: "Longsword Mastery (Sap)", description };
}

test("links exact imported weapon identities and records verified mastery ownership", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin([slowFeature(), sapFeature()]));
  assert.deepEqual(linked.profile.features[0].executableAttackIds, ["sheet-javelin-melee", "sheet-javelin-ranged"]);
  assert.deepEqual(linked.profile.features[1].executableAttackIds, ["sheet-longsword"]);
  for (const attack of linked.attacks) {
    assert.equal(attack.masteryOwnership, "granted");
    assert.equal(attack.masteryProvenance?.sourceId, "srd-5.2.1");
  }
  assert.equal(linked.attacks.find((attack) => attack.id === "sheet-javelin-melee").mastery, "slow");
  assert.equal(linked.attacks.find((attack) => attack.id === "sheet-longsword").mastery, "sap");
});

test("requires Slow's damaging-hit trigger before enabling the rider", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin([slowFeature(slowDescription.replace("hitting and damaging", "targeting"))]));
  assert.equal(linked.profile.features[0].executableAttackIds, undefined);
  assert.equal(linked.attacks.some((attack) => attack.mastery === "slow"), false);
});

test("requires Slow's optional 10-foot reduction and start-of-next-turn duration", () => {
  for (const description of [
    slowDescription.replace("you can reduce", "you reduce"),
    slowDescription.replace("10 feet until the start of your next turn", "15 feet until the end of your next turn"),
  ]) {
    const linked = linkVerifiedImportedMechanics(importedPaladin([slowFeature(description)]));
    assert.equal(linked.profile.features[0].executableAttackIds, undefined);
    assert.equal(linked.attacks.some((attack) => attack.mastery === "slow"), false);
  }
});

test("requires Slow's 10-foot cap across repeated hits", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin([slowFeature(slowDescription.replace("Repeated Slow hits cannot make the Speed reduction exceed 10 feet.", "Repeated hits stack."))]));
  assert.equal(linked.profile.features[0].executableAttackIds, undefined);
  assert.equal(linked.attacks.some((attack) => attack.mastery === "slow"), false);
});

test("requires Sap's hit trigger, next-attack Disadvantage, and start-of-next-turn boundary", () => {
  const linked = linkVerifiedImportedMechanics(importedPaladin([sapFeature()]));
  assert.equal(linked.attacks.find((attack) => attack.id === "sheet-longsword").mastery, "sap");
  assert.match(linked.profile.features[0].executableValueEvidence.join(" "), /next attack roll/i);
  for (const description of [
    sapDescription.replace("hitting", "targeting"),
    sapDescription.replace("next attack roll", "saving throw"),
    sapDescription.replace("before the start of your next turn", "until the end of its next turn"),
  ]) {
    const rejected = linkVerifiedImportedMechanics(importedPaladin([sapFeature(description)]));
    assert.equal(rejected.profile.features[0].executableAttackIds, undefined);
    assert.equal(rejected.attacks.some((attack) => attack.mastery === "sap"), false);
  }
});
