import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actionCatalog, consumeAction } from "../src/engine/actions.ts";
import { applyEffect } from "../src/engine/effects.ts";
import { resolveGrappleEscape } from "../src/engine/grappling.ts";
import { interactWithDoor } from "../src/engine/interactions.ts";
import { rollDeathSave } from "../src/engine/responses.ts";
import { handleWeapon } from "../src/engine/weapon-hands.ts";
import { surinaDaardendrian as source } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { buildResolutionReceipt } from "../src/ui/resolution-receipt.ts";

const scenario = generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" });

function encounter() {
  const state = createPlayableEncounter(source, scenario);
  return {
    ...state,
    selectedTargetId: null,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant, index) => ({ ...combatant, initiative: 20 - index, initiativeRolled: true, position: { x: 1 + index, y: 1 } })),
  };
}

test("held-weapon receipt names the equipment now in hand and its interaction cost", () => {
  const before = encounter();
  const item = before.combatants[0].inventory.find((candidate) => candidate.attackIds.length);
  const result = handleWeapon(before, before.combatants[0].id, item.id);
  assert.equal(result.legal, true);
  const receipt = buildResolutionReceipt({ kind: "equipment", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), new RegExp(`In hand: ${item.name}`));
  assert.match(receipt.changes.join(" "), /Free object interaction used/);
});

test("door receipt identifies the object state and whether an Action was used", () => {
  const before = encounter();
  before.map.terrain = [{ x: 1, y: 2, kind: "wall", label: "Practice door", door: { locked: false, noisy: false } }];
  const result = interactWithDoor(before, 1, 2);
  assert.equal(result.legal, true);
  const receipt = buildResolutionReceipt({ kind: "object", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /Practice door: open/);
  assert.doesNotMatch(receipt.changes.join(" "), /Action used/);
});

test("Stand Up receipt shows Prone removal and movement spent", () => {
  const before = encounter();
  before.combatants[0].conditions = ["Prone"];
  const after = consumeAction(actionCatalog.find((action) => action.id === "stand-up"), before);
  const receipt = buildResolutionReceipt({ kind: "stand-up", before, after, actorId: before.combatants[0].id, summary: "Surina stands." });
  assert.match(receipt.changes.join(" "), /removed Prone/);
  assert.match(receipt.changes.join(" "), /Movement 15 ft\. spent · 15 ft\. remains/);
});

test("grapple escape receipt preserves the check result, condition, and Action cost", () => {
  const beforeBase = encounter();
  const before = applyEffect(beforeBase, { name: "Grappled by Guard", description: "Speed 0", sourceCombatantId: beforeBase.combatants[1].id, targetCombatantId: beforeBase.combatants[0].id, conditionGranted: "Grappled", grapple: { escapeDc: 10, rangeFeet: 5 } });
  const result = resolveGrappleEscape(before, before.effects.find((effect) => effect.grapple).id, "athletics", () => 0.99);
  assert.equal(result.legal, true);
  const receipt = buildResolutionReceipt({ kind: "grapple-escape", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /removed Grappled/);
  assert.match(receipt.changes.join(" "), /Action used/);
});

test("death-save receipt shows the updated track and natural-20 recovery", () => {
  const before = encounter();
  before.combatants[0] = { ...before.combatants[0], hitPoints: { ...before.combatants[0].hitPoints, current: 0 }, deathSaves: { successes: 1, failures: 1 } };
  const result = rollDeathSave(before, before.combatants[0].id, () => 0.999);
  const receipt = buildResolutionReceipt({ kind: "death-save", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /HP \+1/);
  assert.match(receipt.changes.join(" "), /Death saves: 0 successes · 0 failures/);
});

test("the Surina page wires persistent receipts and roll explanations to all five workflows", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const marker of ["death-save", "grapple-escape", "equipment", "object", "stand-up"]) assert.match(page, new RegExp(`kind: "${marker}"`));
  assert.match(page, /changeHeldWeapon/);
  assert.match(page, /interactWithNearbyDoor/);
  assert.match(page, /Death saving throw/);
  assert.match(page, /Escape Grapple/);
});
