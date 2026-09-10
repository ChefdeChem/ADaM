import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { surinaDaardendrian as source } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { actionCatalog, consumeAction } from "../src/engine/actions.ts";
import { executeSkillAction } from "../src/engine/skill-actions.ts";
import { buildResolutionReceipt } from "../src/ui/resolution-receipt.ts";

function state() {
  const encounter = createPlayableEncounter(source, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  encounter.combatants = encounter.combatants.slice(0, 2).map((combatant, index) => ({ ...combatant, position: { x: 1 + index, y: 2 }, initiativeRolled: true }));
  encounter.map.terrain = [];
  encounter.selectedTargetId = encounter.combatants[1].id;
  return encounter;
}

function action(id) {
  return actionCatalog.find((candidate) => candidate.id === id);
}

test("Dash receipt shows the expanded movement pool and Action cost", () => {
  const before = state();
  const after = consumeAction(action("dash"), before);
  const receipt = buildResolutionReceipt({ kind: "dash", before, after, actorId: before.combatants[0].id, summary: "Surina Dashes." });
  assert.match(receipt.changes.join(" "), /Movement 30 → 60 ft\./);
  assert.match(receipt.changes.join(" "), /Action used/);
});

test("Disengage receipt explains the protection and Action cost", () => {
  const before = state();
  const after = consumeAction(action("disengage"), before);
  const receipt = buildResolutionReceipt({ kind: "disengage", before, after, actorId: before.combatants[0].id, summary: "Surina Disengages." });
  assert.match(receipt.changes.join(" "), /does not provoke Opportunity Attacks/);
  assert.match(receipt.changes.join(" "), /Action used/);
});

for (const [kind, skill] of [["search", "perception"], ["study", "history"], ["influence", "persuasion"]]) {
  test(`${kind} receipt preserves the rolled check while leaving narrative resolution open`, () => {
    const before = state();
    const result = executeSkillAction(before, kind, skill, () => 0.5);
    const receipt = buildResolutionReceipt({ kind, before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
    assert.match(receipt.changes.join(" "), /scenario or DM interprets this total/);
    assert.match(receipt.changes.join(" "), /No automatic narrative outcome applied/);
    assert.match(receipt.changes.join(" "), /Action used/);
    if (kind === "influence") assert.match(receipt.changes.join(" "), /Approach:/);
  });
}

test("the Surina page wires all five utility receipts through the shared skill handler", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const receiptSource = readFileSync(new URL("../src/ui/resolution-receipt.ts", import.meta.url), "utf8");
  for (const kind of ["dash", "disengage", "search", "study", "influence"]) assert.match(receiptSource, new RegExp(`\\| "${kind}"`));
  assert.match(page, /function performSkillAction/);
  assert.match(page, /performSkillAction\(skillFlow/);
  assert.match(page, /kind: actionId/);
  assert.match(page, /kind: action\.id/);
});
