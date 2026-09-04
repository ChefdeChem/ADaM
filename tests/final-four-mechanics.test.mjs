import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { irvenWeber, pharos } from "../src/characters/verified-pdf-characters.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executePointSpell, resolveIllusionStudy } from "../src/engine/point-effects.ts";
import { executeToolCheck } from "../src/engine/tool-actions.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function encounterFor(character) {
  const state = createEncounter(character, generateScriptedScenario({
    prompt: "A market rules laboratory",
    environment: "market",
    objective: "defeat",
    difficulty: "easy",
  }));
  return {
    ...state,
    activeIndex: 0,
    combatants: state.combatants.map((combatant, index) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10 - index,
      initiativeRolled: true,
    })),
  };
}

const spell = (character, id) => character.spells.find((candidate) => candidate.id === id);

test("the final slice raises executable coverage from 95 to all 99 mechanics", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  assert.equal(reports.reduce((sum, report) => sum + report.total, 0), 99);
  assert.equal(reports.reduce((sum, report) => sum + report.executable, 0), 99);
  const entries = reports.flatMap((report) => report.entries);
  const expected = [
    ["Minor Illusion", "srd-5.1"],
    ["Disguise Kit", "srd-5.1"],
    ["Druidcraft", "srd-5.1"],
    ["Control Flames", "user-imported"],
  ];
  for (const [name, sourceId] of expected) {
    const entry = entries.find((candidate) => candidate.name === name);
    assert.equal(entry?.executable, true, name);
    assert.equal(entry?.sourceId, sourceId, name);
  }
  assert.equal(entries.find((entry) => entry.name === "Control Flames")?.status, "partial");
  assert.equal(entries.find((entry) => entry.name === "Druidcraft")?.status, "partial");
});

test("Minor Illusion places the selected mode, replaces a previous casting, and enforces range", () => {
  const state = encounterFor(cleiraOestwilde);
  const minorIllusion = spell(cleiraOestwilde, "minor-illusion");
  const image = executePointSpell(state, minorIllusion, [{ x: 2, y: 6 }], () => 0, "image");
  assert.equal(image.legal, true);
  const first = image.encounter.effects.find((effect) => effect.name === "Minor Illusion");
  assert.equal(first.pointEffect.mode, "image");
  assert.equal(first.pointEffect.investigationDc, 12);
  assert.equal(image.encounter.turn.action, false);

  const ready = { ...image.encounter, turn: { ...image.encounter.turn, action: true } };
  const sound = executePointSpell(ready, minorIllusion, [{ x: 3, y: 6 }], () => 0, "sound");
  assert.equal(sound.legal, true);
  assert.equal(sound.encounter.effects.filter((effect) => effect.name === "Minor Illusion").length, 1);
  assert.equal(sound.encounter.effects.find((effect) => effect.name === "Minor Illusion").pointEffect.mode, "sound");

  const outOfRange = executePointSpell(state, minorIllusion, [{ x: 8, y: 6 }], () => 0, "image");
  assert.equal(outOfRange.legal, false);
  assert.match(outOfRange.reason, /outside.*30-foot range/i);
});

test("a creature can spend its Action to study and discern Minor Illusion", () => {
  const state = encounterFor(cleiraOestwilde);
  const cast = executePointSpell(state, spell(cleiraOestwilde, "minor-illusion"), [{ x: 2, y: 6 }], () => 0, "image");
  const enemyIndex = cast.encounter.combatants.findIndex((combatant) => combatant.side === "enemy");
  const enemy = cast.encounter.combatants[enemyIndex];
  const enemyTurn = { ...cast.encounter, activeIndex: enemyIndex, turn: { ...cast.encounter.turn, action: true } };
  const studied = resolveIllusionStudy(enemyTurn, cast.encounter.effects.find((effect) => effect.name === "Minor Illusion").id, enemy.id, () => 0.99);
  assert.equal(studied.legal, true);
  assert.equal(studied.discovered, true);
  assert.equal(studied.encounter.turn.action, false);
  assert.deepEqual(studied.encounter.effects.find((effect) => effect.name === "Minor Illusion").pointEffect.discoveredBy, [enemy.id]);
});

test("Disguise Kit rolls the chosen ability and adds proficiency only when present", () => {
  const rule = cleiraOestwilde.equipmentRules.find((candidate) => candidate.id === "disguise-kit");
  const untrained = executeToolCheck(encounterFor(cleiraOestwilde), rule, "charisma", () => 0.45);
  assert.equal(untrained.legal, true);
  assert.equal(untrained.proficient, false);
  assert.equal(untrained.roll.total, 12);
  assert.equal(untrained.encounter.turn.action, false);

  const trainedCharacter = {
    ...cleiraOestwilde,
    profile: {
      ...cleiraOestwilde.profile,
      proficiencies: {
        ...cleiraOestwilde.profile.proficiencies,
        tools: [...cleiraOestwilde.profile.proficiencies.tools, "Disguise Kit"],
      },
    },
  };
  const trained = executeToolCheck(encounterFor(trainedCharacter), rule, "charisma", () => 0.45);
  assert.equal(trained.proficient, true);
  assert.equal(trained.roll.total, 14);
});

test("Control Flames selects a lit nonmagical flame and records the imported descriptive outcome", () => {
  const state = encounterFor(irvenWeber);
  const controlFlames = spell(irvenWeber, "control-flames");
  const controlled = executePointSpell(state, controlFlames, [{ x: 2, y: 5 }], () => 0, "control");
  assert.equal(controlled.legal, true);
  assert.equal(controlled.encounter.map.terrain.find((cell) => cell.x === 2 && cell.y === 5).flame.controlled, true);
  assert.equal(controlled.encounter.turn.action, false);
  const emptySquare = executePointSpell(state, controlFlames, [{ x: 3, y: 5 }], () => 0, "control");
  assert.equal(emptySquare.legal, false);
  assert.match(emptySquare.reason, /registered.*nonmagical flame/i);
});

test("Druidcraft executes weather, bloom, sensory, light, and snuff choices", () => {
  const state = encounterFor(pharos);
  const druidcraft = spell(pharos, "druidcraft");
  const snuffed = executePointSpell(state, druidcraft, [{ x: 2, y: 5 }], () => 0, "snuff-flame");
  assert.equal(snuffed.legal, true);
  assert.equal(snuffed.encounter.map.terrain.find((cell) => cell.x === 2 && cell.y === 5).flame.lit, false);

  const relit = executePointSpell({ ...snuffed.encounter, turn: { ...snuffed.encounter.turn, action: true } }, druidcraft, [{ x: 2, y: 5 }], () => 0, "light-flame");
  assert.equal(relit.legal, true);
  assert.equal(relit.encounter.map.terrain.find((cell) => cell.x === 2 && cell.y === 5).flame.lit, true);

  const weather = executePointSpell({ ...relit.encounter, turn: { ...relit.encounter.turn, action: true } }, druidcraft, [{ x: 2, y: 4 }], () => 0, "weather");
  assert.equal(weather.legal, true);
  assert.equal(weather.encounter.effects.find((effect) => effect.pointEffect?.type === "utility-marker" && effect.pointEffect.kind === "weather-sensor").expiresAt.round, state.round + 1);

  const bloom = executePointSpell({ ...weather.encounter, turn: { ...weather.encounter.turn, action: true } }, druidcraft, [{ x: 3, y: 4 }], () => 0, "bloom");
  assert.equal(bloom.legal, true);
  assert.equal(bloom.encounter.effects.some((effect) => effect.pointEffect?.type === "utility-marker" && effect.pointEffect.kind === "bloom"), true);

  const sensory = executePointSpell({ ...bloom.encounter, turn: { ...bloom.encounter.turn, action: true } }, druidcraft, [{ x: 4, y: 4 }], () => 0, "sensory");
  assert.equal(sensory.legal, true);
  assert.match(sensory.summary, /momentary harmless nature sensation/i);
});
