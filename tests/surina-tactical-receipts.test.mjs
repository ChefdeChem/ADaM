import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { surinaDaardendrian as source } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { resolveGrapple } from "../src/engine/grappling.ts";
import { resolveShove } from "../src/engine/shove.ts";
import { help, hide, queueReadiedAttack, readyAttack, resolveReadiedAttack } from "../src/engine/interactions.ts";
import { buildResolutionReceipt } from "../src/ui/resolution-receipt.ts";

function state() {
  const encounter = createPlayableEncounter(source, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  encounter.combatants = encounter.combatants.slice(0, 2).map((combatant, index) => ({
    ...combatant,
    position: { x: 1 + index, y: 2 },
    initiativeRolled: true,
    hitPoints: { current: 30, maximum: 30 },
    savingThrowModifiers: { ...combatant.savingThrowModifiers, strength: 0, dexterity: 0 },
  }));
  encounter.map.terrain = [];
  encounter.selectedTargetId = encounter.combatants[1].id;
  return encounter;
}

test("Grapple receipt shows the condition and Action cost", () => {
  const before = state();
  const result = resolveGrapple(before, before.combatants[1].id, () => 0);
  const receipt = buildResolutionReceipt({ kind: "grapple", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /gained Grappled/);
  assert.match(receipt.changes.join(" "), /Action used/);
});

test("Shove receipt shows forced movement and Action cost", () => {
  const before = state();
  const result = resolveShove(before, before.combatants[1].id, "push", () => 0);
  const receipt = buildResolutionReceipt({ kind: "shove", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /moved C3 → D3/);
  assert.match(receipt.changes.join(" "), /Action used/);
});

test("Help receipt identifies the prepared Advantage", () => {
  const before = state();
  before.combatants.push({ ...structuredClone(before.combatants[0]), id: "ally", name: "Ally", position: { x: 1, y: 3 } });
  const result = help(before, "attack", before.combatants[1].id);
  const receipt = buildResolutionReceipt({ kind: "help", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /Next ally attack against .*: Advantage/);
  assert.match(receipt.changes.join(" "), /Action used/);
});

test("Ready receipt names the attack, target, trigger, and preserved Reaction", () => {
  const before = state();
  const result = readyAttack(before, "longsword", before.combatants[1].id, "becomes-attackable");
  const receipt = buildResolutionReceipt({ kind: "ready", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /Prepared: Longsword/);
  assert.match(receipt.changes.join(" "), /Trigger: target first becomes attackable/);
  assert.match(receipt.changes.join(" "), /Reaction remains ready/);
});

test("Ready receipt follows acceptance, hit, and damage without calling a resolved attack ignored", () => {
  const before = state();
  const prepared = readyAttack(before, "longsword", before.combatants[1].id, "finishes-moving").encounter;
  const enemyTurn = { ...prepared, activeIndex: 1, turn: { ...prepared.turn, action: true } };
  const queued = queueReadiedAttack(enemyTurn, before.combatants[1].id);
  const accepted = resolveReadiedAttack(queued, "accept");
  let receipt = buildResolutionReceipt({ kind: "ready", before: queued, after: accepted.encounter, actorId: before.combatants[0].id, summary: accepted.summary });
  assert.match(receipt.changes.join(" "), /Trigger accepted · roll the attack next/);
  const attack = resolveReadiedAttack(accepted.encounter, "roll", () => 0.9);
  receipt = buildResolutionReceipt({ kind: "ready", before: accepted.encounter, after: attack.encounter, actorId: before.combatants[0].id, summary: attack.summary });
  assert.match(receipt.changes.join(" "), /Attack hit · roll damage next/);
  const damage = resolveReadiedAttack(attack.encounter, "roll", () => 0.5);
  receipt = buildResolutionReceipt({ kind: "ready", before: attack.encounter, after: damage.encounter, actorId: before.combatants[0].id, summary: damage.summary });
  assert.match(receipt.changes.join(" "), /Readied attack resolved/);
  assert.doesNotMatch(receipt.changes.join(" "), /ignored/);
});

test("Hide receipt reports the discovery DC and Invisible condition", () => {
  const before = state();
  before.map.terrain = [{ x: 2, y: 2, kind: "wall", label: "wall" }];
  before.combatants[1].position = { x: 3, y: 2 };
  const result = hide(before, () => 0.9);
  const receipt = buildResolutionReceipt({ kind: "hide", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  assert.match(receipt.changes.join(" "), /Hidden · Perception DC 18/);
  assert.match(receipt.changes.join(" "), /gained Invisible/);
});

test("the Surina page wires all five tactical receipts through named handlers", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const kind of ["grapple", "shove", "help", "ready", "hide"]) assert.match(page, new RegExp(`kind: "${kind}"`));
  for (const handler of ["performGrapple", "performShove", "performHelp", "prepareReadiedAttack", "resolvePendingReadiedAttack"]) assert.match(page, new RegExp(handler));
});
