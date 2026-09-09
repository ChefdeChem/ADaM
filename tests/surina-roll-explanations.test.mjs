import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { explainD20Roll, explainDamageRoll } from "../src/ui/roll-explanation.ts";

test("initiative explains the die, modifier, total, and turn-order result", () => {
  const explanation = explainD20Roll({
    kind: "initiative",
    title: "Surina's initiative",
    roll: { mode: "normal", rolls: [14], kept: 14, natural: 14, modifier: 1, total: 15 },
    outcome: "Turn order position 2",
    nextStep: "Watch ADaM resolve the first enemy turn.",
  });
  assert.equal(explanation.formula, "d20 (14) + 1");
  assert.equal(explanation.total, 15);
  assert.equal(explanation.comparison, "Turn order position 2");
});

test("attack explanations show a visible AC comparison but preserve Advanced-mode secrecy", () => {
  const roll = { mode: "advantage", rolls: [8, 17], kept: 17, natural: 17, modifier: 4, total: 21 };
  const visible = explainD20Roll({ kind: "attack", title: "Longsword against Guard", roll, target: { label: "Guard AC", value: 16 }, outcome: "Hit", nextStep: "Roll damage." });
  const hidden = explainD20Roll({ kind: "attack", title: "Longsword against Guard", roll, hiddenTargetLabel: "Target AC", outcome: "Hit", nextStep: "Roll damage." });
  assert.equal(visible.formula, "2d20 (8, 17), keep higher 17 + 4");
  assert.equal(visible.comparison, "21 vs Guard AC 16 · Hit");
  assert.equal(hidden.comparison, "Hit · Target AC stays hidden in Advanced mode");
  assert.doesNotMatch(hidden.comparison, /16/);
});

test("damage explanations expose every die, the modifier, type, and resolved target", () => {
  const explanation = explainDamageRoll({
    title: "Longsword damage",
    roll: { formula: { diceCount: 1, dieSize: 8, modifier: 3, damageType: "slashing" }, critical: true, rolls: [7, 4], modifier: 3, total: 14 },
    targetName: "Guard",
    nextStep: "Use remaining movement or end the turn.",
  });
  assert.equal(explanation.formula, "2d8 (7, 4) + 3 slashing");
  assert.equal(explanation.total, 14);
  assert.match(explanation.comparison, /Guard receives the resolved slashing damage/);
});

test("saving throws explain DC comparison, outcome, and next response", () => {
  const explanation = explainD20Roll({
    kind: "saving-throw",
    title: "Concentration: Constitution save",
    roll: { mode: "disadvantage", rolls: [18, 6], kept: 6, natural: 6, modifier: 2, total: 8 },
    target: { label: "DC", value: 10 },
    outcome: "Concentration ends",
    nextStep: "Continue the interrupted turn.",
  });
  assert.equal(explanation.formula, "2d20 (18, 6), keep lower 6 + 2");
  assert.equal(explanation.comparison, "8 vs DC 10 · Concentration ends");
});

test("ability and tool checks explain open results and render in Surina's responsive UI", () => {
  const explanation = explainD20Roll({
    kind: "ability-check",
    title: "Disguise Kit: charisma check",
    roll: { mode: "normal", rolls: [11], kept: 11, natural: 11, modifier: 5, total: 16 },
    outcome: "Tool proficiency included",
    nextStep: "Use this total with the scenario or DM.",
  });
  assert.equal(explanation.comparison, "Tool proficiency included");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /How this roll worked|roll-explanation/);
  assert.match(page, /Next: \{rollExplanation\.nextStep\}/);
  assert.match(css, /@media\(max-width:700px\)\{\.roll-explanation\{grid-template-columns:1fr\}/);
});
