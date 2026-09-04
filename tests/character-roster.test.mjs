import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { goliathBarbarian, irvenWeber, pharos, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { mergeBuiltInCharacters } from "../src/characters/roster.ts";
import { rollDamage } from "../src/engine/dice.ts";

test("Cleira is the first extracted built-in roster character", () => {
  const roster = mergeBuiltInCharacters([]);
  assert.equal(roster[0].id, "cleira-oestwilde");
  assert.equal(roster[0].rulesetId, "dnd-2014");
  assert.equal(roster[0].armorClass, 13);
  assert.deepEqual(roster[0].hitPoints, { current: 10, maximum: 10 });
  assert.equal(roster[0].resources.find((resource) => resource.id === "spell-slot-1").maximum, 2);
  assert.equal(roster[0].spells.length, 7);
  assert.equal(roster[0].spells.find((spell) => spell.id === "healing-word").unsupportedReason, undefined);
  const viciousMockery = roster[0].spells.find((spell) => spell.id === "vicious-mockery");
  assert.equal(viciousMockery.unsupportedReason, undefined);
  assert.equal(viciousMockery.effect.consumeOnAttackRoll, true);
});

test("Cleira's flat unarmed damage resolves as zero", () => {
  const unarmed = cleiraOestwilde.attacks.find((attack) => attack.id === "unarmed-strike");
  const roll = rollDamage(unarmed.damage, { random: () => 0.99 });
  assert.ok(roll);
  assert.equal(roll.total, 0);
  assert.equal(roll.formula.damageType, "bludgeoning");
});

test("the five verified PDFs seed the complete encounter roster", () => {
  const roster = mergeBuiltInCharacters([]);
  assert.equal(BUILT_IN_CHARACTERS.length, 5);
  assert.equal(roster.length, 5);
  assert.deepEqual(roster.map((character) => character.id), [
    "cleira-oestwilde",
    "surina-daardendrian",
    "goliath-barbarian",
    "irven-weber",
    "pharos",
  ]);
  assert.ok(roster.every((character) => character.source.format === "flattened-pdf"));
});

test("verified martial profiles preserve core defenses and legal weapon ranges", () => {
  assert.deepEqual(surinaDaardendrian.hitPoints, { current: 11, maximum: 11 });
  assert.equal(surinaDaardendrian.armorClass, 16);
  assert.equal(surinaDaardendrian.attacks.find((attack) => attack.id === "glaive").normalRangeFeet, 10);

  assert.equal(goliathBarbarian.rulesetId, "dnd-2024");
  assert.equal(goliathBarbarian.speedFeet, 35);
  assert.equal(goliathBarbarian.attacks.find((attack) => attack.id === "thrown-spear").longRangeFeet, 60);

  assert.equal(irvenWeber.className, "Paladin");
  assert.equal(irvenWeber.armorClass, 18);
  assert.equal(irvenWeber.attacks.find((attack) => attack.id === "thrown-javelin").normalRangeFeet, 30);
});

test("verified spellcasters preserve slots while exposing executable spell slices", () => {
  assert.equal(irvenWeber.resources.find((resource) => resource.id === "spell-slot-1").maximum, 2);
  assert.equal(irvenWeber.spells.find((spell) => spell.id === "burning-hands").area.shape, "cone");

  assert.equal(pharos.profile.spellcasting.saveDc, 13);
  assert.equal(pharos.resources.find((resource) => resource.id === "spell-slot-1").recovery, "short-rest");
  assert.equal(pharos.attacks.find((attack) => attack.id === "light-crossbow").longRangeFeet, 320);
  assert.equal(pharos.spells.find((spell) => spell.id === "chill-touch").unsupportedReason, undefined);
  assert.equal(pharos.spells.find((spell) => spell.id === "true-strike").effect.modifiers.outgoingAttacks, "advantage");
  assert.equal(pharos.spells.find((spell) => spell.id === "expeditious-retreat").effect.modifiers.bonusActionDash, true);
  assert.equal(irvenWeber.spells.find((spell) => spell.id === "heroism").effect.turnStartTemporaryHitPoints, 2);
  assert.equal(irvenWeber.spells.find((spell) => spell.id === "searing-smite").trigger, "after-melee-hit");
});
