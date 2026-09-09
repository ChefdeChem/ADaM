import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildResolutionReceipt } from "../src/ui/resolution-receipt.ts";

function state() {
  return {
    round: 1,
    activeIndex: 0,
    selectedTargetId: null,
    effects: [],
    map: { width: 8, height: 6, terrain: [] },
    pendingResponse: null,
    log: [],
    recoveryState: { hitDiceRemaining: 1, elapsedMinutes: 0 },
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false, usedFeatureIds: [] },
    combatants: [
      { id: "surina", name: "Surina", side: "player", initiative: 18, initiativeRolled: true, position: { x: 1, y: 1 }, hitPoints: { current: 7, maximum: 12 }, conditions: [], reactionAvailable: true, resources: [{ id: "sense", name: "Divine Sense", current: 2, maximum: 3 }] },
      { id: "enemy", name: "Guard", side: "enemy", initiative: 11, initiativeRolled: true, position: { x: 3, y: 1 }, hitPoints: { current: 10, maximum: 10 }, conditions: [], reactionAvailable: true, resources: [] },
    ],
  };
}

test("initiative receipt names the complete order and first combatant", () => {
  const after = state();
  const before = structuredClone(after);
  before.combatants.forEach((combatant) => { combatant.initiative = 0; combatant.initiativeRolled = false; });
  const receipt = buildResolutionReceipt({ kind: "initiative", before, after, actorId: "surina", summary: "Initiative rolled." });
  assert.deepEqual(receipt.changes.slice(0, 2), ["Turn order: Surina 18 · Guard 11", "Surina acts first"]);
});

test("enemy-turn receipt explains damage without leaking exact enemy HP in advanced mode", () => {
  const before = state();
  const after = structuredClone(before);
  after.combatants[0].hitPoints.current = 3;
  const receipt = buildResolutionReceipt({ kind: "enemy-turn", before, after, actorId: "surina", summary: "The guard hits Surina.", concealEnemyHitPoints: true });
  assert.match(receipt.changes.join(" "), /Surina HP -4 · 3\/12/);
  assert.equal(receipt.eyebrow, "Enemy turn result");
});

test("end-turn receipt identifies the next combatant and round", () => {
  const before = state();
  const after = structuredClone(before);
  after.activeIndex = 1;
  const receipt = buildResolutionReceipt({ kind: "end-turn", before, after, actorId: "surina", summary: "Turn ended." });
  assert.deepEqual(receipt.changes.slice(0, 2), ["Next turn: Guard", "Round 1"]);
});

test("recovery receipt shows healing, restored resources, Hit Dice, and downtime", () => {
  const before = state();
  before.recoveryState.hitDiceRemaining = 0;
  before.combatants[0].resources[0].current = 0;
  const after = structuredClone(before);
  after.combatants[0].hitPoints.current = 12;
  after.combatants[0].resources[0].current = 3;
  after.recoveryState.hitDiceRemaining = 1;
  after.recoveryState.elapsedMinutes = 480;
  const receipt = buildResolutionReceipt({ kind: "recovery", before, after, actorId: "surina", summary: "Long Rest complete." });
  assert.match(receipt.changes.join(" "), /Surina HP \+5/);
  assert.match(receipt.changes.join(" "), /Divine Sense 0 → 3/);
  assert.match(receipt.changes.join(" "), /Hit Dice 0 → 1/);
  assert.match(receipt.changes.join(" "), /Downtime \+480 minutes/);
});

test("new-encounter receipt gives the three setup steps and is wired to both builders", () => {
  const before = state();
  const after = structuredClone(before);
  after.combatants.forEach((combatant) => { combatant.initiative = 0; combatant.initiativeRolled = false; });
  const receipt = buildResolutionReceipt({ kind: "new-encounter", before, after, actorId: "surina", summary: "Encounter ready." });
  assert.deepEqual(receipt.changes.slice(0, 3), ["1 hostile creature ready", "Choose held weapons before initiative", "Roll initiative to begin"]);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.equal(page.match(/kind: "new-encounter"/g)?.length, 2);
  for (const kind of ["initiative", "enemy-turn", "end-turn", "recovery"]) assert.match(page, new RegExp(`kind: \\"${kind}\\"`));
});
