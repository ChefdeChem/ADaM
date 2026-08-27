import assert from "node:assert/strict";
import test from "node:test";

import { executeAttackChoice, executeSpellChoice, resolveAttackDamage, resolveAttackRoll, validateAttackChoice, validateAttackTarget } from "../src/engine/combat-options.ts";
import { applyEffect, effectiveArmorClass, expireEffectsAtTurnStart, minutesToRounds } from "../src/engine/effects.ts";
import { visibleActionsForMode } from "../src/engine/actions.ts";
import { rollCombatantInitiative } from "../src/engine/encounter.ts";

const map = { width: 12, height: 8, terrain: [] };

function encounter() {
  return {
    round: 1,
    activeIndex: 0,
    selectedTargetId: "enemy",
    combatants: [
      {
        id: "hero", name: "Hero", side: "player", baseArmorClass: 15, baseSpeedFeet: 30,
        hitPoints: { current: 20, maximum: 20 }, temporaryHitPoints: 0,
        resources: [{ id: "slot-1", name: "Level 1 Spell Slots", kind: "spell-slot", level: 1, current: 1, maximum: 1 }],
        initiative: 15, initiativeModifier: 3, initiativeRolled: true, position: { x: 1, y: 1 },
      },
      {
        id: "enemy", name: "Enemy", side: "enemy", baseArmorClass: 13, baseSpeedFeet: 30,
        hitPoints: { current: 10, maximum: 10 }, temporaryHitPoints: 0, resources: [],
        initiative: 10, initiativeModifier: 0, initiativeRolled: true, position: { x: 7, y: 1 },
      },
    ],
    effects: [],
    map,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30 },
    log: [],
  };
}

test("ten minutes converts to one hundred six-second rounds", () => {
  assert.equal(minutesToRounds(10), 100);
});

test("temporary modifiers derive AC without replacing the base value", () => {
  const active = applyEffect(encounter(), {
    name: "Arcane Guard", description: "+2 AC until the next turn.", sourceCombatantId: "hero", targetCombatantId: "hero",
    durationRounds: 1, modifiers: { armorClass: 2 },
  });
  assert.equal(active.combatants[0].baseArmorClass, 15);
  assert.equal(effectiveArmorClass(active, "hero"), 17);
  const expired = expireEffectsAtTurnStart({ ...active, round: 2 }, 2, "hero");
  assert.equal(expired.effects.length, 0);
  assert.equal(effectiveArmorClass(expired, "hero"), 15);
});

test("ranged attacks beyond normal range remain legal with disadvantage", () => {
  const attack = { id: "dagger", name: "Thrown Dagger", kind: "ranged", attackBonus: 3, damage: "1d4 + 1", normalRangeFeet: 20, longRangeFeet: 60 };
  const validation = validateAttackChoice(encounter(), attack);
  assert.equal(validation.legal, true);
  assert.equal(validation.rollMode, "disadvantage");
  const values = [0.95, 0];
  const result = executeAttackChoice(encounter(), attack, () => values.shift());
  assert.equal(result.legal, true);
  assert.equal(result.roll.mode, "disadvantage");
  assert.deepEqual(result.roll.rolls, [20, 1]);
  assert.equal(result.roll.total, 4);
});

test("weapon-first targeting finds ranged targets before one is selected", () => {
  const state = { ...encounter(), selectedTargetId: null };
  const shortbow = { id: "shortbow", name: "Shortbow", kind: "ranged", attackBonus: 5, damage: "1d6+3 piercing", normalRangeFeet: 80, longRangeFeet: 320 };
  const validation = validateAttackTarget(state, shortbow, "enemy");
  assert.equal(validation.legal, true);
  assert.equal(validation.rollMode, "normal");
  assert.equal(validation.distanceFeet, 30);
});

test("attack and damage require separate rolls before target HP changes", () => {
  const attack = { id: "shortbow", name: "Shortbow", kind: "ranged", attackBonus: 5, damage: "1d6+3 piercing", normalRangeFeet: 80, longRangeFeet: 320 };
  const attackResult = resolveAttackRoll(encounter(), attack, () => 0.7);
  assert.equal(attackResult.legal, true);
  assert.equal(attackResult.hit, true);
  assert.equal(attackResult.encounter.combatants[1].hitPoints.current, 10);
  const damageResult = resolveAttackDamage(attackResult.encounter, attack, "enemy", false, () => 0.5);
  assert.equal(damageResult.legal, true);
  assert.equal(damageResult.roll.total, 7);
  assert.equal(damageResult.encounter.combatants[1].hitPoints.current, 3);
});

test("critical damage doubles dice without doubling the modifier", () => {
  const attack = { id: "shortbow", name: "Shortbow", kind: "ranged", attackBonus: 5, damage: "1d6+3 piercing", normalRangeFeet: 80, longRangeFeet: 320 };
  const result = resolveAttackDamage(encounter(), attack, "enemy", true, () => 0);
  assert.equal(result.legal, true);
  assert.deepEqual(result.roll.rolls, [1, 1]);
  assert.equal(result.roll.total, 5);
  assert.equal(result.encounter.combatants[1].hitPoints.current, 5);
});

test("initiative is rolled one combatant at a time and then sorted", () => {
  const state = { ...encounter(), combatants: encounter().combatants.map((combatant) => ({ ...combatant, initiative: 0, initiativeRolled: false })) };
  const heroRoll = rollCombatantInitiative(state, "hero", () => 0.45);
  assert.equal(heroRoll.roll.total, 13);
  assert.equal(heroRoll.encounter.combatants[0].id, "hero");
  const enemyRoll = rollCombatantInitiative(heroRoll.encounter, "enemy", () => 0.95);
  assert.equal(enemyRoll.roll.total, 20);
  assert.equal(enemyRoll.encounter.combatants[0].id, "enemy");
});
test("beginner mode keeps imported weapon attacks discoverable before target selection", () => {
  const state = { ...encounter(), selectedTargetId: null };
  const character = {
    id: "hero", name: "Hero", className: "Ranger", level: 4, armorClass: 15, proficiencyBonus: 2,
    hitPoints: { current: 20, maximum: 20 }, abilities: { strength: 10, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 14, charisma: 8 },
    resources: [], attacks: [{ id: "shortbow", name: "Shortbow", kind: "ranged", attackBonus: 5, damage: "1d6+3 piercing", normalRangeFeet: 80, longRangeFeet: 320 }],
    source: { format: "flattened-pdf", importedAt: "2026-08-27T00:00:00.000Z" },
  };
  const actions = visibleActionsForMode(character, "dnd-2024", "beginner", state);
  assert.equal(actions.some((action) => action.id === "attack"), true);
  assert.equal(validateAttackChoice(state, character.attacks[0]).legal, false);
});

test("leveled spells spend their matching slot and apply temporary hit points", () => {
  const spell = {
    id: "false-life", name: "False Life", level: 1, castingTime: "action", rangeFeet: 0,
    target: "self", requiresLineOfSight: false, durationRounds: 600,
    effect: { name: "False Life", description: "Temporary vitality.", temporaryHitPoints: 7 },
  };
  const result = executeSpellChoice(encounter(), spell);
  assert.equal(result.legal, true);
  assert.equal(result.encounter.combatants[0].resources[0].current, 0);
  assert.equal(result.encounter.combatants[0].temporaryHitPoints, 7);
  assert.equal(result.encounter.effects[0].expiresAt.round, 601);
});
