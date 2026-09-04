import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_CHARACTERS, cleiraOestwilde } from "../src/characters/built-ins.ts";
import { irvenWeber, pharos, surinaDaardendrian } from "../src/characters/verified-pdf-characters.ts";
import { applyDamageToCombatant, executeSpellChoice, resolveAttackDamage, resolveAttackRoll } from "../src/engine/combat-options.ts";
import { effectiveSpeed } from "../src/engine/effects.ts";
import { createEncounter, endTurn } from "../src/engine/encounter.ts";
import { resolveWeaponMasteryChoice } from "../src/engine/responses.ts";
import { buildCharacterMechanicCoverage } from "../src/rules-registry/index.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function readyEncounter(character) {
  const state = createEncounter(character, generateScriptedScenario({
    prompt: "A clear training yard",
    environment: "market",
    objective: "defeat",
    difficulty: "easy",
  }));
  const enemy = state.combatants.find((combatant) => combatant.side === "enemy");
  return {
    ...state,
    activeIndex: 0,
    selectedTargetId: enemy.id,
    combatants: state.combatants.map((combatant) => ({
      ...combatant,
      initiative: combatant.side === "player" ? 20 : 10,
      initiativeRolled: true,
      position: combatant.side === "player" ? { x: 1, y: 1 } : { x: 2, y: 1 },
    })),
  };
}

function sequence(values) {
  return () => values.shift();
}

test("Gold Dragonborn Fire Resistance halves fire damage and rounds down", () => {
  const state = readyEncounter(surinaDaardendrian);
  const player = state.combatants.find((combatant) => combatant.id === surinaDaardendrian.id);
  assert.deepEqual(player.damageResistances, ["fire"]);

  const fire = applyDamageToCombatant(state, player.id, 9, { damageType: "fire" });
  assert.equal(fire.combatants.find((combatant) => combatant.id === player.id).hitPoints.current, 7);
  assert.match(fire.log[0], /reduces 9 fire damage to 4/i);

  const cold = applyDamageToCombatant(state, player.id, 9, { damageType: "cold" });
  assert.equal(cold.combatants.find((combatant) => combatant.id === player.id).hitPoints.current, 2);
});

test("Vicious Mockery applies disadvantage after a failed save and consumes it on the next attack", () => {
  const state = readyEncounter(cleiraOestwilde);
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "vicious-mockery");
  const enemyId = state.selectedTargetId;
  const cast = executeSpellChoice(state, spell, sequence([0, 0.99]));
  assert.equal(cast.legal, true);
  assert.equal(cast.roll.total, 1);
  assert.equal(cast.encounter.effects.find((effect) => effect.name === "Vicious Mockery").targetCombatantId, enemyId);
  assert.deepEqual(cast.encounter.effects.find((effect) => effect.name === "Vicious Mockery").expiresAt, { round: 1, combatantId: enemyId, phase: "end" });

  const enemyIndex = cast.encounter.combatants.findIndex((combatant) => combatant.id === enemyId);
  const enemyAttack = { id: "test-club", name: "Test Club", kind: "melee", attackBonus: 20, damage: "1 bludgeoning", normalRangeFeet: 5 };
  const attackState = {
    ...cast.encounter,
    activeIndex: enemyIndex,
    selectedTargetId: cleiraOestwilde.id,
    turn: { ...cast.encounter.turn, action: true },
  };
  const attack = resolveAttackRoll(attackState, enemyAttack, sequence([0.99, 0]));
  assert.equal(attack.legal, true);
  assert.deepEqual(attack.roll.rolls, [20, 1]);
  assert.equal(attack.roll.kept, 1);
  assert.equal(attack.encounter.effects.some((effect) => effect.name === "Vicious Mockery"), false);
});

test("Vicious Mockery creates no rider on a successful save and otherwise expires at the target turn's end", () => {
  const spell = cleiraOestwilde.spells.find((candidate) => candidate.id === "vicious-mockery");
  const saved = executeSpellChoice(readyEncounter(cleiraOestwilde), spell, () => 0.99);
  assert.equal(saved.legal, true);
  assert.equal(saved.encounter.effects.some((effect) => effect.name === "Vicious Mockery"), false);

  const failed = executeSpellChoice(readyEncounter(cleiraOestwilde), spell, sequence([0, 0]));
  const enemyTurn = endTurn(failed.encounter);
  assert.equal(enemyTurn.effects.some((effect) => effect.name === "Vicious Mockery"), true);
  const afterEnemyTurn = endTurn(enemyTurn);
  assert.equal(afterEnemyTurn.effects.some((effect) => effect.name === "Vicious Mockery"), false);
});

test("Sap imposes and consumes disadvantage on the target's next attack roll", () => {
  const state = readyEncounter(irvenWeber);
  const longsword = irvenWeber.attacks.find((candidate) => candidate.id === "longsword");
  const hit = resolveAttackRoll(state, longsword, () => 0.5);
  assert.equal(hit.legal, true);
  assert.equal(hit.hit, true);
  assert.equal(hit.encounter.effects.some((effect) => effect.name === "Sap"), true);

  const enemyId = state.selectedTargetId;
  const enemyIndex = hit.encounter.combatants.findIndex((combatant) => combatant.id === enemyId);
  const enemyAttack = { id: "test-club", name: "Test Club", kind: "melee", attackBonus: 20, damage: "1 bludgeoning", normalRangeFeet: 5 };
  const answer = resolveAttackRoll({
    ...hit.encounter,
    activeIndex: enemyIndex,
    selectedTargetId: irvenWeber.id,
    turn: { ...hit.encounter.turn, action: true },
  }, enemyAttack, sequence([0.99, 0]));
  assert.deepEqual(answer.roll.rolls, [20, 1]);
  assert.equal(answer.encounter.effects.some((effect) => effect.name === "Sap"), false);
});

test("Sap is not applied on a miss and expires at the start of the attacker's next turn", () => {
  const state = readyEncounter(irvenWeber);
  const longsword = irvenWeber.attacks.find((candidate) => candidate.id === "longsword");
  const miss = resolveAttackRoll(state, longsword, () => 0);
  assert.equal(miss.hit, false);
  assert.equal(miss.encounter.effects.some((effect) => effect.name === "Sap"), false);

  const hit = resolveAttackRoll(state, longsword, () => 0.5);
  const enemyTurn = endTurn(hit.encounter);
  assert.equal(enemyTurn.effects.some((effect) => effect.name === "Sap"), true);
  const nextPlayerTurn = endTurn(enemyTurn);
  assert.equal(nextPlayerTurn.effects.some((effect) => effect.name === "Sap"), false);
});

test("Slow offers a choice after damage, reduces Speed by 10 feet, and does not stack", () => {
  const state = readyEncounter(irvenWeber);
  const javelin = irvenWeber.attacks.find((candidate) => candidate.id === "javelin");
  const enemyId = state.selectedTargetId;
  const damage = resolveAttackDamage(state, javelin, enemyId, false, () => 0);
  assert.equal(damage.legal, true);
  assert.equal(damage.encounter.pendingResponse.type, "weapon-mastery-choice");
  assert.equal(effectiveSpeed(damage.encounter, enemyId), 30);

  const slowed = resolveWeaponMasteryChoice(damage.encounter, true);
  assert.equal(effectiveSpeed(slowed.encounter, enemyId), 20);
  assert.equal(slowed.encounter.effects.filter((effect) => effect.name === "Slow").length, 1);

  const secondDamage = resolveAttackDamage(slowed.encounter, javelin, enemyId, false, () => 0);
  assert.equal(secondDamage.encounter.pendingResponse.type, "weapon-mastery-choice");
  const reapplied = resolveWeaponMasteryChoice(secondDamage.encounter, true);
  assert.equal(effectiveSpeed(reapplied.encounter, enemyId), 20);
  assert.equal(reapplied.encounter.effects.filter((effect) => effect.name === "Slow").length, 1);
});

test("Slow can be declined and expires at the start of the attacker's next turn", () => {
  const state = readyEncounter(irvenWeber);
  const javelin = irvenWeber.attacks.find((candidate) => candidate.id === "javelin");
  const enemyId = state.selectedTargetId;
  const damage = resolveAttackDamage(state, javelin, enemyId, false, () => 0);
  const declined = resolveWeaponMasteryChoice(damage.encounter, false);
  assert.equal(effectiveSpeed(declined.encounter, enemyId), 30);

  const damageAgain = resolveAttackDamage(state, javelin, enemyId, false, () => 0);
  const slowed = resolveWeaponMasteryChoice(damageAgain.encounter, true);
  const enemyTurn = endTurn(slowed.encounter);
  assert.equal(effectiveSpeed(enemyTurn, enemyId), 20);
  const nextPlayerTurn = endTurn(enemyTurn);
  assert.equal(nextPlayerTurn.effects.some((effect) => effect.name === "Slow"), false);
  assert.equal(effectiveSpeed(nextPlayerTurn, enemyId), 30);
});

test("Dark One's Blessing grants 4 temporary HP on a hostile defeat and keeps a higher value", () => {
  const state = readyEncounter(pharos);
  const enemyId = state.selectedTargetId;
  const nearlyDefeated = {
    ...state,
    combatants: state.combatants.map((combatant) => combatant.id === enemyId
      ? { ...combatant, hitPoints: { ...combatant.hitPoints, current: 1 } }
      : combatant),
  };
  const defeated = applyDamageToCombatant(nearlyDefeated, enemyId, 1, { damageType: "force", sourceCombatantId: pharos.id });
  assert.equal(defeated.combatants.find((combatant) => combatant.id === pharos.id).temporaryHitPoints, 4);
  assert.match(defeated.log.join(" "), /Dark One's Blessing grants 4 temporary hit points/i);

  const fortified = {
    ...nearlyDefeated,
    combatants: nearlyDefeated.combatants.map((combatant) => combatant.id === pharos.id
      ? { ...combatant, temporaryHitPoints: 5 }
      : combatant),
  };
  const kept = applyDamageToCombatant(fortified, enemyId, 1, { damageType: "force", sourceCombatantId: pharos.id });
  assert.equal(kept.combatants.find((combatant) => combatant.id === pharos.id).temporaryHitPoints, 5);
});

test("Dark One's Blessing does not trigger unless the hostile target reaches 0 HP", () => {
  const state = readyEncounter(pharos);
  const enemyId = state.selectedTargetId;
  const damaged = applyDamageToCombatant(state, enemyId, 1, { damageType: "force", sourceCombatantId: pharos.id });
  assert.equal(damaged.combatants.find((combatant) => combatant.id === pharos.id).temporaryHitPoints, 0);
});

test("the previous five mechanics remain executable and officially sourced", () => {
  const reports = BUILT_IN_CHARACTERS.map((character) => buildCharacterMechanicCoverage(character));
  assert.equal(reports.reduce((total, report) => total + report.total, 0), 99);
  assert.equal(reports.reduce((total, report) => total + report.executable, 0), 75);

  const expected = [
    ["cleira-oestwilde", "vicious-mockery", "srd-5.1"],
    ["surina-daardendrian", "fire-resistance", "srd-5.1"],
    ["irven-weber", "javelin-mastery-slow", "srd-5.2.1"],
    ["irven-weber", "longsword-mastery-sap", "srd-5.2.1"],
    ["pharos", "dark-ones-blessing", "srd-5.1"],
  ];
  for (const [characterId, entityId, sourceId] of expected) {
    const entry = reports.find((report) => report.characterId === characterId).entries.find((candidate) => candidate.entityId === entityId);
    assert.equal(entry.status, "supported", entityId);
    assert.equal(entry.executable, true, entityId);
    assert.equal(entry.sourceId, sourceId, entityId);
    assert.deepEqual(entry.missingCapabilities, [], entityId);
  }
});
