import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { applyEffect, effectiveSpeed, outgoingAttackRollMode, reconcileConcentration } from '../src/engine/effects.ts';
import { applyGrappledStep, grappleEffectsFrom, planGrappledStep, releaseGrapple, resolveGrapple, resolveGrappleEscape, validateGrapple } from '../src/engine/grappling.ts';
import { legalMovementDestinations, moveActiveCombatant } from '../src/engine/movement.ts';
import { resolveEnemyTurn } from '../src/engine/enemy-turns.ts';
import { validateWeaponHands } from '../src/engine/weapon-hands.ts';

function state() {
  const e = createPlayableEncounter(source, generateScriptedScenario({ prompt: '', environment: 'market', objective: 'defeat', difficulty: 'easy' }));
  e.combatants = e.combatants.slice(0, 2).map((c, i) => ({ ...c, position: { x: 1 + i, y: 2 }, initiativeRolled: true, hitPoints: { current: 30, maximum: 30 }, savingThrowModifiers: { ...c.savingThrowModifiers, strength: 0, dexterity: 0 } }));
  e.map.terrain = [];
  e.selectedTargetId = e.combatants[1].id;
  return e;
}

function grapple(e = state(), random = () => 0) {
  return resolveGrapple(e, e.combatants[1].id, random);
}

function hazard(e, targetId, points) {
  return applyEffect(e, { name: 'Dragging hazard', description: 'Synthetic hazard', sourceCombatantId: source.id, targetCombatantId: source.id, points, pointEffect: { type: 'damaging-hazard', sizeFeet: 5, damage: '1d4 cold', save: { ability: 'dexterity', dc: 99, damageOnSuccess: 'none' } } });
}

test('Surina Grapple uses the 2024 DC 13 save, a free hand, and no damage or resource', () => {
  const e = state();
  e.combatants[0].skillModifiers.athletics = 100;
  const before = JSON.stringify(source);
  const r = grapple(e);
  assert.equal(r.legal, true); assert.equal(r.dc, 13); assert.equal(r.saved, false);
  assert.equal(r.encounter.turn.action, false); assert.equal(r.encounter.turn.bonusAction, true);
  assert.equal(r.encounter.combatants[1].hitPoints.current, 30); assert.equal(effectiveSpeed(r.encounter, e.combatants[1].id), 0);
  assert.equal(grappleEffectsFrom(r.encounter, source.id).length, 1);
  assert.deepEqual(r.encounter.combatants[0].resources, e.combatants[0].resources);
  assert.equal(JSON.stringify(source), before);
});

test('the target chooses Strength or Dexterity before rolling, including Dodge and half cover', () => {
  let e = state(); e.combatants[1].savingThrowModifiers.strength = 2;
  e = applyEffect(e, { name: 'Dodge', description: 'test', sourceCombatantId: e.combatants[1].id, targetCombatantId: e.combatants[1].id, modifiers: { dodge: true } });
  let r = grapple(e, () => 0.9); assert.equal(r.saveAbility, 'dexterity'); assert.equal(r.roll.mode, 'advantage'); assert.equal(r.saved, true);
  e = state(); e.map.terrain = [{ x: 2, y: 2, kind: 'cover', label: 'half cover' }];
  r = grapple(e, () => 0.5); assert.equal(r.saveAbility, 'dexterity'); assert.equal(r.roll.modifier, 2); assert.equal(r.saved, true);
});

test('Grappled immunity prevents both the condition and linked effect', () => {
  const e = state(); e.combatants[1].conditionImmunities = ['Grappled'];
  const r = grapple(e);
  assert.equal(r.encounter.effects.some(effect => effect.grapple), false);
  assert.equal(r.encounter.combatants[1].conditions.includes('Grappled'), false);
  assert.match(r.summary, /immune/);
});

test('occupied hands block Grapple and a held target occupies one hand afterward', () => {
  let e = state(); e.combatants[0].heldWeaponIds = ['glaive', 'longsword'];
  assert.equal(validateGrapple(e, e.combatants[1].id).legal, false);
  e = state(); e.combatants[0].heldWeaponIds = ['longsword'];
  const held = grapple(e).encounter;
  const twoHanded = held.combatants[0].attacks.find(a => a.id === 'longsword-two-handed');
  const oneHanded = held.combatants[0].attacks.find(a => a.id === 'longsword');
  assert.equal(validateWeaponHands(held, source.id, twoHanded, false).legal, false);
  assert.equal(validateWeaponHands(held, source.id, oneHanded, false).legal, true);
});

test('a grappled creature attacks its grappler normally and other targets with Disadvantage', () => {
  let e = grapple().encounter;
  const enemyId = e.combatants[1].id;
  e.combatants.push({ ...structuredClone(e.combatants[0]), id: 'ally', name: 'Ally', position: { x: 1, y: 3 } });
  assert.equal(outgoingAttackRollMode(e, enemyId, source.id), 'normal');
  assert.equal(outgoingAttackRollMode(e, enemyId, 'ally'), 'disadvantage');
});

test('escape uses the active creature Action and Athletics or Acrobatics against the stored DC', () => {
  let e = grapple().encounter;
  const effect = grappleEffectsFrom(e, source.id)[0];
  e = { ...e, activeIndex: 1, turn: { ...e.turn, action: true } };
  const failed = resolveGrappleEscape(e, effect.id, 'athletics', () => 0);
  assert.equal(failed.legal, true); assert.equal(failed.succeeded, false); assert.equal(failed.encounter.turn.action, false);
  e = { ...failed.encounter, turn: { ...failed.encounter.turn, action: true } };
  const escaped = resolveGrappleEscape(e, effect.id, 'acrobatics', () => 0.99);
  assert.equal(escaped.succeeded, true); assert.equal(escaped.encounter.effects.some(candidate => candidate.id === effect.id), false);
  assert.equal(effectiveSpeed(escaped.encounter, e.combatants[1].id), e.combatants[1].baseSpeedFeet);
});

test('enemy AI spends its Action attempting escape before movement or offense', () => {
  let e = grapple().encounter;
  e = { ...e, activeIndex: 1, turn: { ...e.turn, action: true, movementRemaining: 30 } };
  const r = resolveEnemyTurn(e, () => 0.99);
  assert.equal(r.steps[0].kind, 'ability'); assert.match(r.steps[0].summary, /escape/);
  assert.equal(r.encounter.turn.action, false); assert.equal(r.encounter.effects.some(effect => effect.grapple), false);
  assert.deepEqual(r.encounter.combatants[1].position, e.combatants[1].position);
  e = grapple().encounter; e.combatants[1].skillModifiers.athletics = 0; e.combatants[1].skillModifiers.acrobatics = 1;
  e = applyEffect(e, { name: 'Athletics advantage', description: 'test', sourceCombatantId: e.combatants[1].id, targetCombatantId: e.combatants[1].id, modifiers: { abilityCheckAdvantages: ['athletics'] } });
  e = { ...e, activeIndex: 1, turn: { ...e.turn, action: true } };
  assert.match(resolveEnemyTurn(e, () => 0.5).steps[0].summary, /athletics/);
});

test('release uses no Action and source incapacitation or forced separation also ends the grapple', () => {
  let e = grapple().encounter;
  const effect = grappleEffectsFrom(e, source.id)[0];
  const released = releaseGrapple(e, effect.id, source.id);
  assert.equal(released.legal, true); assert.equal(released.encounter.turn.action, false); assert.equal(released.encounter.effects.some(f => f.grapple), false);
  e = grapple().encounter;
  const stunned = applyEffect(e, { name: 'Stunned', description: 'test', sourceCombatantId: e.combatants[1].id, targetCombatantId: source.id, conditionGranted: 'Stunned' });
  assert.equal(stunned.effects.some(f => f.grapple), false);
  e = grapple().encounter;
  e = { ...e, combatants: e.combatants.map((c, i) => i === 1 ? { ...c, position: { x: 4, y: 2 } } : c) };
  assert.equal(reconcileConcentration(e).effects.some(f => f.grapple), false);
});

test('moving away drags the target, charges extra movement, and resolves its entered hazard', () => {
  let e = grapple().encounter;
  const targetId = e.combatants[1].id;
  e = hazard(e, targetId, [{ x: 1, y: 2 }]);
  e = { ...e, turn: { ...e.turn, movementRemaining: 30 } };
  const destination = legalMovementDestinations(e).find(cell => cell.x === 0 && cell.y === 2);
  assert.equal(destination.cost, 10);
  const r = moveActiveCombatant(e, 0, 2, () => 0);
  assert.equal(r.legal, true); assert.deepEqual(r.encounter.combatants[1].position, { x: 1, y: 2 });
  assert.equal(r.encounter.turn.movementRemaining, 20); assert.equal(r.encounter.combatants[1].hitPoints.current, 29);
  assert.equal(r.attackRoll, null); assert.equal(r.encounter.combatants[1].reactionAvailable, true);
});

test('circling without moving the target costs normally, while a Large source moves a Small target without the extra cost', () => {
  let e = grapple().encounter;
  e = { ...e, turn: { ...e.turn, movementRemaining: 30 } };
  assert.equal(legalMovementDestinations(e).find(cell => cell.x === 1 && cell.y === 3).cost, 5);
  e = state(); e.combatants[0].size = 'large'; e.combatants[0].position = { x: 1, y: 2 }; e.combatants[1].size = 'small'; e.combatants[1].position = { x: 3, y: 2 };
  e = grapple(e).encounter; e = { ...e, turn: { ...e.turn, movementRemaining: 30 } };
  const plan = planGrappledStep(e, source.id, { x: 0, y: 2 }, 5);
  assert.equal(plan.cost, 5); assert.equal(Math.max(Math.abs(plan.dragged[0].position.x - 3), Math.abs(plan.dragged[0].position.y - 2)), 1);
  const moved = applyGrappledStep(e, source.id, { x: 0, y: 2 }, 5);
  assert.deepEqual(moved.encounter.combatants[1].position, plan.dragged[0].position);
});

test('dragging and Difficult Terrain costs are additive rather than multiplicative', () => {
  let e = grapple().encounter;
  e = { ...e, turn: { ...e.turn, movementRemaining: 30 }, map: { ...e.map, terrain: [{ x: 0, y: 2, kind: 'difficult', label: 'rubble' }] } };
  const destination = legalMovementDestinations(e).find(cell => cell.x === 0 && cell.y === 2);
  assert.equal(destination.cost, 15);
  const moved = moveActiveCombatant(e, 0, 2, () => 0.01);
  assert.equal(moved.encounter.turn.movementRemaining, 15);
});

test('a blocked dragged step is excluded atomically', () => {
  let e = state(); e.combatants[0].position = { x: 1, y: 1 }; e.combatants[1].position = { x: 2, y: 2 };
  e = grapple(e).encounter;
  e = { ...e, turn: { ...e.turn, movementRemaining: 30 }, map: { ...e.map, terrain: [{ x: 1, y: 2, kind: 'wall', label: 'wall' }, { x: 2, y: 1, kind: 'wall', label: 'wall' }] } };
  assert.equal(planGrappledStep(e, source.id, { x: 0, y: 0 }, 5), null);
  assert.equal(legalMovementDestinations(e).some(cell => cell.x === 0 && cell.y === 0), false);
  assert.deepEqual(e.combatants[0].position, { x: 1, y: 1 }); assert.deepEqual(e.combatants[1].position, { x: 2, y: 2 });
});
