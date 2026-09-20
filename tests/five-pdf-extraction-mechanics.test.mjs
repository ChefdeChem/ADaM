import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { joinDndBeyondPdfPages, parseDndBeyondTokens } from "../src/importers/dnd-beyond.ts";

const corePage = [
  "ABILITY SAVE DC",
  "PDF", "Hero", "Paladin", "1", "Player", "Dragonborn", "Guard", "(Milestone)",
  "16", "+3", "10", "+0", "14", "+2", "8", "-1", "12", "+1", "15", "+2",
  "+3", "+0", "+2", "-1", "+1", "+4",
  "P", "+4", "CHA", "+0", "DEX", "+2", "CON", "+3", "STR", "+1", "WIS", "-1", "INT",
  "16", "10", "12", "+2", "18", "+2",
  "30", "ft.", "(Walking)", "12", "--", "1d10",
  "Glaive", "+5", "1d10+3", "Slashing", "Heavy", "Reach",
];

const detailPage = [
  "EQUIPMENT",
  "1 × Glaive", "Javelin", "5", "Explorer's Pack", "1",
  "FEATURES & TRAITS",
  "Divine Awareness: Sense nearby supernatural presences.",
  "Protective Scales", "The character has a defensive draconic trait.",
  "SPELLS",
];

const parsedFixture = () => parseDndBeyondTokens(joinDndBeyondPdfPages([corePage, detailPage]), 2);

test("joins every flattened PDF page with a stable page boundary", () => {
  assert.deepEqual(joinDndBeyondPdfPages([["page one"], ["page two"], ["page three"]]), [
    "page one", "__ADAM_PAGE_BREAK__", "page two", "__ADAM_PAGE_BREAK__", "page three",
  ]);
});

test("extracts structured equipment names and quantities without inventing inventory", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.profile.equipment, [
    { name: "Glaive", quantity: 1 },
    { name: "Javelin", quantity: 5 },
    { name: "Explorer's Pack", quantity: 1 },
  ]);
});

test("preserves extracted feature records as descriptive user content", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.deepEqual(parsed.profile.features, [
    { name: "Divine Awareness", description: "Sense nearby supernatural presences." },
    { name: "Protective Scales", description: "The character has a defensive draconic trait." },
  ]);
  assert.equal(parsed.profile.features?.some((feature) => feature.executableActionId), false);
});

test("records section-specific extraction confidence and multipage evidence", () => {
  const parsed = parsedFixture();
  assert.ok(parsed);
  assert.equal(parsed.extractionAssessment.pageCount, 2);
  assert.deepEqual(
    Object.fromEntries(Object.entries(parsed.extractionAssessment).filter(([key]) => key !== "pageCount").map(([key, value]) => [key, [value.confidence, value.recordCount]])),
    { core: ["high", 1], equipment: ["high", 3], features: ["medium", 2] },
  );
});

test("shows PDF confidence, extracted records, and executable-feature boundary during import review", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /aria-label="PDF extraction confidence"/);
  assert.match(page, /Equipment:/);
  assert.match(page, /These records do not become executable until linked to a verified trainer mechanic/);
});
