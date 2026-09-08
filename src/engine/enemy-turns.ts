import { queueReadiedAttack, endHiding } from "./interactions";
import { resolveAbilityCheck } from "./ability-checks";
import type { CharacterAttack } from "../domain/character";
import type { Combatant, EncounterState, EnemySaveAbility, ExperienceMode } from "../domain/combat";
import { parseDamageFormula, type D20Result, type DamageRoll } from "./dice";
import { resolveAttackDamage, resolveAttackRoll, validateAttackTarget } from "./combat-options";
import { gridDistanceFeet } from "./targeting";
import { analyzeTarget } from "./targeting";
import { queueConcentrationCheck } from "./defensive-responses";
import { canHarmTarget, canSeeCombatant, effectiveArmorClass, effectiveSpeed, isIncapacitated, occupiedCells, revealHiddenInPlainSight } from "./effects";
import { validateSpellSlot } from "./resources";
import { applyMovementContinuation, resolveMovementHazards } from "./movement";
import { validateWeaponHands } from "./weapon-hands";
import { crossesSolidCorner, gridStepCost } from "./grid-movement";
import { resumePointHazards } from "./point-effects";
import { applyGrappledStep, planGrappledStep, resolveEnemyGrappleEscape } from "./grappling";

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

type ReachableCell = { x: number; y: number; cost: number; path?: { x: number; y: number; cost: number }[]; state?: EncounterState };

const cellKey = (x: number, y: number) => `${x},${y}`;

function reachableCells(encounter: EncounterState): ReachableCell[] {
  const active = encounter.combatants[encounter.activeIndex];
  if (effectiveSpeed(encounter, active.id) === 0) return [{ ...active.position, cost: 0 }];
  const best = new Map<string, number>([[cellKey(active.position.x, active.position.y), 0]]);
  const queue: ReachableCell[] = [{ ...active.position, cost: 0, path: [], state: encounter }];
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
      const state = current.state ?? encounter;
      const terrain = state.map.terrain.find((cell) => cell.x === x && cell.y === y);
      if (terrain?.kind === "wall") continue;
      if (crossesSolidCorner(state, active.id, current, { x, y })) continue;
      const baseCost = gridStepCost(state, active.id, { x, y });
      const plan = planGrappledStep(state, active.id, { x, y }, baseCost);
      if (!plan) continue;
      if (!plan.dragged.length) {
        const destination = { ...state, combatants: state.combatants.map(c => c.id === active.id ? { ...c, position: { x, y } } : c) };
        const occupied = occupiedCells(destination, active.id).some(cell => destination.combatants.some(combatant => combatant.id !== active.id && combatant.hitPoints.current > 0 && occupiedCells(destination, combatant.id).some(other => other.x === cell.x && other.y === cell.y)));
        if (occupied) continue;
      }
      const nextCost = current.cost + plan.cost;
      if (nextCost > encounter.turn.movementRemaining) continue;
      const key = cellKey(x, y);
      if (nextCost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(key, nextCost);
      const advanced = applyGrappledStep(state, active.id, { x, y }, baseCost)?.encounter;
      if (!advanced) continue;
      queue.push({ x, y, cost: nextCost, path: [...(current.path ?? []), { x, y, cost: plan.cost }], state: advanced });
    }
  }
  return result;
}

function withActivePosition(encounter: EncounterState, cell: ReachableCell): EncounterState {
  if (cell.state) return cell.state;
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
  const active = encounter.combatants[encounter.activeIndex];
  if (!analysis || analysis.target.hitPoints.current <= 0 || !active || !canHarmTarget(encounter, active.id, targetId)) return null;
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
  if (encounter.pendingResponse) return { encounter, steps: [], attackRoll: null, damageRoll: null };
  encounter = resumePointHazards(encounter, rollRandom);
  if (encounter.pendingResponse) return { encounter, steps: [{ kind: "reaction", summary: "Resolve the next hazard response." }], attackRoll: null, damageRoll: null };
  if (encounter.completedEnemyMovementId === active.id && !encounter.pendingEnemyPath) {
    encounter = queueReadiedAttack({ ...encounter, completedEnemyMovementId: undefined }, active.id);
    if (encounter.pendingResponse) return { encounter, steps: [{ kind: "reaction", summary: "The interrupted movement finished; a readied attack is available." }], attackRoll: null, damageRoll: null };
  }

  if (active.hitPoints.current <= 0) return { encounter, steps: [{ kind: "wait", summary: `${active.name} is defeated and cannot act.` }], attackRoll: null, damageRoll: null };
  if (isIncapacitated(encounter, active.id)) return { encounter, steps: [{ kind: "wait", summary: `${active.name} is incapacitated and cannot attack or use an ability.` }], attackRoll: null, damageRoll: null };
  const escape = resolveEnemyGrappleEscape(encounter, rollRandom);
  if (escape?.legal) return { encounter: escape.encounter, steps: [{ kind: "ability", summary: escape.summary }], attackRoll: escape.roll, damageRoll: null };
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

  encounter = revealHiddenInPlainSight(encounter);
  const hidden = encounter.effects.find(effect => effect.targetCombatantId === target.id && effect.hidden);
  if (hidden && encounter.turn.action) {
    const check = resolveAbilityCheck({ ...encounter, turn: { ...encounter.turn, action: false } }, active.id, "perception", { dc: hidden.hidden!.dc, random: rollRandom })!;
    const searched = check.succeeded ? endHiding(check.encounter, target.id, "enemy Search found the hidden creature") : check.encounter;
    const summary = `${active.name} uses Search. ${check.summary} ${check.succeeded ? "The hidden creature is found." : "The creature remains hidden."}`;
    return { encounter: { ...searched, log: [summary, ...searched.log] }, steps: [{ kind: "wait", summary }], attackRoll: check.roll, damageRoll: null };
  }
  const attacks = active.attacks ?? [];
  const steps: EnemyTurnStep[] = [];
  const destination = encounter.pendingEnemyPath ? { ...active.position, cost: 0, path: encounter.pendingEnemyPath } : chooseEnemyDestination(encounter, target, attacks, mode);
  let next: EncounterState = { ...encounter, selectedTargetId: target.id };
  const path = destination.path ?? [];
  const wasMoving = Boolean(encounter.pendingEnemyPath) || path.length > 0;
  for (let index = 0; index < path.length; index++) {
    const step = path[index];
    const mover = next.combatants.find(c => c.id === active.id)!;
    if (mover.hitPoints.current <= 0 || effectiveSpeed(next, mover.id) === 0) break;
    const observer = next.combatants.find(c => c.id === target.id)!;
    const preview = applyGrappledStep(next, mover.id, { x: step.x, y: step.y }, gridStepCost(next, mover.id, step))?.encounter;
    if (!preview) break;
    const previewMover = preview.combatants.find(c => c.id === mover.id)!;
    const previewObserver = preview.combatants.find(c => c.id === observer.id)!;
    const availableOpportunityAttacks = observer.reactionAvailable && !isIncapacitated(next, observer.id) && canSeeCombatant(next, observer.id, mover.id) ? observer.attacks.filter((attack) => attack.kind === "melee"
      && validateWeaponHands(next, observer.id, attack, false).legal
      && gridDistanceFeet(mover, observer) <= attack.normalRangeFeet
      && gridDistanceFeet(previewMover, previewObserver) > attack.normalRangeFeet) : [];
    next = { ...next, pendingEnemyPath: path.slice(index + 1), completedEnemyMovementId: undefined };
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
          continuation: { combatantId: active.id, ...step },
        },
        log: [summary, ...next.log],
      };
      return { encounter: next, steps: [{ kind: "reaction", summary }], attackRoll: null, damageRoll: null };
    }
    const beforeMovement = next;
    const moved = applyMovementContinuation(next, { combatantId: active.id, ...step });
    if (moved === next) break;
    next = resolveMovementHazards(next, moved, active.id, rollRandom);
    steps.push({ kind: "move", summary: `${active.name} moves ${step.cost} feet to ${String.fromCharCode(65 + step.x)}${step.y + 1}.` });
    if (next.pendingResponse) return { encounter: next, steps: [...steps, { kind: "reaction", summary: "Movement pauses for hazard resolution." }], attackRoll: null, damageRoll: null };
    next = queueReadiedAttack(next, active.id, "becomes-attackable", beforeMovement);
    if (next.pendingResponse) return { encounter: next, steps: [...steps, { kind: "reaction", summary: "The enemy became a legal target for a readied weapon attack." }], attackRoll: null, damageRoll: null };
  }
  next = { ...next, pendingEnemyPath: undefined, completedEnemyMovementId: undefined };
  if (next.combatants.find(c => c.id === active.id)!.hitPoints.current <= 0) return { encounter: next, steps: [...steps, { kind: "wait", summary: `${active.name} falls before reaching the destination.` }], attackRoll: null, damageRoll: null };
  if (wasMoving) {
    next = queueReadiedAttack(next, active.id);
    if (next.pendingResponse) return { encounter: next, steps: [...steps, { kind: "reaction", summary: "Movement finished. A readied attack can now be released." }], attackRoll: null, damageRoll: null };
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
  steps.push({ kind: "damage", summary: next.pendingResponse?.type === "damage-reduction-reaction"
    ? `${damageResult.summary} ${updatedTarget.name} can react before the damage is applied.`
    : `${damageResult.summary} ${updatedTarget.name} has ${updatedTarget.hitPoints.current}/${updatedTarget.hitPoints.maximum} HP remaining.` });
  return { encounter: next, steps, attackRoll: attackResult.roll, damageRoll: damageResult.roll };
}
