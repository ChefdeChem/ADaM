import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

function importedCharacter(features, overrides = {}) {
  return {
    id: "feature-text-import",
    name: "Feature Text Import",
    className: "Adventurer",
    level: 1,
    armorClass: 12,
    speedFeet: 30,
    hitPoints: { current: 10, maximum: 10 },
    proficiencyBonus: 2,
    abilities: { strength: 10, dexterity: 14, constitution: 12, intelligence: 14, wisdom: 12, charisma: 10 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { equipment: [], features },
    source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

test("Fire Resistance requires the printed fire damage type", () => {
  const fire = importedCharacter([{ name: "Fire Resistance", description: "Gold Dragon ancestry grants resistance to fire damage." }], {
    source: { format: "flattened-pdf", importedAt: "2026-09-28T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
  });
  const linked = linkVerifiedImportedMechanics(fire);
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution, { type: "damage-resistance", damageTypes: ["fire"] });
  assert.deepEqual(linked.profile?.features?.[0]?.executableValueEvidence, ["Printed resistance to fire damage."]);
  fire.profile.features[0].description = "Gold Dragon ancestry grants resistance to cold damage.";
  assert.equal(linkVerifiedImportedMechanics(fire).passiveFeatures?.length, 0);
});

test("Savage Attacker requires its once-per-turn weapon damage choice", () => {
  const savage = importedCharacter([{ name: "Savage Attacker", description: "Once per turn after a weapon hit, roll the weapon's damage dice twice and choose either result." }], {
    className: "Barbarian",
  });
  const linked = linkVerifiedImportedMechanics(savage);
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution, { type: "weapon-damage-reroll", oncePerTurn: true });
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /once-per-turn.*two weapon-damage rolls/i);
  savage.profile.features[0].description = "After a weapon hit, roll the weapon's damage dice twice and choose either result.";
  assert.equal(linkVerifiedImportedMechanics(savage).passiveFeatures?.length, 0);
});

test("Magic Initiate requires the named spell, free cast, and Long Rest recovery", () => {
  const magic = importedCharacter([{ name: "Magic Initiate (Wizard)", description: "Burning Hands can be cast once without a spell slot per Long Rest, or with an available spell slot." }], {
    className: "Paladin",
    resources: [{ id: "magic-initiate", name: "Magic Initiate Free Cast", kind: "generic", current: 1, maximum: 1, recovery: "long-rest" }],
    spells: [{ id: "burning-hands", name: "Burning Hands", level: 1, castingTime: "action", rangeFeet: 15, target: "area", requiresLineOfSight: false }],
  });
  const linked = linkVerifiedImportedMechanics(magic);
  assert.deepEqual(linked.passiveFeatures?.[0]?.resolution, { type: "free-spell-cast", spellId: "burning-hands", resourceName: "Magic Initiate Free Cast" });
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /free cast of Burning Hands.*Long-Rest/i);
  magic.profile.features[0].description = "Burning Hands can be cast once without a spell slot.";
  assert.equal(linkVerifiedImportedMechanics(magic).passiveFeatures?.length, 0);
});

test("Adrenaline Rush requires Bonus Action Dash and Proficiency Bonus temporary HP", () => {
  const rush = importedCharacter([{ name: "Adrenaline Rush", description: "Dash as a Bonus Action, gain temporary hit points equal to proficiency bonus, and spend one use." }], {
    className: "Warlock",
    resources: [{ id: "adrenaline-rush", name: "Adrenaline Rush", kind: "generic", current: 2, maximum: 2, recovery: "short-rest" }],
  });
  const linked = linkVerifiedImportedMechanics(rush);
  assert.deepEqual(linked.featureActions?.[0]?.resolution, { type: "dash-and-temporary-hit-points", temporaryHitPoints: "proficiency-bonus" });
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Bonus Action Dash.*Proficiency Bonus/i);
  rush.profile.features[0].description = "Dash as a Bonus Action and gain 5 temporary hit points.";
  assert.equal(linkVerifiedImportedMechanics(rush).featureActions?.length, 0);
});

test("Relentless Endurance requires its zero-to-one replacement boundary", () => {
  const endurance = importedCharacter([{ name: "Relentless Endurance", description: "When reduced to 0 HP but not killed outright, choose to drop to 1 HP instead and spend one use." }], {
    className: "Warlock",
    resources: [{ id: "relentless-endurance", name: "Relentless Endurance", kind: "generic", current: 1, maximum: 1, recovery: "long-rest" }],
  });
  const linked = linkVerifiedImportedMechanics(endurance);
  assert.deepEqual(linked.triggeredFeatures?.[0]?.resolution, { type: "drop-to-one-hit-point" });
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /0 Hit Point trigger.*1 Hit Point/i);
  endurance.profile.features[0].description = "When reduced to 0 HP, choose to drop to 1 HP instead and spend one use.";
  assert.equal(linkVerifiedImportedMechanics(endurance).triggeredFeatures?.length, 0);
});
