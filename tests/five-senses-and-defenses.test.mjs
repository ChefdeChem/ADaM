import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { goliathBarbarian, pharos, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { applyDamageToCombatant, executeSpellChoice, validateAttackTarget, validateSpellChoice } from "../src/engine/combat-options.ts";
import { applyEffect, canHarmTarget, savingThrowRollMode } from "../src/engine/effects.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter(character, difficulty = "easy") {
  const state = createEncounter(character, generateScriptedScenario({
    prompt: "A clear training yard",
    environment: "market",
    objective: "defeat",
    difficulty,
  }));
  const enemy = state.combatants.find((combatant) => combatant.side === "enemy");
  return {
    ...state,
    activeIndex: 0,
    selectedTargetId: enemy.id,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant, index) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10 - index,
      initiativeRolled: true,
      position: combatant.side === "player" ? { x: 1, y: 1 } : { x: 2 + index, y: 1 },
    })),
  };
}

function sequence(...values) {
  return () => values.shift() ?? 0;
}

test("the five mechanics raise executable coverage from 55 to 60 without changing the registry size", () => {
  const reports = BUILT_IN_CHARACTERS.map((character) => buildCharacterMechanicCoverage(character));
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(reports.reduce((total, report) => total + report.executable, 0), 85);

  const expected = [
    ["cleira-oestwilde", "charm-person", "srd-5.1"],
    ["pharos", "charm-person", "srd-5.1"],
    ["surina-daardendrian", "divine-sense", "srd-5.1"],
    ["cleira-oestwilde", "fey-ancestry", "srd-5.1"],
    ["goliath-barbarian", "unarmored-defense", "srd-5.2.1"],
  ];
  for (const [characterId, entityId, sourceId] of expected) {
    const entry = reports.find((report) => report.characterId === characterId).entries.find((candidate) => candidate.entityId === entityId && candidate.kind !== "resource");
    assert.equal(entry.status, "supported", `${characterId}:${entityId}`);
    assert.equal(entry.executable, true, `${characterId}:${entityId}`);
    assert.equal(entry.sourceId, sourceId, `${characterId}:${entityId}`);
    assert.deepEqual(entry.missingCapabilities, [], `${characterId}:${entityId}`);
  }
});

test("both verified Charm Person spells are official, executable condition effects", () => {
  for (const character of [cleiraOestwilde, pharos]) {
    const spell = character.spells.find((candidate) => candidate.id === "charm-person");
    assert.equal(spell.unsupportedReason, undefined);
    assert.deepEqual(spell.targetCreatureTypes, ["humanoid"]);
    assert.equal(spell.hostileSaveAdvantage, true);
    assert.equal(spell.effect.conditionGranted, "charmed");
    assert.equal(spell.provenance.sourceId, "srd-5.1");
  }
});

test("Charm Person rejects non-humanoids before spending its slot", () => {
  const state = readyEncounter(cleiraOestwilde, "standard");
  const construct = state.combatants.find((combatant) => combatant.creatureType === "construct");
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "charm-person");
  const validation = validateSpellChoice({ ...state, selectedTargetId: construct.id }, spell);
  assert.equal(validation.legal, false);
  assert.match(validation.reason, /humanoid.*construct/i);
  assert.equal(state.combatants[0].resources.find((resource) => resource.kind === "spell-slot").current, 2);
});

test("Charm Person grants the hostile target advantage and applies Charmed on a failed save", () => {
  const state = readyEncounter(cleiraOestwilde);
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "charm-person");
  const cast = executeSpellChoice(state, spell, sequence(0, 0));
  const target = cast.encounter.combatants.find((combatant) => combatant.id === state.selectedTargetId);
  assert.equal(cast.legal, true);
  assert.deepEqual(cast.roll.rolls, [1, 1]);
  assert.match(cast.summary, /with advantage/i);
  assert.ok(target.conditions.includes("charmed"));
  assert.equal(canHarmTarget(cast.encounter, target.id, cleiraOestwilde.id), false);
});

test("a charmed creature cannot attack its charmer and the effect ends when the caster harms it", () => {
  const state = readyEncounter(cleiraOestwilde);
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "charm-person");
  const cast = executeSpellChoice(state, spell, sequence(0, 0));
  const targetId = state.selectedTargetId;
  const targetIndex = cast.encounter.combatants.findIndex((combatant) => combatant.id === targetId);
  const attackState = { ...cast.encounter, activeIndex: targetIndex, selectedTargetId: cleiraOestwilde.id, turn: { ...cast.encounter.turn, action: true } };
  const attack = attackState.combatants[targetIndex].attacks[0];
  assert.equal(validateAttackTarget(attackState, attack, cleiraOestwilde.id).legal, false);

  const harmed = applyDamageToCombatant(cast.encounter, targetId, 1, { damageType: "psychic", sourceCombatantId: cleiraOestwilde.id });
  assert.equal(harmed.effects.some((effect) => effect.name === "Charm Person"), false);
  assert.equal(harmed.combatants.find((combatant) => combatant.id === targetId).conditions.includes("charmed"), false);
});

test("Fey Ancestry grants charm-save advantage and blocks magical sleep", () => {
  const state = readyEncounter(cleiraOestwilde);
  assert.equal(savingThrowRollMode(state, cleiraOestwilde.id, "charmed"), "advantage");
  const slept = applyEffect(state, {
    name: "Magical Sleep",
    description: "A magical sleep test effect.",
    sourceCombatantId: state.selectedTargetId,
    targetCombatantId: cleiraOestwilde.id,
    conditionGranted: "magical sleep",
  });
  assert.equal(slept.combatants.find((combatant) => combatant.id === cleiraOestwilde.id).conditions.includes("magical sleep"), false);
});

test("Divine Sense reports visible qualifying creatures, excludes total cover, and detects sacred presence", () => {
  const state = readyEncounter(surinaDaardendrian, "hard");
  const enemies = state.combatants.filter((combatant) => combatant.side === "enemy");
  const prepared = {
    ...state,
    map: { ...state.map, terrain: [{ x: 3, y: 1, kind: "wall", label: "Wall" }, { x: 2, y: 2, kind: "objective", label: "Shrine", divineAura: "consecrated" }] },
    combatants: state.combatants.map((combatant) => combatant.id === enemies[0].id
      ? { ...combatant, creatureType: "undead", position: { x: 2, y: 1 } }
      : combatant.id === enemies[1].id
        ? { ...combatant, creatureType: "fiend", position: { x: 4, y: 1 } }
        : combatant),
  };
  const feature = surinaDaardendrian.featureActions.find((candidate) => candidate.id === "divine-sense");
  const result = executeFeatureAction(prepared, feature);
  assert.equal(result.legal, true);
  assert.match(result.summary, /undead at 2,1/i);
  assert.doesNotMatch(result.summary, /fiend at 4,1/i);
  assert.match(result.summary, /consecrated presence/i);
  assert.equal(result.encounter.turn.action, false);
  assert.equal(result.encounter.combatants[0].resources.find((resource) => resource.id === "divine-sense").current, 2);
  assert.deepEqual(result.encounter.effects.find((effect) => effect.name === "Divine Sense").expiresAt, { round: 2, combatantId: surinaDaardendrian.id, phase: "end" });
});

test("Unarmored Defense calculates the Goliath's AC and yields to worn armor", () => {
  const unarmored = createEncounter({ ...goliathBarbarian, armorClass: 9 }, generateScriptedScenario("easy crypt fight"));
  assert.equal(unarmored.combatants[0].baseArmorClass, 13);

  const armoredCharacter = {
    ...goliathBarbarian,
    armorClass: 15,
    profile: { ...goliathBarbarian.profile, equipment: [...goliathBarbarian.profile.equipment, { name: "Hide Armor", quantity: 1 }] },
  };
  const armored = createEncounter(armoredCharacter, generateScriptedScenario("easy crypt fight"));
  assert.equal(armored.combatants[0].baseArmorClass, 15);
});
