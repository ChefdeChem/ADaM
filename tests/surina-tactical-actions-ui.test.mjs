import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSurinaTacticalActions } from "../src/ui/surina-tactical-actions.ts";
import { surinaDaardendrian as source, goliathBarbarian } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

const scenario = generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" });

function encounter() {
  const state = createPlayableEncounter(source, scenario);
  return {
    ...state,
    selectedTargetId: state.combatants[1].id,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant, index) => ({ ...combatant, initiativeRolled: true, position: { x: 1 + index, y: 1 } })),
  };
}

test("Grapple card counts legal adjacent targets and explains a blocked hand", () => {
  const ready = buildSurinaTacticalActions(encounter()).find((action) => action.id === "grapple");
  assert.equal(ready.tone, "setup");
  assert.equal(ready.status, "Choose 1 legal target");
  const blockedState = encounter();
  blockedState.combatants[0].heldWeaponIds = ["longsword", "javelin"];
  const blocked = buildSurinaTacticalActions(blockedState).find((action) => action.id === "grapple");
  assert.equal(blocked.tone, "blocked");
  assert.match(blocked.status, /free hand/i);
});

test("Shove card counts legal targets and reports reach failures", () => {
  const ready = buildSurinaTacticalActions(encounter()).find((action) => action.id === "shove");
  assert.equal(ready.status, "Choose 1 legal target");
  const distantState = encounter();
  distantState.combatants[1].position = { x: 6, y: 5 };
  const distant = buildSurinaTacticalActions(distantState).find((action) => action.id === "shove");
  assert.equal(distant.tone, "blocked");
  assert.match(distant.status, /5 feet/);
});

test("Help reports its ally requirement while Ready and Search expose guided starts", () => {
  const actions = buildSurinaTacticalActions(encounter());
  const help = actions.find((candidate) => candidate.id === "help");
  assert.equal(help.tone, "blocked");
  assert.match(help.status, /another ally/i);
  for (const id of ["ready", "search"]) {
    const action = actions.find((candidate) => candidate.id === id);
    assert.equal(action.tone, "setup");
    assert.equal(action.status, "Start here");
    assert.equal(action.cost, "Action");
  }
  const withAlly = encounter();
  const ally = createPlayableEncounter(goliathBarbarian, scenario).combatants[0];
  withAlly.combatants.push({ ...ally, id: "ally", side: "player", initiativeRolled: true, position: { x: 1, y: 2 } });
  assert.equal(buildSurinaTacticalActions(withAlly).find((candidate) => candidate.id === "help").tone, "setup");
});

test("all five tactical cards preserve the engine reason after the Action is spent", () => {
  const state = encounter();
  state.turn.action = false;
  const actions = buildSurinaTacticalActions(state);
  assert.deepEqual(actions.map((action) => action.id), ["grapple", "shove", "help", "ready", "search"]);
  assert.ok(actions.every((action) => action.tone === "blocked"));
  assert.ok(actions.every((action) => /Action.*used/i.test(action.status)));
});

test("the Surina console directly wires each tactical card and keeps the grid responsive", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const id of ["grapple", "shove", "help", "ready", "search"]) assert.match(page, new RegExp(`data-tactical-action=\\{action\\.id\\}|${id}`));
  assert.match(page, /openSurinaTacticalAction/);
  assert.match(page, /unarmedFlow === "grapple"/);
  assert.match(page, /unarmedFlow === "shove"/);
  assert.match(css, /\.tactical-action-grid\{display:grid;grid-template-columns:repeat\(5/);
  assert.match(css, /@media\(max-width:460px\)\{\.quick-action-grid\{grid-template-columns:1fr\}\.tactical-action-grid\{grid-template-columns:1fr\}/);
});
