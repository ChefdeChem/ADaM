import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { joinDndBeyondPdfPages, parseDndBeyondTokens } from "../src/importers/dnd-beyond.ts";
import { importPlayabilityChecks } from "../src/importers/playability.ts";

const corePage = [
  "ABILITY SAVE DC",
  "Spell", "Reader", "Bard", "1", "Fixture Player", "High Elf", "Entertainer", "(Milestone)",
  "8", "-1", "15", "+2", "14", "+2", "13", "+1", "10", "+0", "16", "+3",
  "-1", "+4", "+2", "+1", "+0", "+5",
  "P", "+5", "CHA", "+2", "DEX", "+2", "CON", "-1", "STR", "+0", "WIS", "+1", "INT",
  "13", "10", "12", "+2", "16", "+3",
  "30", "ft.", "(Walking)", "10", "--", "1d8",
  "Dagger", "+4", "1d4+2", "Piercing",
];

const spellPage = [
  "SPELLCASTING ABILITY", "Charisma",
  "SPELL SAVE DC", "13",
  "SPELL ATTACK BONUS", "+5",
  "SPELLS",
  "CANTRIPS", "Vicious Mockery", "Unknown Spark",
  "LEVEL 1", "2/2 SLOTS", "Charm Person", "Unknown Ward",
  "2ND LEVEL", "1 SLOT", "Unknown Veil",
];

const parsedFixture = () => parseDndBeyondTokens(joinDndBeyondPdfPages([corePage, spellPage]), 2);

test("extracts flattened-PDF spell names under their explicit spell-level headings", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.spells.filter((spell) => spell.level === 1).map((spell) => spell.name), ["Charm Person", "Unknown Ward"]);
  assert.deepEqual(parsed.spells.filter((spell) => spell.level === 2).map((spell) => spell.name), ["Unknown Veil"]);
});

test("preserves cantrips at level zero and keeps unknown names non-executable", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  const cantrips = parsed.spells.filter((spell) => spell.level === 0);
  assert.deepEqual(cantrips.map((spell) => spell.name), ["Vicious Mockery", "Unknown Spark"]);
  assert.equal(cantrips[0].unsupportedReason, undefined);
  assert.match(cantrips[1].unsupportedReason, /no verified executable definition/i);
});

test("extracts current and maximum spell-slot pools with long-rest recovery", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.resources, [
    { id: "spell-slot-1", name: "Level 1 Spell Slots", kind: "spell-slot", level: 1, current: 2, maximum: 2, recovery: "long-rest" },
    { id: "spell-slot-2", name: "Level 2 Spell Slots", kind: "spell-slot", level: 2, current: 1, maximum: 1, recovery: "long-rest" },
  ]);
});

test("links recognized spells to verified mechanics, imported casting values, and matching slots", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  const charmPerson = parsed.spells.find((spell) => spell.name === "Charm Person");
  assert.equal(charmPerson?.provenance?.sourceId, "srd-5.1");
  assert.equal(charmPerson?.save?.dc, 13);
  const character = { ...parsed, id: "spell-reader", source: { format: "flattened-pdf", importedAt: "2026-09-21T00:00:00.000Z" } };
  const slotCheck = importPlayabilityChecks(character).find((check) => check.id === "spell-slots");
  assert.equal(slotCheck?.status, "ready");
  assert.match(slotCheck?.detail ?? "", /3\/3 leveled spells linked/);
});

test("shows spell pools plus verified and descriptive spell records during import review", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Imported spell pools/);
  assert.match(page, /Imported spells/);
  assert.match(page, /<b>Verified:<\/b>/);
  assert.match(page, /<b>Descriptive only:<\/b>/);
  assert.match(page, /remain unavailable until linked to verified mechanics/);
});
