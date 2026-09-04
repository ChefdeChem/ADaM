import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { irvenWeber, pharos, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { rollAbilityCheck } from "../src/engine/ability-checks.ts";
import { areaTargets } from "../src/engine/areas.ts";
import { executeSpellChoice, resolveAttackRoll } from "../src/engine/combat-options.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter(character, difficulty = "standard") {
  const state = createEncounter(character, generateScriptedScenario({
    prompt: "A clear training yard",
    environment: "market",
    objective: "defeat",
    difficulty,
  }));
  const enemies = state.combatants.filter((combatant) => combatant.side === "enemy");
  const positions = new Map([[character.id, { x: 1, y: 3 }], [enemies[0]?.id, { x: 2, y: 3 }], [enemies[1]?.id, { x: 3, y: 3 }]]);
  return {
    ...state,
    activeIndex: 0,
    selectedTargetId: enemies[0].id,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10,
      initiativeRolled: true,
      position: positions.get(combatant.id) ?? combatant.position,
      hitPoints: combatant.side === "enemy" ? { current: 30, maximum: 30 } : combatant.hitPoints,
    })),
  };
}

function player(state) {
  return state.combatants.find((combatant) => combatant.side === "player");
}

test("the prior ten-mechanic slice remains executable at the current milestone", () => {
  const reports = BUILT_IN_CHARACTERS.map((character) => buildCharacterMechanicCoverage(character));
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(reports.reduce((total, report) => total + report.executable, 0), 95);
  const expected = [
    ["cleira-oestwilde", "spell", "detect-magic", "srd-5.1"],
    ["cleira-oestwilde", "spell", "thunderwave", "srd-5.1"],
    ["cleira-oestwilde", "feature", "keen-senses", "srd-5.1"],
    ["surina-daardendrian", "feature", "breath-weapon-gold", "srd-5.1"],
    ["irven-weber", "spell", "burning-hands", "srd-5.2.1"],
    ["irven-weber", "feature", "magic-initiate-wizard", "srd-5.2.1"],
    ["pharos", "equipment", "equipment-1-dagger", "srd-5.1"],
    ["pharos", "equipment", "equipment-2-club", "srd-5.1"],
    ["pharos", "equipment", "equipment-3-light-crossbow", "srd-5.1"],
    ["pharos", "equipment", "equipment-4-crossbow-bolts", "srd-5.1"],
  ];
  for (const [characterId, kind, entityId, sourceId] of expected) {
    const entry = reports.find((report) => report.characterId === characterId).entries.find((candidate) => candidate.kind === kind && candidate.entityId === entityId);
    assert.equal(entry.executable, true, `${characterId}:${entityId}`);
    assert.equal(entry.sourceId, sourceId, `${characterId}:${entityId}`);
  }
});

test("Keen Senses marks Perception proficient and applies its registered modifier", () => {
  const state = readyEncounter(cleiraOestwilde, "easy");
  const result = rollAbilityCheck(state, cleiraOestwilde.id, "Perception", () => 0);
  assert.equal(result.proficient, true);
  assert.equal(result.roll.modifier, 2);
  assert.equal(result.roll.total, 3);
});

test("Breath Weapon resolves one save per creature from one shared damage roll", () => {
  const state = readyEncounter(surinaDaardendrian);
  const feature = surinaDaardendrian.featureActions.find((candidate) => candidate.id === "breath-weapon-gold");
  const result = executeFeatureAction(state, feature, { random: () => 0 });
  assert.equal(result.legal, true);
  assert.equal(result.roll.total, 2);
  assert.deepEqual(result.encounter.combatants.filter((combatant) => combatant.side === "enemy").map((combatant) => combatant.hitPoints.current), [28, 28]);
  assert.equal(player(result.encounter).resources.find((resource) => resource.id === "breath-weapon-gold").current, 0);
  assert.equal(result.encounter.turn.action, false);
});

test("cone geometry excludes creatures outside the aimed cone", () => {
  const state = readyEncounter(surinaDaardendrian);
  const enemies = state.combatants.filter((combatant) => combatant.side === "enemy");
  const moved = { ...state, combatants: state.combatants.map((combatant) => combatant.id === enemies[1].id ? { ...combatant, position: { x: 1, y: 6 } } : combatant) };
  const area = surinaDaardendrian.featureActions.find((feature) => feature.id === "breath-weapon-gold").resolution.area;
  assert.deepEqual(areaTargets(moved, surinaDaardendrian.id, enemies[0].id, area).map((combatant) => combatant.id), [enemies[0].id]);
});

test("Thunderwave halves successful-save damage and pushes only failed saves", () => {
  const state = readyEncounter(cleiraOestwilde);
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "thunderwave");
  const rolls = [0, 0, 0.95, 0];
  const result = executeSpellChoice(state, spell, () => rolls.shift() ?? 0);
  assert.equal(result.legal, true);
  const enemies = result.encounter.combatants.filter((combatant) => combatant.side === "enemy");
  assert.deepEqual(enemies.map((enemy) => enemy.hitPoints.current), [29, 28]);
  assert.deepEqual(enemies.map((enemy) => enemy.position.x), [2, 5]);
});

test("Burning Hands requires an explicit casting resource when both are ready", () => {
  const state = readyEncounter(irvenWeber, "easy");
  const spell = irvenWeber.spells.find((candidate) => candidate.id === "burning-hands");
  const result = executeSpellChoice(state, spell, () => 0);
  assert.equal(result.legal, false);
  assert.match(result.reason, /choose whether/i);
});

test("Burning Hands can spend its Magic Initiate free cast without a slot", () => {
  const state = readyEncounter(irvenWeber, "easy");
  const spell = irvenWeber.spells.find((candidate) => candidate.id === "burning-hands");
  const result = executeSpellChoice(state, spell, () => 0, { castingResource: "free-cast" });
  assert.equal(result.legal, true);
  assert.equal(player(result.encounter).resources.find((resource) => resource.id === "magic-initiate-free-cast").current, 0);
  assert.equal(player(result.encounter).resources.find((resource) => resource.id === "spell-slot-1").current, 2);
});

test("Burning Hands can preserve its free cast and spend a spell slot", () => {
  const state = readyEncounter(irvenWeber, "easy");
  const spell = irvenWeber.spells.find((candidate) => candidate.id === "burning-hands");
  const result = executeSpellChoice(state, spell, () => 0, { castingResource: "spell-slot" });
  assert.equal(result.legal, true);
  assert.equal(player(result.encounter).resources.find((resource) => resource.id === "magic-initiate-free-cast").current, 1);
  assert.equal(player(result.encounter).resources.find((resource) => resource.id === "spell-slot-1").current, 1);
});

test("Detect Magic reports registered nearby magic and starts concentration", () => {
  const state = readyEncounter(cleiraOestwilde, "easy");
  const withMagic = { ...state, map: { ...state.map, terrain: [{ x: 3, y: 3, kind: "objective", label: "Ward", magicAura: "abjuration" }] } };
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "detect-magic");
  const result = executeSpellChoice(withMagic, spell);
  assert.equal(result.legal, true);
  assert.match(result.summary, /magic is present within range/i);
  assert.equal(result.encounter.effects.some((effect) => effect.name === "Detect Magic" && effect.concentration && effect.senseMagic.rangeFeet === 30), true);
});

test("Light Crossbow expends bolts on a miss and becomes unavailable after the last bolt", () => {
  const state = readyEncounter(pharos, "easy");
  const attack = pharos.attacks.find((candidate) => candidate.id === "light-crossbow");
  const first = resolveAttackRoll(state, attack, () => 0);
  assert.equal(player(first.encounter).inventory.find((item) => item.id === "crossbow-bolts").current, 19);
  const lastBolt = {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.id === pharos.id
      ? { ...combatant, inventory: combatant.inventory.map((item) => item.id === "crossbow-bolts" ? { ...item, current: 1 } : item) }
      : combatant),
  };
  const spent = resolveAttackRoll(lastBolt, attack, () => 0);
  assert.equal(player(spent.encounter).attacks.some((candidate) => candidate.id === "light-crossbow"), false);
  assert.equal(player(spent.encounter).attacks.some((candidate) => candidate.id === "club"), true);
});

test("Pharos's dagger is consumed only when thrown while his club remains carried", () => {
  const state = readyEncounter(pharos, "easy");
  const thrown = pharos.attacks.find((candidate) => candidate.id === "thrown-dagger");
  const result = resolveAttackRoll(state, thrown, () => 0);
  assert.equal(player(result.encounter).inventory.find((item) => item.id === "dagger").current, 1);
  assert.equal(player(result.encounter).inventory.find((item) => item.id === "club").current, 1);
});
