import assert from "node:assert/strict";
import test from "node:test";

import { cleiraOestwilde, BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { pharos } from "../src/characters/verified-pdf-characters.ts";
import { executeSpellChoice } from "../src/engine/combat-options.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executePointSpell } from "../src/engine/point-effects.ts";
import { executeSkillAction } from "../src/engine/skill-actions.ts";
import { detectDndBeyondEdition } from "../src/importers/dnd-beyond.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { playableCharacter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function ready(character) {
  const state = createEncounter(character, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  return {
    ...state,
    activeIndex: 0,
    selectedTargetId: state.combatants[1].id,
    combatants: state.combatants.map((combatant, index) => ({
      ...combatant,
      creatureType: index === 0 ? combatant.creatureType : "humanoid",
      initiativeRolled: true,
      position: { x: 1 + index, y: 1 },
    })),
    map: { ...state.map, terrain: [] },
  };
}

for (const character of [cleiraOestwilde, pharos]) {
  test(`${character.name} Charm Person supports any humanoid target and social Advantage`, () => {
    const charm = character.spells.find((spell) => spell.id === "charm-person");
    const state = ready(character);
    const cast = executeSpellChoice(state, charm, () => 0);
    assert.equal(cast.legal, true);
    const effect = cast.encounter.effects.find((candidate) => candidate.name === "Charm Person");
    assert.equal(effect.socialInteractionAdvantageForSource, true);
    assert.equal(effect.targetFriendlyToSource, true);

    const influenceState = { ...cast.encounter, selectedTargetId: state.combatants[1].id, turn: { ...cast.encounter.turn, action: true } };
    const rolls = [0.1, 0.9];
    const influence = executeSkillAction(influenceState, "influence", "persuasion", () => rolls.shift() ?? 0);
    assert.equal(influence.legal, true);
    assert.equal(influence.roll.mode, "advantage");
    assert.match(influence.summary, /regards the caster as friendly/i);

    const ally = { ...state.combatants[1], id: `${character.id}-ally`, name: "Friendly Humanoid", side: "player", position: { x: 2, y: 2 } };
    const friendlyState = { ...state, selectedTargetId: ally.id, combatants: [...state.combatants, ally] };
    const friendlyCast = executeSpellChoice(friendlyState, charm, () => 0);
    assert.equal(friendlyCast.legal, true);
  });
}

test("Druidcraft records adjudicated weather and authored sensory details", () => {
  const spell = pharos.spells.find((candidate) => candidate.id === "druidcraft");
  const state = ready(pharos);
  const missing = executePointSpell(state, spell, [{ x: 2, y: 2 }], () => 0, "weather");
  assert.equal(missing.legal, false);
  const weather = executePointSpell(state, spell, [{ x: 2, y: 2 }], () => 0, "weather", "Snow after sunset");
  assert.equal(weather.legal, true);
  assert.match(weather.summary, /snow after sunset/i);
  const sensory = executePointSpell({ ...weather.encounter, turn: { ...weather.encounter.turn, action: true } }, spell, [{ x: 3, y: 2 }], () => 0, "sensory", "A raven call from the north");
  assert.equal(sensory.legal, true);
  assert.match(sensory.summary, /raven call/i);
});

test("flattened-sheet clues identify rulesets without guessing ambiguous sheets", () => {
  assert.equal(detectDndBeyondEdition(["Weapon Mastery"], "Fighter", 1).edition, "dnd-2024");
  assert.equal(detectDndBeyondEdition(["Divine Sense"], "Paladin", 1).edition, "dnd-2014");
  assert.equal(detectDndBeyondEdition(["Divine Sense", "Weapon Mastery"], "Paladin", 1).edition, "mixed");
  assert.equal(detectDndBeyondEdition(["Second Wind"], "Fighter", 1).edition, "uncertain");
});

test("an imported source without attacks stays unchanged while its playable profile gains a baseline", () => {
  const source = {
    id: "fresh-import",
    name: "Fresh Import",
    className: "Adventurer",
    level: 1,
    armorClass: 12,
    hitPoints: { current: 8, maximum: 8 },
    proficiencyBonus: 2,
    abilities: { strength: 14, dexterity: 10, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 },
    resources: [],
    attacks: [],
    spells: [],
    source: { format: "flattened-pdf", fileName: "fresh.pdf", importedAt: "2026-09-20T00:00:00.000Z" },
  };
  const before = structuredClone(source);
  const derived = playableCharacter(source);
  assert.deepEqual(source, before);
  assert.equal(derived.character.attacks.length, 1);
  assert.equal(derived.character.attacks[0].name, "Unarmed Strike");
  assert.match(derived.notes.join(" "), /source contained no parsed attacks/i);
});

test("registry coverage leaves only lawfully descriptive Control Flames", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  const sum = (key) => reports.reduce((total, report) => total + report.supportSummary[key], 0);
  assert.equal(sum("fullySupported"), 98);
  assert.equal(sum("partial"), 0);
  assert.equal(sum("descriptive"), 1);
  const remaining = reports.flatMap((report) => report.entries).filter((entry) => entry.status !== "supported");
  assert.deepEqual(remaining.map((entry) => entry.name), ["Control Flames"]);
});

