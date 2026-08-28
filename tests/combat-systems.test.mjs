import assert from "node:assert/strict";
import test from "node:test";

import { executeAttackChoice, executeSpellChoice, resolveAttackDamage, resolveAttackRoll, validateAttackChoice, validateAttackTarget } from "../src/engine/combat-options.ts";
import { applyEffect, effectiveArmorClass, expireEffectsAtTurnStart, minutesToRounds } from "../src/engine/effects.ts";
import { actionCatalog, consumeAction, visibleActionsForMode } from "../src/engine/actions.ts";
import { rollCombatantInitiative, rollPlayerAndEnemyInitiative } from "../src/engine/encounter.ts";
import { combatOutcome, enemyHealthLabel, resolveEnemyTurn } from "../src/engine/enemy-turns.ts";
import { chooseOpportunityAttack, queueConcentrationCheck, resolveAttackReaction, resolveConcentrationResponse, resolveSavingThrowResponse, rollDeathSave, rollOpportunityAttack, rollOpportunityDamage } from "../src/engine/responses.ts";
import { legalMovementDestinations, moveActiveCombatant } from "../src/engine/movement.ts";

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
        attacks: [], savingThrowModifiers: { strength: 0, dexterity: 3, constitution: 2, intelligence: 0, wisdom: 1, charisma: 0 },
        reactionAvailable: true, reactionOptions: [], abilities: [], usedAbilityIds: [], deathSaves: { successes: 0, failures: 0 }, stabilized: false,
      },
      {
        id: "enemy", name: "Enemy", side: "enemy", baseArmorClass: 13, baseSpeedFeet: 30,
        hitPoints: { current: 10, maximum: 10 }, temporaryHitPoints: 0, resources: [],
        initiative: 10, initiativeModifier: 0, initiativeRolled: true, position: { x: 7, y: 1 },
        attacks: [{ id: "shortbow", name: "Shortbow", kind: "ranged", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 80, longRangeFeet: 320 }],
        savingThrowModifiers: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
        reactionAvailable: true, reactionOptions: [], abilities: [], usedAbilityIds: [], deathSaves: { successes: 0, failures: 0 }, stabilized: false,
        tacticId: "ranged-skirmisher",
      },
    ],
    effects: [],
    map,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false },
    pendingResponse: null,
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

test("ranged attacks have disadvantage while a hostile creature is within five feet", () => {
  const state = encounter();
  const adjacent = { ...state.combatants[1], position: { x: 2, y: 1 } };
  const attack = { id: "crossbow", name: "Light Crossbow", kind: "ranged", attackBonus: 3, damage: "1d8 + 1", normalRangeFeet: 80, longRangeFeet: 320 };
  const validation = validateAttackChoice({ ...state, combatants: [state.combatants[0], adjacent] }, attack);
  assert.equal(validation.legal, true);
  assert.equal(validation.rollMode, "disadvantage");
});

test("Dash adds movement and movement can be split around other turn choices", () => {
  const state = encounter();
  const dash = actionCatalog.find((action) => action.id === "dash");
  const dashed = consumeAction(dash, state);
  assert.equal(dashed.turn.action, false);
  assert.equal(dashed.turn.movementRemaining, 60);
  const firstStep = moveActiveCombatant(dashed, 2, 1);
  const secondStep = moveActiveCombatant(firstStep.encounter, 3, 1);
  assert.equal(firstStep.legal, true);
  assert.equal(secondStep.legal, true);
  assert.equal(secondStep.encounter.turn.movementRemaining, 50);
});

test("all legally reachable movement squares can be selected with one tap", () => {
  const state = encounter();
  const destinations = legalMovementDestinations(state);
  const destination = destinations.find((cell) => cell.x === 6 && cell.y === 1);
  assert.equal(destination.cost, 25);
  assert.equal(destination.path.length, 5);
  const moved = moveActiveCombatant(state, 6, 1);
  assert.equal(moved.legal, true);
  assert.deepEqual(moved.encounter.combatants[0].position, { x: 6, y: 1 });
  assert.equal(moved.encounter.turn.movementRemaining, 5);
});

test("ADaM automatically rolls an enemy opportunity attack when the player leaves reach", () => {
  const state = encounter();
  const enemy = { ...state.combatants[1], position: { x: 2, y: 1 }, attacks: [{ id: "sword", name: "Sword", kind: "melee", attackBonus: 5, damage: "1d6 + 2 slashing", normalRangeFeet: 5 }] };
  const values = [0.7, 0];
  const result = moveActiveCombatant({ ...state, combatants: [state.combatants[0], enemy] }, 0, 3, () => values.shift());
  assert.equal(result.legal, true);
  assert.equal(result.attackRoll.total, 20);
  assert.equal(result.damageRoll.total, 3);
  assert.equal(result.encounter.combatants[0].hitPoints.current, 17);
  assert.deepEqual(result.encounter.combatants[0].position, { x: 0, y: 3 });
  assert.equal(result.encounter.combatants[1].reactionAvailable, false);
});

test("Disengage prevents opportunity attacks for the rest of the turn", () => {
  const state = encounter();
  const enemy = { ...state.combatants[1], position: { x: 2, y: 1 }, attacks: [{ id: "sword", name: "Sword", kind: "melee", attackBonus: 20, damage: "1d6 + 2 slashing", normalRangeFeet: 5 }] };
  const disengage = actionCatalog.find((action) => action.id === "disengage");
  const prepared = consumeAction(disengage, { ...state, combatants: [state.combatants[0], enemy] });
  const result = moveActiveCombatant(prepared, 0, 1, () => 0.99);
  assert.equal(prepared.turn.disengaged, true);
  assert.equal(result.attackRoll, null);
  assert.equal(result.encounter.combatants[0].hitPoints.current, 20);
  assert.equal(result.encounter.combatants[1].reactionAvailable, true);
});

test("a Shield reaction resumes the remaining one-tap movement path", () => {
  const state = encounter();
  const hero = { ...state.combatants[0], reactionOptions: [{ id: "shield", name: "Shield", kind: "armor-class", armorClassBonus: 5, spellLevel: 1, description: "+5 AC." }] };
  const enemy = { ...state.combatants[1], position: { x: 2, y: 1 }, attacks: [{ id: "sword", name: "Sword", kind: "melee", attackBonus: 5, damage: "1d6 + 2 slashing", normalRangeFeet: 5 }] };
  const started = moveActiveCombatant({ ...state, combatants: [hero, enemy] }, 0, 3, () => 0.65);
  assert.equal(started.encounter.pendingResponse.type, "attack-reaction");
  assert.deepEqual(started.encounter.pendingResponse.continuation.destination, { x: 0, y: 3 });
  const shielded = resolveAttackReaction(started.encounter, "shield");
  assert.equal(shielded.damageRoll, null);
  assert.equal(shielded.encounter.pendingResponse, null);
  assert.deepEqual(shielded.encounter.combatants[0].position, { x: 0, y: 3 });
  assert.equal(shielded.encounter.combatants[0].resources[0].current, 0);
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

test("the player rolls once while ADaM automatically rolls enemy initiative", () => {
  const state = { ...encounter(), combatants: encounter().combatants.map((combatant) => ({ ...combatant, initiative: 0, initiativeRolled: false })) };
  const values = [0.45, 0.95];
  const result = rollPlayerAndEnemyInitiative(state, "hero", () => values.shift());
  assert.equal(result.playerRoll.total, 13);
  assert.equal(result.enemyRolls.length, 1);
  assert.equal(result.enemyRolls[0].roll.total, 20);
  assert.equal(result.encounter.combatants.every((combatant) => combatant.initiativeRolled), true);
  assert.equal(result.encounter.combatants[0].id, "enemy");
});

test("ADaM resolves an enemy attack and damage without player roll prompts", () => {
  const state = { ...encounter(), activeIndex: 1, selectedTargetId: null, turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false } };
  const values = [0.7, 0];
  const result = resolveEnemyTurn(state, () => values.shift());
  assert.equal(result.attackRoll.total, 19);
  assert.equal(result.damageRoll.total, 3);
  assert.equal(result.encounter.combatants[0].hitPoints.current, 17);
  assert.deepEqual(result.steps.map((step) => step.kind), ["attack", "damage"]);
});

test("enemy tactical decisions scale across beginner intermediate and advanced modes", () => {
  const base = encounter();
  const ability = { id: "burst", name: "Arc Burst", kind: "saving-throw", saveAbility: "dexterity", saveDc: 12, damage: "2d6 force", damageOnSuccess: "half", rangeFeet: 60, requiresLineOfSight: true, uses: 1, description: "Dexterity save." };
  const weak = { id: "weak-bow", name: "Practice Bow", kind: "ranged", attackBonus: 4, damage: "1d4 piercing", normalRangeFeet: 80, longRangeFeet: 320 };
  const strong = { id: "strong-bow", name: "Heavy Bow", kind: "ranged", attackBonus: 5, damage: "1d10 + 3 piercing", normalRangeFeet: 80, longRangeFeet: 320 };
  const enemy = { ...base.combatants[1], attacks: [weak, strong], abilities: [ability] };
  const state = { ...base, activeIndex: 1, selectedTargetId: null, combatants: [base.combatants[0], enemy], map: { ...map, terrain: [{ x: 8, y: 1, kind: "cover", label: "Stone cover" }] }, turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false } };

  const beginnerValues = [0.7, 0];
  const beginner = resolveEnemyTurn(state, "beginner", () => beginnerValues.shift());
  assert.equal(beginner.encounter.pendingResponse, null);
  assert.match(beginner.steps.find((step) => step.kind === "attack").summary, /Practice Bow/);
  assert.deepEqual(beginner.encounter.combatants[1].position, { x: 7, y: 1 });

  const intermediate = resolveEnemyTurn(state, "training", () => 0.5);
  assert.equal(intermediate.encounter.pendingResponse.type, "saving-throw");
  assert.equal(intermediate.encounter.pendingResponse.ability.id, "burst");

  const advancedState = { ...state, combatants: [state.combatants[0], { ...enemy, abilities: [] }] };
  const advancedValues = [0.7, 0];
  const advanced = resolveEnemyTurn(advancedState, "advanced", () => advancedValues.shift());
  assert.deepEqual(advanced.encounter.combatants[1].position, { x: 8, y: 1 });
  assert.match(advanced.steps.find((step) => step.kind === "attack").summary, /Heavy Bow/);
});

test("a retreating enemy pauses for the player's opportunity attack rolls", () => {
  const state = encounter();
  const hero = { ...state.combatants[0], attacks: [{ id: "staff", name: "Quarterstaff", kind: "melee", attackBonus: 5, damage: "1d6 + 3 bludgeoning", normalRangeFeet: 5 }] };
  const enemy = { ...state.combatants[1], position: { x: 2, y: 1 }, hitPoints: { current: 12, maximum: 12 }, abilities: [] };
  const enemyTurn = { ...state, activeIndex: 1, selectedTargetId: null, combatants: [hero, enemy], turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false } };
  const planned = resolveEnemyTurn(enemyTurn, () => 0.5);
  assert.equal(planned.encounter.pendingResponse.type, "opportunity-attack");
  assert.equal(planned.encounter.pendingResponse.phase, "choice");
  assert.deepEqual(planned.encounter.combatants[1].position, { x: 2, y: 1 });
  const chosen = chooseOpportunityAttack(planned.encounter, "staff");
  assert.equal(chosen.encounter.pendingResponse.phase, "attack-roll");
  const attack = rollOpportunityAttack(chosen.encounter, () => 0.7);
  assert.equal(attack.playerRoll.total, 20);
  assert.equal(attack.encounter.pendingResponse.phase, "damage-roll");
  const damage = rollOpportunityDamage(attack.encounter, () => 0);
  assert.equal(damage.damageRoll.total, 4);
  assert.equal(damage.encounter.combatants[1].hitPoints.current, 8);
  assert.equal(damage.encounter.pendingResponse, null);
  assert.equal(damage.encounter.combatants[0].reactionAvailable, false);
  assert.notDeepEqual(damage.encounter.combatants[1].position, { x: 2, y: 1 });
});

test("enemy abilities pause the DM turn for a player saving throw", () => {
  const state = encounter();
  const ability = { id: "cinder-flask", name: "Cinder Flask", kind: "saving-throw", saveAbility: "dexterity", saveDc: 12, damage: "2d6 fire", damageOnSuccess: "half", rangeFeet: 60, requiresLineOfSight: true, uses: 1, description: "Dexterity save for half damage." };
  const enemy = { ...state.combatants[1], abilities: [ability] };
  const enemyTurn = { ...state, activeIndex: 1, selectedTargetId: null, combatants: [state.combatants[0], enemy], turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false } };
  const result = resolveEnemyTurn(enemyTurn, () => 0.5);
  assert.equal(result.encounter.pendingResponse.type, "saving-throw");
  assert.equal(result.encounter.pendingResponse.ability.id, "cinder-flask");
  assert.equal(result.damageRoll, null);
  const values = [0.55, 0, 0];
  const save = resolveSavingThrowResponse(result.encounter, () => values.shift());
  assert.equal(save.playerRoll.total, 15);
  assert.equal(save.damageRoll.total, 2);
  assert.equal(save.encounter.combatants[0].hitPoints.current, 19);
  assert.equal(save.encounter.pendingResponse, null);
});

test("Shield uses a reaction and spell slot before enemy damage is rolled", () => {
  const state = encounter();
  const hero = { ...state.combatants[0], reactionOptions: [{ id: "shield", name: "Shield", kind: "armor-class", armorClassBonus: 5, spellLevel: 1, description: "+5 AC." }] };
  const enemyTurn = { ...state, activeIndex: 1, selectedTargetId: null, combatants: [hero, state.combatants[1]], turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false } };
  const attack = resolveEnemyTurn(enemyTurn, () => 0.7);
  assert.equal(attack.encounter.pendingResponse.type, "attack-reaction");
  assert.equal(attack.encounter.combatants[0].hitPoints.current, 20);
  const shield = resolveAttackReaction(attack.encounter, "shield", () => 0);
  assert.equal(shield.damageRoll, null);
  assert.equal(shield.encounter.combatants[0].hitPoints.current, 20);
  assert.equal(shield.encounter.combatants[0].reactionAvailable, false);
  assert.equal(shield.encounter.combatants[0].resources[0].current, 0);
  assert.equal(effectiveArmorClass(shield.encounter, "hero"), 20);
});

test("damage queues a concentration check and a failed save ends concentration", () => {
  const concentrating = applyEffect(encounter(), { name: "Blur", description: "Concentration.", sourceCombatantId: "hero", targetCombatantId: "hero", durationRounds: 10, concentration: true });
  const queued = queueConcentrationCheck(concentrating, "hero", 22);
  assert.equal(queued.pendingResponse.type, "concentration-check");
  assert.equal(queued.pendingResponse.dc, 11);
  const result = resolveConcentrationResponse(queued, () => 0.3);
  assert.equal(result.playerRoll.total, 9);
  assert.equal(result.encounter.effects.length, 0);
  assert.equal(result.encounter.pendingResponse, null);
});

test("death saves track failures and a natural 20 restores consciousness", () => {
  const state = encounter();
  const unconscious = { ...state, combatants: state.combatants.map((combatant) => combatant.id === "hero" ? { ...combatant, hitPoints: { ...combatant.hitPoints, current: 0 } } : combatant) };
  const naturalOne = rollDeathSave(unconscious, "hero", () => 0);
  assert.equal(naturalOne.encounter.combatants[0].deathSaves.failures, 2);
  assert.equal(combatOutcome(naturalOne.encounter), "active");
  const naturalTwenty = rollDeathSave(unconscious, "hero", () => 0.99);
  assert.equal(naturalTwenty.encounter.combatants[0].hitPoints.current, 1);
  assert.deepEqual(naturalTwenty.encounter.combatants[0].deathSaves, { successes: 0, failures: 0 });
  const firstSuccess = rollDeathSave(unconscious, "hero", () => 0.5);
  const secondSuccess = rollDeathSave(firstSuccess.encounter, "hero", () => 0.5);
  const thirdSuccess = rollDeathSave(secondSuccess.encounter, "hero", () => 0.5);
  assert.equal(thirdSuccess.encounter.combatants[0].stabilized, true);
  assert.equal(combatOutcome(thirdSuccess.encounter), "stabilized");
});

test("a melee enemy moves into range before ADaM resolves its attack", () => {
  const state = encounter();
  const meleeEnemy = {
    ...state.combatants[1],
    attacks: [{ id: "maul", name: "Stone Maul", kind: "melee", attackBonus: 5, damage: "1d8 + 3 bludgeoning", normalRangeFeet: 5 }],
    tacticId: "melee-brute",
  };
  const enemyTurn = { ...state, activeIndex: 1, selectedTargetId: null, combatants: [state.combatants[0], meleeEnemy], turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false } };
  const values = [0.7, 0];
  const result = resolveEnemyTurn(enemyTurn, () => values.shift());
  assert.equal(result.steps[0].kind, "move");
  assert.equal(result.steps.some((step) => step.kind === "attack"), true);
  assert.equal(result.steps.some((step) => step.kind === "damage"), true);
  assert.equal(result.encounter.turn.movementRemaining, 5);
  assert.equal(Math.max(Math.abs(result.encounter.combatants[1].position.x - 1), Math.abs(result.encounter.combatants[1].position.y - 1)), 1);
  assert.equal(result.encounter.combatants[0].hitPoints.current, 16);
});

test("enemy health information scales with experience mode", () => {
  const enemy = { ...encounter().combatants[1], hitPoints: { current: 4, maximum: 10 } };
  assert.equal(enemyHealthLabel(enemy, "beginner"), "4/10 HP");
  assert.equal(enemyHealthLabel(enemy, "training"), "Bloodied");
  assert.equal(enemyHealthLabel(enemy, "advanced"), "Health concealed");
  assert.equal(combatOutcome({ ...encounter(), combatants: encounter().combatants.map((combatant) => combatant.side === "enemy" ? { ...combatant, hitPoints: { ...combatant.hitPoints, current: 0 } } : combatant) }), "victory");
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
