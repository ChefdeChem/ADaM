import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { goliathBarbarian, irvenWeber, pharos } from "../src/characters/verified-pdf-characters.ts";
import { resolveAbilityCheck, rollAbilityCheck } from "../src/engine/ability-checks.ts";
import { executeSpellChoice, resolveAttackDamage } from "../src/engine/combat-options.ts";
import { createEncounter } from "../src/engine/encounter.ts";
import { hasSpellcastingFocus, setLightSourceMode } from "../src/engine/equipment-actions.ts";
import { effectiveSize, effectiveSpeed } from "../src/engine/effects.ts";
import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { executePointSpell, moveLightPoint, resolvePointHazardsForCombatant } from "../src/engine/point-effects.ts";
import { restAlternative } from "../src/engine/rest-traits.ts";
import { availableRollBonusEffects } from "../src/engine/roll-bonuses.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function encounterFor(character) {
  const state = createEncounter(character, generateScriptedScenario({ prompt: "An empty rules laboratory", environment: "market", objective: "defeat", difficulty: "easy" }));
  return {
    ...state,
    activeIndex: 0,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant, index) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10 - index,
      initiativeRolled: true,
      position: combatant.side === "player" ? { x: 1, y: 3 } : { x: 3 + index, y: 3 },
      hitPoints: combatant.side === "enemy" ? { current: 40, maximum: 40 } : combatant.hitPoints,
    })),
  };
}

const player = (state) => state.combatants.find((combatant) => combatant.side === "player");

test("the milestone slice raises executable coverage from 85 to 95 of 99", () => {
  const reports = BUILT_IN_CHARACTERS.map(buildCharacterMechanicCoverage);
  assert.equal(reports.reduce((sum, report) => sum + report.total, 0), 99);
  assert.equal(reports.reduce((sum, report) => sum + report.executable, 0), 95);
  assert.deepEqual(reports.flatMap((report) => report.entries.filter((entry) => !entry.executable).map((entry) => entry.name)).sort(), ["Control Flames", "Disguise Kit", "Druidcraft", "Minor Illusion"]);
});

test("Dancing Lights places up to four lights and moves one with a Bonus Action", () => {
  const state = encounterFor(cleiraOestwilde);
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "dancing-lights");
  const cast = executePointSpell(state, spell, [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 4 }]);
  assert.equal(cast.legal, true);
  const effect = cast.encounter.effects.find((candidate) => candidate.name === "Dancing Lights");
  assert.equal(effect.points.length, 4);
  assert.equal(effect.pointEffect.dimLightFeet, 10);
  assert.equal(effect.concentration, true);
  const moved = moveLightPoint(cast.encounter, effect.id, 0, { x: 4, y: 2 });
  assert.equal(moved.legal, true);
  assert.deepEqual(moved.encounter.effects.find((candidate) => candidate.id === effect.id).points[0], { x: 4, y: 2 });
  assert.equal(moved.encounter.turn.bonusAction, false);
});

test("Bardic Inspiration grants another audible ally an optional d6", () => {
  const state = encounterFor(cleiraOestwilde);
  const source = player(state);
  const ally = { ...source, id: "ally", name: "Ally", position: { x: 2, y: 3 }, resources: [], inventory: [], triggeredFeatures: [], abilityCheckRerolls: [] };
  const withAlly = { ...state, combatants: [...state.combatants, ally] };
  const feature = cleiraOestwilde.featureActions.find((candidate) => candidate.id === "bardic-inspiration");
  const used = executeFeatureAction(withAlly, feature, { targetCombatantId: ally.id });
  assert.equal(used.legal, true);
  assert.equal(player(used.encounter).resources.find((resource) => resource.id === "bardic-inspiration").current, 1);
  const effect = used.encounter.effects.find((candidate) => candidate.name === "Bardic Inspiration");
  assert.deepEqual(["ability-check", "attack-roll", "saving-throw"].map((kind) => availableRollBonusEffects(used.encounter, ally.id, kind).length), [1, 1, 1]);
  const values = [0, 0.99];
  const check = resolveAbilityCheck(used.encounter, ally.id, "Perception", { dc: 8, rollBonusEffectId: effect.id, random: () => values.shift() ?? 0 });
  assert.equal(check.bonusRoll.total, 6);
  assert.equal(check.succeeded, true);
  assert.equal(check.encounter.effects.some((candidate) => candidate.id === effect.id), false);
});

test("Trance records the four-hour semiconscious sleep alternative without changing Long Rest rules", () => {
  const state = encounterFor(cleiraOestwilde);
  assert.deepEqual(restAlternative(state, cleiraOestwilde.id), { sleepRequired: false, meditationHours: 4, semiconscious: true });
});

test("Cleira's carried lute is registered as a Bard spellcasting focus", () => {
  const state = encounterFor(cleiraOestwilde);
  assert.equal(hasSpellcastingFocus(state, cleiraOestwilde.id, "Bard"), true);
  assert.equal(hasSpellcastingFocus(state, cleiraOestwilde.id, "Wizard"), false);
});

test("Savage Attacker rolls weapon damage twice by choice and only once per turn", () => {
  const state = encounterFor(goliathBarbarian);
  const target = state.combatants.find((combatant) => combatant.side === "enemy");
  const attack = goliathBarbarian.attacks.find((candidate) => candidate.id === "maul");
  const values = [0, 0, 0.99, 0.99];
  const first = resolveAttackDamage(state, attack, target.id, false, () => values.shift() ?? 0, goliathBarbarian.id, { weaponDamageRerollChoice: "higher" });
  assert.equal(first.legal, true);
  assert.equal(first.roll.total, 14);
  assert.equal(first.alternateRoll.total, 14);
  assert.deepEqual(first.encounter.turn.usedFeatureIds, ["savage-attacker"]);
  const second = resolveAttackDamage(first.encounter, attack, target.id, false, () => 0, goliathBarbarian.id, { weaponDamageRerollChoice: "higher" });
  assert.equal(second.alternateRoll, undefined);
});

test("Large Form enforces level 5 then applies size, Strength advantage, Speed, duration, and resource use", () => {
  const feature = goliathBarbarian.featureActions.find((candidate) => candidate.id === "large-form");
  const levelOne = executeFeatureAction(encounterFor(goliathBarbarian), feature);
  assert.equal(levelOne.legal, false);
  assert.match(levelOne.reason, /level 5/i);
  const levelFive = { ...goliathBarbarian, level: 5 };
  const state = encounterFor(levelFive);
  const used = executeFeatureAction(state, feature);
  assert.equal(used.legal, true);
  assert.equal(effectiveSize(used.encounter, levelFive.id), "large");
  assert.equal(effectiveSpeed(used.encounter, levelFive.id), 45);
  assert.equal(player(used.encounter).resources.find((resource) => resource.id === "large-form").current, 0);
  const check = rollAbilityCheck(used.encounter, levelFive.id, "strength", (() => { const values = [0, 0.99]; return () => values.shift() ?? 0; })());
  assert.equal(check.roll.mode, "advantage");
  assert.equal(check.roll.natural, 20);
});

test("Hooded Lantern tracks open and hooded light radii plus six hours of fuel", () => {
  const state = encounterFor(goliathBarbarian);
  const lit = setLightSourceMode(state, goliathBarbarian.id, "hooded-lantern", "bright");
  assert.equal(lit.legal, true);
  assert.equal(lit.encounter.turn.bonusAction, false);
  const lantern = player(lit.encounter).inventory.find((item) => item.id === "hooded-lantern").lightSource;
  assert.deepEqual({ mode: lantern.mode, bright: lantern.brightLightFeet, dim: lantern.dimLightFeet, fuel: lantern.fuelMinutesRemaining }, { mode: "bright", bright: 30, dim: 30, fuel: 360 });
  const hooded = setLightSourceMode({ ...lit.encounter, turn: { ...lit.encounter.turn, bonusAction: true } }, goliathBarbarian.id, "hooded-lantern", "hooded");
  assert.equal(player(hooded.encounter).inventory.find((item) => item.id === "hooded-lantern").lightSource.hoodedDimLightFeet, 5);
});

test("Create Bonfire persists on a map point and repeats its Dexterity save", () => {
  const state = encounterFor(irvenWeber);
  const target = state.combatants.find((combatant) => combatant.side === "enemy");
  const spell = irvenWeber.spells.find((candidate) => candidate.id === "create-bonfire");
  const cast = executePointSpell(state, spell, [target.position], () => 0);
  assert.equal(cast.legal, true);
  assert.equal(cast.encounter.effects.some((effect) => effect.pointEffect?.type === "damaging-hazard" && effect.concentration), true);
  assert.equal(cast.encounter.combatants.find((combatant) => combatant.id === target.id).hitPoints.current, 39);
  const repeated = resolvePointHazardsForCombatant(cast.encounter, target.id, () => 0);
  assert.equal(repeated.combatants.find((combatant) => combatant.id === target.id).hitPoints.current, 38);
});

test("Guidance applies an optional d4 to one ability check and consumes the effect", () => {
  const state = encounterFor(pharos);
  const spell = pharos.spells.find((candidate) => candidate.id === "guidance");
  const cast = executeSpellChoice({ ...state, selectedTargetId: pharos.id }, spell);
  assert.equal(cast.legal, true);
  const effect = cast.encounter.effects.find((candidate) => candidate.name === "Guidance");
  const values = [0, 0.99];
  const check = resolveAbilityCheck(cast.encounter, pharos.id, "Persuasion", { dc: 10, rollBonusEffectId: effect.id, random: () => values.shift() ?? 0 });
  assert.equal(check.roll.total, 6);
  assert.equal(check.bonusRoll.total, 4);
  assert.equal(check.total, 10);
  assert.equal(check.encounter.effects.some((candidate) => candidate.id === effect.id), false);
});

test("Honeyed Words rerolls only failed Deception or Persuasion checks and spends only on success", () => {
  const state = encounterFor(pharos);
  const values = [0, 0.9];
  const success = resolveAbilityCheck(state, pharos.id, "Persuasion", { dc: 15, rerollFeatureId: "honeyed-words", random: () => values.shift() ?? 0 });
  assert.equal(success.roll.total, 6);
  assert.equal(success.reroll.total, 24);
  assert.equal(success.succeeded, true);
  assert.equal(player(success.encounter).resources.find((resource) => resource.id === "honeyed-words").current, 0);
  const failures = [0, 0];
  const failed = resolveAbilityCheck(state, pharos.id, "Deception", { dc: 20, rerollFeatureId: "honeyed-words", random: () => failures.shift() ?? 0 });
  assert.equal(failed.succeeded, false);
  assert.equal(player(failed.encounter).resources.find((resource) => resource.id === "honeyed-words").current, 1);
  const arcana = resolveAbilityCheck(state, pharos.id, "Arcana", { dc: 20, rerollFeatureId: "honeyed-words", random: () => 0 });
  assert.equal(arcana.reroll, undefined);
});
