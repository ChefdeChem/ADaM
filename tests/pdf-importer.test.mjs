import assert from "node:assert/strict";
import test from "node:test";
import { parseDndBeyondTokens } from "../src/importers/dnd-beyond.ts";

test("parses a flattened D&D Beyond character and its ranged attacks", () => {
  const tokens = [
    "ABILITY SAVE DC",
    "Example Hero", "Ranger", "4", "Fixture Owner", "Elf", "Guide", "(Milestone)",
    "14", "+2", "16", "+3", "12", "+1", "10", "+0", "13", "+1", "8", "-1",
    "-1", "+5", "+0", "+4", "+1", "+1",
    "P", "+5", "DEX", "P", "+3", "WIS", "+2", "INT", "P", "+1", "STR",
    "+1", "CHA", "+2", "INT", "P", "+3", "WIS", "+1", "CHA", "E", "+6", "INT",
    "+1", "WIS", "+2", "INT", "P", "+3", "WIS", "+1", "CHA", "+1", "CHA", "+2",
    "E", "+7", "P", "+5", "P", "+3",
    "12", "14", "15", "+5", "15", "+2",
    "35", "ft.", "(Walking),", "35", "ft.", "(Climbing)", "28", "--", "4d10",
    "===", "SPECIAL", "===", "Sneak", "Attack",
    "Dagger", "+5", "1d4+3", "Piercing", "Simple,", "Finesse,", "Range", "(20/60)",
    "Poison", "Dart", "+5", "1d4+3", "Piercing", "Simple,", "Finesse,", "Range", "(20/60),", "Poison",
    "Shortbow", "+5", "1d6+3", "Piercing", "Simple,", "Ammunition,", "Range", "(80/320)",
  ];

  const parsed = parseDndBeyondTokens(tokens);
  assert.ok(parsed);
  assert.equal(parsed.name, "Example Hero");
  assert.equal(parsed.className, "Ranger");
  assert.equal(parsed.level, 4);
  assert.equal(parsed.armorClass, 15);
  assert.equal(parsed.speedFeet, 35);
  assert.deepEqual(parsed.hitPoints, { current: 28, maximum: 28 });
  assert.deepEqual(parsed.abilities, { strength: 14, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 13, charisma: 8 });
  assert.equal(parsed.attacks.length, 3);
  assert.deepEqual(parsed.attacks[1], {
    id: "poison-dart-2",
    name: "Poison Dart",
    kind: "ranged",
    attackBonus: 5,
    damage: "1d4+3 piercing",
    normalRangeFeet: 20,
    longRangeFeet: 60,
    description: "Imported range 20/60 feet; long-range attacks have disadvantage.",
  });
  assert.equal(parsed.attacks[2].longRangeFeet, 320);
});
