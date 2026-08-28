import type { CharacterAttack } from "../domain/character";
import type { Combatant, EncounterState, EnemySaveAbility, ExperienceMode } from "../domain/combat";
import { parseDamageFormula, type D20Result, type DamageRoll } from "./dice";
import { resolveAttackDamage, resolveAttackRoll, validateAttackTarget } from "./combat-options";
import { gridDistanceFeet } from "./targeting";
import { analyzeTarget } from "./targeting";
import { queueConcentrationCheck } from "./defensive-responses";
import { effectiveArmorClass } from "./effects";
import { validateSpellSlot } from "./resources";
import { applyMovementContinuation } from "./movement";

export type EnemyTurnStep = {
  kind: "move" | "ability" | "attack" | "damage" | "miss" | "reaction" | "wait";
  summary: string;
};

export type EnemyTurnResolution = {
  encounter: EncounterState;
  steps: EnemyTurnStep[];
  attackRoll: D20Result | null;
  damageRoll: DamageRoll | null;
};

export type CombatOutcome = "active" | "victory" | "stabilized" | "defeat";

export function combatOutcome(encounter: EncounterState): CombatOutcome {
  const enemyAlive = encounter.combatants.some((combatant) => combatant.side === "enemy" && combatant.hitPoints.current > 0);
  if (!enemyAlive) return "victory";
  const playerCanContinue = encounter.combatants.some((combatant) => combatant.side === "player" && (
    combatant.hitPoints.current > 0 || (!combatant.stabilized && combatant.deathSaves.failures < 3)
  ));
  const playerStabilized = encounter.combatants.some((combatant) => combatant.side === "player" && combatant.stabilized);
  if (playerStabilized && !encounter.combatants.some((combatant) => combatant.side === "player" && combatant.hitPoints.current > 0)) return "stabilized";
  if (!playerCanContinue) return "defeat";
  return "active";
}

export function enemyHealthLabel(combatant: Combatant, mode: ExperienceMode): string {
  if (combatant.hitPoints.current <= 0) return "Defeated";
  if (mode === "beginner") return `${combatant.hitPoints.current}/${combatant.hitPoints.maximum} HP`;
  if (mode === "advanced") return "Health concealed";
  const ratio = combatant.hitPoints.current / combatant.hitPoints.maximum;
  if (ratio <= 0.25) return "Critical";
  if (ratio <= 0.5) return "Bloodied";
  if (ratio < 1) return "Injured";
  return "Healthy";
}

type ReachableCell = { x: number; y: number; cost: number };

const cellKey = (x: number, y: number) => `${x},${y}`;

function reachableCells(encounter: EncounterState): ReachableCell[] {
  const active = encounter.combatants[encounter.activeIndex];
  const best = new Map<string, number>([[cellKey(active.position.x, active.position.y), 0]]);
  const queue: ReachableCell[] = [{ ...active.position, cost: 0 }];
  const result: ReachableCell[] = [];
  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift()!;
    if (current.cost !== best.get(cellKey(current.x, current.y))) continue;
    result.push(current);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= encounter.map.width || y >= encounter.map.height) continue;
      const terrain = encounter.map.terrain.find((cell) => cell.x === x && cell.y === y);
      if (terrain?.kind === "wall") continue;
      const occupied = encounter.combatants.some((combatant) => combatant.id !== active.id && combatant.hitPoints.current > 0 && combatant.position.x === x && combatant.position.y === y);
      if (occupied) continue;
      const nextCost = current.cost + (terrain?.kind === "difficult" ? 10 : 5);
      if (nextCost > encounter.turn.movementRemaining) continue;
      const key = cellKey(x, y);
      if (nextCost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(key, nextCost);
      queue.push({ x, y, cost: nextCost });
    }
  }
  return result;
}

function withActivePosition(encounter: EncounterState, cell: ReachableCell): EncounterState {
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant, index) => index === encounter.activeIndex ? { ...combatant, position: { x: cell.x, y: cell.y } } : combatant),
  };
}

function averageDamage(attack: CharacterAttack): number {
  const formula = parseDamageFormula(attack.damage);
  return formula ? formula.diceCount * (formula.dieSize + 1) / 2 + formula.modifier : 0;
}

function legalAttack(encounter: EncounterState, targetId: string, attacks: CharacterAttack[], mode: ExperienceMode = "training"): CharacterAttack | null {
  const legal = attacks.filter((attack) => validateAttackTarget(encounter, attack, targetId).legal);
  if (mode !== "advanced") return legal[0] ?? null;
  return legal.sort((left, right) => {
    const leftMode = validateAttackTarget(encounter, left, targetId).rollMode;
    const rightMode = validateAttackTarget(encounter, right, targetId).rollMode;
    if ((leftMode === "disadvantage") !== (rightMode === "disadvantage")) return leftMode === "disadvantage" ? 1 : -1;
    return averageDamage(right) - averageDamage(left) || right.attackBonus - left.attackBonus;
  })[0] ?? null;
}

function legalSaveAbility(encounter: EncounterState, targetId: string, abilities: EnemySaveAbility[], usedAbilityIds: string[]): EnemySaveAbility | null {
  const analysis = analyzeTarget(encounter, targetId);
  if (!analysis || analysis.target.hitPoints.current <= 0) return null;
  return abilities.find((ability) => !usedAbilityIds.includes(ability.id)
    && analysis.distanceFeet <= ability.rangeFeet
    && (!ability.requiresLineOfSight || analysis.lineOfSight)) ?? null;
}

function chooseEnemyDestination(encounter: EncounterState, target: Combatant, attacks: CharacterAttack[], mode: ExperienceMode): ReachableCell {
  const active = encounter.combatants[encounter.activeIndex];
  const options = reachableCells(encounter).map((cell) => {
    const state = withActivePosition(encounter, cell);
    const moved = state.combatants[state.activeIndex];
    const legal = legalAttack(state, target.id, attacks, mode);
    const terrain = state.map.terrain.find((item) => item.x === cell.x && item.y === cell.y);
    return { cell, canAttack: Boolean(legal), hasRangedAttack: legal?.kind === "ranged", distance: gridDistanceFeet(moved, target), hasCover: terrain?.kind === "cover" };
  });
  const shouldRetreat = mode !== "beginner" && (active.tacticId === "ranged-skirmisher" || active.tacticId === "mobile-harrier")
    && gridDistanceFeet(active, target) <= 5
    && attacks.some((attack) => attack.kind === "ranged");
  if (shouldRetreat) {
    const retreat = options.filter((option) => option.distance > 5 && option.hasRangedAttack)
      .sort((left, right) => left.cell.cost - right.cell.cost || right.distance - left.distance)[0];
    if (retreat) return retreat.cell;
  }
  if (mode === "advanced") {
    const tactical = options.filter((option) => option.canAttack).sort((left, right) =>
      Number(right.hasCover) - Number(left.hasCover)
      || Number(right.hasRangedAttack) - Number(left.hasRangedAttack)
      || right.distance - left.distance
      || left.cell.cost - right.cell.cost)[0];
    if (tactical) return tactical.cell;
  }
  if (legalAttack(encounter, target.id, attacks, mode)) return { ...active.position, cost: 0 };
  options.sort((left, right) => {
    if (left.canAttack !== right.canAttack) return left.canAttack ? -1 : 1;
    if (left.canAttack && right.canAttack) return left.cell.cost - right.cell.cost || left.distance - right.distance;
    return left.distance - right.distance || right.cell.cost - left.cell.cost;
  });
  const chosen = options[0];
  return chosen?.cell ?? { ...active.position, cost: 0 };
}

export function resolveEnemyTurn(encounter: EncounterState, modeOrRandom: ExperienceMode | (() => number) = "training", random = Math.random): EnemyTurnResolution {
  const mode: ExperienceMode = typeof modeOrRandom === "function" ? "training" : modeOrRandom;
  const rollRandom = typeof modeOrRandom === "function" ? modeOrRandom : random;
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "enemy") return { encounter, steps: [], attackRoll: null, damageRoll: null };
  if (active.hitPoints.current <= 0) return { encounter, steps: [{ kind: "wait", summary: `${active.name} is defeated and cannot act.` }], attackRoll: null, damageRoll: null };
  const target = encounter.combatants.filter((combatant) => combatant.side === "player" && combatant.hitPoints.current > 0).sort((left, right) => {
    if (mode === "advanced") {
      const healthPriority = left.hitPoints.current / left.hitPoints.maximum - right.hitPoints.current / right.hitPoints.maximum;
      if (healthPriority) return healthPriority;
      const armorPriority = effectiveArmorClass(encounter, left.id) - effectiveArmorClass(encounter, right.id);
      if (armorPriority) return armorPriority;
    }
    return gridDistanceFeet(active, left) - gridDistanceFeet(active, right);
  })[0];
  if (!target) return { encounter, steps: [{ kind: "wait", summary: `${active.name} has no conscious target.` }], attackRoll: null, damageRoll: null };

  const attacks = active.attacks ?? [];
  const steps: EnemyTurnStep[] = [];
  const destination = chooseEnemyDestination(encounter, target, attacks, mode);
  let next: EncounterState = { ...encounter, selectedTargetId: target.id };
  if (destination.cost > 0) {
    const availableOpportunityAttacks = target.reactionAvailable ? target.attacks.filter((attack) => attack.kind === "melee"
      && gridDistanceFeet(active, target) <= attack.normalRangeFeet
      && Math.max(Math.abs(destination.x - target.position.x), Math.abs(destination.y - target.position.y)) * 5 > attack.normalRangeFeet) : [];
    if (availableOpportunityAttacks.length && !next.turn.disengaged) {
      const summary = `${active.name} starts to leave ${target.name}'s reach. ${target.name} can spend their reaction on an opportunity attack before the movement completes.`;
      next = {
        ...next,
        pendingResponse: {
          type: "opportunity-attack",
          sourceCombatantId: target.id,
          targetCombatantId: active.id,
          phase: "choice",
          availableAttackIds: availableOpportunityAttacks.map((attack) => attack.id),
          continuation: { combatantId: active.id, x: destination.x, y: destination.y, cost: destination.cost },
        },
        log: [summary, ...next.log],
      };
      return { encounter: next, steps: [{ kind: "reaction", summary }], attackRoll: null, damageRoll: null };
    }
    next = applyMovementContinuation(next, { combatantId: active.id, x: destination.x, y: destination.y, cost: destination.cost });
    steps.push({ kind: "move", summary: `${active.name} moves ${destination.cost} feet toward a better tactical position.` });
  }
  const movedActive = next.combatants[next.activeIndex];
  const availableWeaponAttack = legalAttack(next, target.id, attacks, mode);
  const saveAbility = mode === "beginner" && availableWeaponAttack
    ? null
    : legalSaveAbility(next, target.id, movedActive.abilities, movedActive.usedAbilityIds);
  if (saveAbility) {
    const summary = `${movedActive.name} uses ${saveAbility.name}. ${target.name} must make a ${saveAbility.saveAbility} saving throw against DC ${saveAbility.saveDc}.`;
    next = {
      ...next,
      turn: { ...next.turn, action: false },
      pendingResponse: { type: "saving-throw", sourceCombatantId: movedActive.id, targetCombatantId: target.id, ability: saveAbility },
      combatants: next.combatants.map((combatant) => combatant.id === movedActive.id ? { ...combatant, usedAbilityIds: [...combatant.usedAbilityIds, saveAbility.id] } : combatant),
      log: [summary, ...next.log],
    };
    return { encounter: next, steps: [...steps, { kind: "ability", summary }], attackRoll: null, damageRoll: null };
  }
  const attack = legalAttack(next, target.id, attacks, mode);
  if (!attack) {
    const summary = `${active.name} cannot reach a legal attack and ends its turn.`;
    return { encounter: { ...next, log: [summary, ...next.log] }, steps: [...steps, { kind: "wait", summary }], attackRoll: null, damageRoll: null };
  }

  const attackResult = resolveAttackRoll(next, attack, rollRandom);
  if (!attackResult.legal) return { encounter: next, steps: [...steps, { kind: "wait", summary: attackResult.reason }], attackRoll: null, damageRoll: null };
  next = attackResult.encounter;
  steps.push({ kind: attackResult.hit ? "attack" : "miss", summary: `${movedActive.name} targets ${target.name}. ${attackResult.summary}` });
  if (!attackResult.hit) return { encounter: next, steps, attackRoll: attackResult.roll, damageRoll: null };

  const updatedTargetBeforeDamage = next.combatants.find((combatant) => combatant.id === target.id)!;
  const availableReactionIds = updatedTargetBeforeDamage.reactionOptions.filter((option) => updatedTargetBeforeDamage.reactionAvailable
    && (!option.spellLevel || validateSpellSlot(next, target.id, option.spellLevel).legal)).map((option) => option.id);
  if (availableReactionIds.length) {
    const summary = `${target.name} has a reaction opportunity before damage is rolled.`;
    next = {
      ...next,
      pendingResponse: {
        type: "attack-reaction",
        sourceCombatantId: movedActive.id,
        targetCombatantId: target.id,
        attack,
        attackTotal: attackResult.roll.total,
        attackNatural: attackResult.roll.natural,
        critical: attackResult.critical,
        targetArmorClass: attackResult.targetArmorClass,
        availableReactionIds,
      },
      log: [summary, ...next.log],
    };
    return { encounter: next, steps: [...steps, { kind: "reaction", summary }], attackRoll: attackResult.roll, damageRoll: null };
  }

  const damageResult = resolveAttackDamage(next, attack, target.id, attackResult.critical, rollRandom);
  if (!damageResult.legal) return { encounter: next, steps: [...steps, { kind: "wait", summary: damageResult.reason }], attackRoll: attackResult.roll, damageRoll: null };
  next = queueConcentrationCheck(damageResult.encounter, target.id, damageResult.damageApplied);
  const updatedTarget = next.combatants.find((combatant) => combatant.id === target.id)!;
  steps.push({ kind: "damage", summary: `${damageResult.summary} ${updatedTarget.name} has ${updatedTarget.hitPoints.current}/${updatedTarget.hitPoints.maximum} HP remaining.` });
  return { encounter: next, steps, attackRoll: attackResult.roll, damageRoll: damageResult.roll };
}
