import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTurnGuidance } from "../src/ui/turn-guidance.ts";

const base = {
  initiativeReady: true,
  outcome: "active",
  activeSide: "player",
  hasRequiredResponse: false,
  choiceMode: null,
  attackPhase: null,
  spellPhase: null,
  breathActive: false,
  healingPhase: null,
  interactionActive: false,
  skillActive: false,
  actionAvailable: true,
  bonusActionAvailable: true,
  movementRemaining: 30,
};

test("the Surina guide begins with the initiative decision", () => {
  const guide = buildTurnGuidance({ ...base, initiativeReady: false });
  assert.equal(guide.step, 1);
  assert.equal(guide.focus, "initiative");
  assert.match(guide.primaryLabel, /Roll Surina's initiative/i);
});

test("the Surina guide sends weapon and spell targeting to the tactical map", () => {
  for (const input of [
    { attackPhase: "target" },
    { spellPhase: "target" },
    { spellPhase: "point" },
  ]) {
    const guide = buildTurnGuidance({ ...base, ...input });
    assert.equal(guide.step, 2);
    assert.equal(guide.focus, "map");
  }
});

test("required responses and attack rolls take priority over new actions", () => {
  const response = buildTurnGuidance({ ...base, hasRequiredResponse: true, attackPhase: "target" });
  assert.equal(response.phase, "response");
  assert.equal(response.focus, "response");
  const roll = buildTurnGuidance({ ...base, attackPhase: "damage-roll" });
  assert.equal(roll.phase, "resolve-roll");
  assert.match(roll.title, /Roll damage/i);
});

test("the Surina guide recommends movement or ending after the Action is spent", () => {
  const withMovement = buildTurnGuidance({ ...base, actionAvailable: false, movementRemaining: 15 });
  assert.equal(withMovement.phase, "finish-turn");
  assert.match(withMovement.secondaryLabel, /remaining movement/i);
  const finished = buildTurnGuidance({ ...base, actionAvailable: false, bonusActionAvailable: false, movementRemaining: 0 });
  assert.equal(finished.step, 4);
  assert.equal(finished.primaryLabel, "End Surina's turn");
});

test("the player surface exposes persistent guidance, compact setup, and automatic focus transitions", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /Surina play guide · Next step/);
  assert.match(page, /scenarioBuilderOpen/);
  assert.match(page, /focusSurface\("map"\)/);
  assert.match(page, /data-guided-step="true"/);
  assert.match(css, /\.surina-play-guide\{position:sticky/);
  assert.match(css, /@media\(max-width:760px\)\{\.surina-play-guide\{position:static/);
});
