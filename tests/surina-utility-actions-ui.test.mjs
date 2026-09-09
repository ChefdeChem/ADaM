import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSurinaUtilityActions, legalInfluenceTargetIds } from "../src/ui/surina-utility-actions.ts";
import { executeSkillAction } from "../src/engine/skill-actions.ts";
import { surinaDaardendrian as source } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

const scenario = generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" });

function encounter() {
  const state = createPlayableEncounter(source, scenario);
  return {
    ...state,
    selectedTargetId: null,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant, index) => ({ ...combatant, initiativeRolled: true, position: { x: 1 + index, y: 1 } })),
  };
}

test("utility rail exposes all five Surina workflows with live turn details", () => {
  const actions = buildSurinaUtilityActions(encounter());
  assert.deepEqual(actions.map((action) => action.id), ["dash", "disengage", "hide", "study", "influence"]);
  assert.equal(actions.find((action) => action.id === "dash").status, "Gain 30 ft. movement");
  assert.equal(actions.find((action) => action.id === "disengage").tone, "ready");
  assert.equal(actions.find((action) => action.id === "study").status, "Choose 1 of 5 skills");
  assert.match(actions.find((action) => action.id === "influence").status, /Choose 1 legal target/);
});

test("Hide preserves the engine's Total Cover explanation", () => {
  const action = buildSurinaUtilityActions(encounter()).find((candidate) => candidate.id === "hide");
  assert.equal(action.tone, "blocked");
  assert.match(action.status, /Total Cover/);
});

test("Influence target discovery respects range and sight", () => {
  const ready = encounter();
  assert.deepEqual(legalInfluenceTargetIds(ready), [ready.combatants[1].id]);
  ready.combatants[1].position = { x: 9, y: 7 };
  assert.deepEqual(legalInfluenceTargetIds(ready), []);
  assert.match(buildSurinaUtilityActions(ready).find((action) => action.id === "influence").status, /Select a target/);
});

test("guided Influence spends the Action only after target and skill choices", () => {
  const state = encounter();
  const targetId = legalInfluenceTargetIds(state)[0];
  const targeted = { ...state, selectedTargetId: targetId };
  const result = executeSkillAction(targeted, "influence", "persuasion", () => 0.6);
  assert.equal(result.legal, true);
  assert.equal(result.encounter.turn.action, false);
  assert.equal(result.encounter.selectedTargetId, targetId);
  assert.match(result.summary, /scenario or DM determines/);
});

test("the utility rail blocks before initiative and after the Action is spent", () => {
  const waiting = encounter();
  waiting.combatants[0].initiativeRolled = false;
  assert.ok(buildSurinaUtilityActions(waiting).every((action) => action.status === "Roll initiative first"));
  const spent = encounter();
  spent.turn.action = false;
  assert.ok(buildSurinaUtilityActions(spent).every((action) => action.tone === "blocked"));
  assert.ok(buildSurinaUtilityActions(spent).every((action) => /Action.*used/i.test(action.status)));
});

test("the Surina console wires every utility action and guided Influence targeting", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /buildSurinaUtilityActions/);
  assert.match(page, /openSurinaUtilityAction/);
  assert.match(page, /utilityTargetFlow === "influence"/);
  assert.match(page, /data-utility-action=\{action\.id\}/);
  assert.match(page, /Hide: Stealth check/);
  assert.match(css, /\.utility-action-grid\{display:grid;grid-template-columns:repeat\(5/);
  assert.match(css, /@media\(max-width:460px\).*\.utility-action-grid\{grid-template-columns:1fr\}/);
});
