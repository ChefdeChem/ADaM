import assert from "node:assert/strict";
import test from "node:test";

import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";

const rageDescription = "Enter Rage as a Bonus Action if you aren't wearing Heavy Armor. While active, gain Resistance to Bludgeoning, Piercing, and Slashing damage, +2 damage on Strength attacks with a weapon or Unarmed Strike, and Advantage on Strength checks and Strength saving throws; you can't maintain Concentration, and you can't cast spells. Rage lasts until the end of your next turn, ends early if you don Heavy Armor or become Incapacitated, and extends after an attack roll against an enemy, forcing an enemy saving throw, or using a Bonus Action to extend, up to 10 minutes.";

function importedBarbarian(description) {
  return {
    id: "rage-import",
    name: "Rage Import",
    className: "Barbarian",
    level: 1,
    armorClass: 13,
    speedFeet: 35,
    hitPoints: { current: 14, maximum: 14 },
    proficiencyBonus: 2,
    abilities: { strength: 15, dexterity: 12, constitution: 14, intelligence: 8, wisdom: 13, charisma: 10 },
    resources: [{ id: "rage", name: "Rage", kind: "generic", current: 2, maximum: 2, recovery: "special", shortRestRecovery: 1, longRestRecovery: "all" }],
    attacks: [],
    spells: [],
    profile: { equipment: [], features: [{ name: "Rage", description }] },
    source: { format: "flattened-pdf", importedAt: "2026-09-29T00:00:00.000Z", editionAssessment: { edition: "dnd-2024", confidence: "high", evidence: ["Fixture"] } },
  };
}

test("Rage requires all three printed physical damage Resistances", () => {
  const linked = linkVerifiedImportedMechanics(importedBarbarian(rageDescription));
  assert.deepEqual(linked.featureActions?.[0]?.resolution.effect.modifiers.damageResistances, ["bludgeoning", "piercing", "slashing"]);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Bludgeoning, Piercing, and Slashing/i);
  assert.equal(linkVerifiedImportedMechanics(importedBarbarian(rageDescription.replace(", and Slashing", ""))).featureActions?.length, 0);
});

test("Rage requires its printed level-one Strength-attack damage bonus", () => {
  const linked = linkVerifiedImportedMechanics(importedBarbarian(rageDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.effect.modifiers.weaponDamageBonus, 2);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /\+2 Rage Damage.*Strength attacks/i);
  assert.equal(linkVerifiedImportedMechanics(importedBarbarian(rageDescription.replace("+2 damage", "+3 damage"))).featureActions?.length, 0);
});

test("Rage requires printed Advantage on Strength checks and saving throws", () => {
  const linked = linkVerifiedImportedMechanics(importedBarbarian(rageDescription));
  assert.deepEqual(linked.featureActions?.[0]?.resolution.effect.modifiers.abilityCheckAdvantages, ["strength"]);
  assert.deepEqual(linked.featureActions?.[0]?.resolution.effect.modifiers.savingThrowAdvantages, ["strength"]);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /Strength checks and Strength saving throws/i);
  assert.equal(linkVerifiedImportedMechanics(importedBarbarian(rageDescription.replace(" and Strength saving throws", ""))).featureActions?.length, 0);
});

test("Rage requires its printed Concentration and spellcasting prohibitions", () => {
  const linked = linkVerifiedImportedMechanics(importedBarbarian(rageDescription));
  assert.equal(linked.featureActions?.[0]?.resolution.effect.modifiers.preventsSpellcasting, true);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /no-Concentration and no-spellcasting/i);
  assert.equal(linkVerifiedImportedMechanics(importedBarbarian(rageDescription.replace(", and you can't cast spells", ""))).featureActions?.length, 0);
});

test("Rage requires its complete printed entry, duration, extension, and termination lifecycle", () => {
  const linked = linkVerifiedImportedMechanics(importedBarbarian(rageDescription));
  const rage = linked.featureActions?.[0];
  assert.equal(rage?.cost, "bonus-action");
  assert.equal(rage?.resolution.effect.duration, "end-of-next-turn");
  assert.equal(rage?.resolution.effect.modifiers.endsOnIncapacitated, true);
  assert.equal(rage?.resolution.effect.modifiers.rageExtension, true);
  assert.match(linked.profile?.features?.[0]?.executableValueEvidence?.join(" ") ?? "", /three extension options, and 10-minute maximum/i);
  assert.equal(linkVerifiedImportedMechanics(importedBarbarian(rageDescription.replace("up to 10 minutes", "up to 1 minute"))).featureActions?.length, 0);
});
