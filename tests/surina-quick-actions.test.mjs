import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actionCostLabel, quickActionPresentation } from "../src/ui/action-presentation.ts";

test("quick actions translate every action-economy cost into player language", () => {
  assert.equal(actionCostLabel("action"), "Action");
  assert.equal(actionCostLabel("bonus-action"), "Bonus Action");
  assert.equal(actionCostLabel("reaction"), "Reaction");
  assert.equal(actionCostLabel("movement"), "Movement");
  assert.equal(actionCostLabel("free"), "No action cost");
});

test("quick actions distinguish immediately legal options from guided setup", () => {
  assert.deepEqual(quickActionPresentation({ legal: true }), {
    tone: "ready",
    status: "Available now",
    explanation: "This option can be used in the current turn state.",
  });
  const setup = quickActionPresentation({ legal: false, workflowCanStart: true, workflowExplanation: "Choose a weapon first." });
  assert.equal(setup.tone, "setup");
  assert.equal(setup.explanation, "Choose a weapon first.");
});

test("blocked quick actions retain the engine's exact legality reason", () => {
  const blocked = quickActionPresentation({ legal: false, reason: "Your Action has already been used this turn." });
  assert.equal(blocked.tone, "blocked");
  assert.equal(blocked.status, "Unavailable");
  assert.equal(blocked.explanation, "Your Action has already been used this turn.");
});

test("Surina's five primary workflows are surfaced without altering their engine actions", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const actionId of ["attack", "move", "breath-weapon-gold", "lay-on-hands", "dodge"]) {
    assert.match(page, new RegExp(`\\"${actionId}\\"`));
  }
  assert.match(page, /runAction\(action\)/);
  assert.match(page, /resource\.current\}\/\$\{resource\.maximum/);
  assert.match(page, /focusSurface\("map"\)/);
});

test("quick-action cards remain readable and responsive on narrow screens", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.quick-action-grid\{display:grid;grid-template-columns:repeat\(5/);
  assert.match(css, /\.quick-action p\{[^}]*font-size:13px/);
  assert.match(css, /@media\(max-width:460px\)\{\.quick-action-grid\{grid-template-columns:1fr/);
});
