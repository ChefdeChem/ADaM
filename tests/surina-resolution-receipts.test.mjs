import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildResolutionReceipt } from "../src/ui/resolution-receipt.ts";

function state() {
  return {
    round: 1,
    activeIndex: 0,
    selectedTargetId: "enemy",
    effects: [],
    map: { width: 8, height: 6, terrain: [] },
    pendingResponse: null,
    log: [],
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false, usedFeatureIds: [] },
    combatants: [
      { id: "surina", name: "Surina", side: "player", position: { x: 1, y: 1 }, hitPoints: { current: 12, maximum: 12 }, conditions: [], reactionAvailable: true, resources: [{ id: "breath", name: "Breath Weapon", current: 1, maximum: 1 }] },
      { id: "enemy", name: "Guard", side: "enemy", position: { x: 3, y: 1 }, hitPoints: { current: 10, maximum: 10 }, conditions: [], reactionAvailable: true, resources: [] },
    ],
  };
}

test("attack receipts make damage and action cost visible", () => {
  const before = state();
  const after = structuredClone(before);
  after.combatants[1].hitPoints.current = 4;
  after.turn.action = false;
  const receipt = buildResolutionReceipt({ kind: "attack", before, after, actorId: "surina", summary: "Surina hits." });
  assert.equal(receipt.eyebrow, "Attack result");
  assert.deepEqual(receipt.changes, ["Guard HP -6 · 4/10", "Action used"]);
});

test("advanced mode receipts preserve concealed enemy hit points", () => {
  const before = state();
  const after = structuredClone(before);
  after.combatants[1].hitPoints.current = 4;
  const receipt = buildResolutionReceipt({ kind: "attack", before, after, actorId: "surina", summary: "Surina hits.", concealEnemyHitPoints: true });
  assert.deepEqual(receipt.changes, ["Guard took damage"]);
});

test("movement receipts show map coordinates, movement spent, and interruptions", () => {
  const before = state();
  const after = structuredClone(before);
  after.combatants[0].position = { x: 3, y: 2 };
  after.turn.movementRemaining = 15;
  after.pendingResponse = { type: "opportunity-attack" };
  const receipt = buildResolutionReceipt({ kind: "movement", before, after, actorId: "surina", summary: "Movement paused." });
  assert.match(receipt.changes.join(" "), /Position B2 → D3 · 15 ft\. spent/);
  assert.match(receipt.changes.join(" "), /Player response required/);
});

test("Breath Weapon receipts show every affected creature and spent use", () => {
  const before = state();
  const after = structuredClone(before);
  after.combatants[1].hitPoints.current = 7;
  after.combatants[0].resources[0].current = 0;
  after.turn.action = false;
  const receipt = buildResolutionReceipt({ kind: "breath-weapon", before, after, actorId: "surina", summary: "Fire fills the cone." });
  assert.match(receipt.changes.join(" "), /Guard HP -3/);
  assert.match(receipt.changes.join(" "), /Breath Weapon 1 → 0/);
});

test("Lay on Hands receipts show healing and pool spending", () => {
  const before = state();
  before.combatants[0].hitPoints.current = 5;
  before.combatants[0].resources[0] = { id: "lay", name: "Lay on Hands", current: 5, maximum: 5 };
  const after = structuredClone(before);
  after.combatants[0].hitPoints.current = 10;
  after.combatants[0].resources[0].current = 0;
  const receipt = buildResolutionReceipt({ kind: "lay-on-hands", before, after, actorId: "surina", summary: "Healing applied." });
  assert.match(receipt.changes.join(" "), /Surina HP \+5/);
  assert.match(receipt.changes.join(" "), /Lay on Hands 5 → 0/);
});

test("defense receipts surface condition and reaction changes", () => {
  const before = state();
  before.combatants[0].conditions = ["prone"];
  const after = structuredClone(before);
  after.combatants[0].conditions = [];
  after.combatants[0].reactionAvailable = false;
  const receipt = buildResolutionReceipt({ kind: "defense", before, after, actorId: "surina", summary: "Surina responds." });
  assert.match(receipt.changes.join(" "), /removed prone/);
  assert.match(receipt.changes.join(" "), /Reaction used/);
});

test("the receipt is visible, dismissible, readable, and responsive", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /resolutionReceipt\.changes\.map/);
  assert.match(page, /setResolutionReceipt\(null\)/);
  assert.match(css, /\.resolution-receipt>p\{[^}]*font-size:14px/);
  assert.match(css, /@media\(max-width:560px\)\{\.receipt-heading\{display:block/);
});
