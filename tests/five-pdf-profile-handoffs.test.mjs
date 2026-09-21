import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { joinDndBeyondPdfPages, parseDndBeyondTokens } from "../src/importers/dnd-beyond.ts";

const corePage = [
  "ABILITY SAVE DC",
  "Import", "Hero", "Paladin", "1", "Fixture Player", "Dragonborn", "Guard", "(Milestone)",
  "16", "+3", "10", "+0", "14", "+2", "8", "-1", "12", "+1", "15", "+2",
  "+3", "+0", "+2", "-1", "+1", "+4",
  "P", "+4", "CHA", "+0", "DEX", "+2", "CON", "+3", "STR", "+1", "WIS", "-1", "INT",
  "16", "10", "12", "+2", "18", "+2",
  "30", "ft.", "(Walking)", "12", "--", "1d10",
  "Longsword", "+5", "1d8+3", "Slashing",
];

const profilePage = [
  "PASSIVE PERCEPTION", "13",
  "PASSIVE INSIGHT", "11",
  "PASSIVE INVESTIGATION", "9",
  "DARKVISION", "60", "ft.",
  "Athletics", "+5",
  "Persuasion", "+4",
  "SPELLCASTING ABILITY", "Charisma",
  "SPELL SAVE DC", "12",
  "SPELL ATTACK BONUS", "+4",
];

const parsedFixture = () => parseDndBeyondTokens(joinDndBeyondPdfPages([corePage, profilePage]), 2);

test("preserves source player, species, and background identity without converting the build", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(
    { playerName: parsed.profile.playerName, species: parsed.profile.species, background: parsed.profile.background },
    { playerName: "Fixture Player", species: "Dragonborn", background: "Guard" },
  );
});

test("extracts passive senses and darkvision into the playable profile", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.profile.senses, { passivePerception: 13, passiveInsight: 11, passiveInvestigation: 9, darkvisionFeet: 60 });
});

test("extracts only explicitly labeled skill modifiers", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.profile.skills, { Athletics: 5, Persuasion: 4 });
  assert.equal(parsed.profile.skills?.Stealth, undefined);
});

test("extracts a complete labeled spellcasting profile without inferring missing values", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.profile.spellcasting, { ability: "charisma", saveDc: 12, attackBonus: 4 });
  const incomplete = parseDndBeyondTokens(joinDndBeyondPdfPages([corePage, ["SPELLCASTING ABILITY", "Charisma", "SPELL SAVE DC", "12"]]), 2);
  assert.equal(incomplete?.profile.spellcasting, undefined);
});

test("shows recovered identity, senses, skills, and spellcasting during import review", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<b>Identity:<\/b>/);
  assert.match(page, /<b>Senses:<\/b>/);
  assert.match(page, /<b>Skills:<\/b>/);
  assert.match(page, /<b>Spellcasting:<\/b>/);
});
