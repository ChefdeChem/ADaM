import type { EncounterState, MovementContinuation } from "../domain/combat";
import type { D20Result, DamageRoll } from "./dice";
import { resolveAttackDamage, resolveReactionAttackRoll } from "./combat-options";
import { queueConcentrationCheck } from "./defensive-responses";
import { validateSpellSlot } from "./resources";
import { resolvePointHazardsForCombatant } from "./point-effects";
import { canOccupyCells, occupiedCells } from "./effects";

export type MovementStep = { x: number; y: number; cost: number };
export type ReachableMovementCell = { x: number; y: number; cost: number; path: MovementStep[] };
export type MovementResult = {
  legal: boolean;
  reason: string;
  encounter: EncounterState;
  attackRoll: D20Result | null;
  damageRoll: DamageRoll | null;
};

const cellKey = (x: number, y: number) => `${x},${y}`;
const distanceFromCell = (x: number, y: number, other: { position: { x: number; y: number } }) => Math.max(
  Math.abs(x - other.position.x),
  Math.abs(y - other.position.y),
) * 5;

export function legalMovementDestinations(encounter: EncounterState): ReachableMovementCell[] {
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "player" || active.hitPoints.current <= 0 || encounter.pendingResponse || encounter.turn.movementRemaining < 5) return [];
  const originKey = cellKey(active.position.x, active.position.y);
  const best = new Map<string, number>([[originKey, 0]]);
  const previous = new Map<string, string>();
  const nodes = new Map<string, MovementStep>([[originKey, { ...active.position, cost: 0 }]]);
  const queue: Array<{ x: number; y: number; cost: number }> = [{ ...active.position, cost: 0 }];

  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift()!;
    if (current.cost !== best.get(cellKey(current.x, current.y))) continue;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= encounter.map.width || y >= encounter.map.height) continue;
      if (!canOccupyCells(encounter, active.id, { x, y })) continue;
      const difficult = occupiedCells(encounter, active.id, { x, y }).some((point) => encounter.map.terrain.some((cell) => cell.x === point.x && cell.y === point.y && cell.kind === "difficult"));
      const stepCost = difficult ? 10 : 5;
      const nextCost = current.cost + stepCost;
      if (nextCost > encounter.turn.movementRemaining) continue;
      const key = cellKey(x, y);
      if (nextCost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(key, nextCost);
      previous.set(key, cellKey(current.x, current.y));
      nodes.set(key, { x, y, cost: stepCost });
      queue.push({ x, y, cost: nextCost });
    }
  }

  return [...best.entries()].filter(([key]) => key !== originKey).map(([key, cost]) => {
    const path: MovementStep[] = [];
    let cursor = key;
    while (cursor !== originKey) {
      path.unshift(nodes.get(cursor)!);
      cursor = previous.get(cursor)!;
    }
    const destination = nodes.get(key)!;
    return { x: destination.x, y: destination.y, cost, path };
  });
}

export function applyMovementContinuation(encounter: EncounterState, continuation: MovementContinuation, logMovement = true): EncounterState {
  const mover = encounter.combatants.find((combatant) => combatant.id === continuation.combatantId);
  if (!mover || mover.hitPoints.current <= 0) return encounter;
  const coordinate = `${String.fromCharCode(65 + continuation.x)}${continuation.y + 1}`;
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === mover.id
      ? { ...combatant, position: { x: continuation.x, y: continuation.y } }
      : combatant),
    turn: { ...encounter.turn, movementRemaining: Math.max(0, encounter.turn.movementRemaining - continuation.cost) },
    log: logMovement ? [`${mover.name} moved ${continuation.cost} feet to ${coordinate}.`, ...encounter.log] : encounter.log,
  };
}

export function resumeMovementContinuation(encounter: EncounterState, continuation: MovementContinuation, random = Math.random): MovementResult {
  const moved = applyMovementContinuation(encounter, continuation, false);
  const destination = continuation.destination;
  if (destination && (destination.x !== continuation.x || destination.y !== continuation.y)) {
    return moveActiveCombatant(moved, destination.x, destination.y, random);
  }
  return { legal: true, reason: "Movement continues.", encounter: moved, attackRoll: null, damageRoll: null };
}

export function moveActiveCombatant(encounter: EncounterState, x: number, y: number, random = Math.random): MovementResult {
  const denied = (reason: string): MovementResult => ({ legal: false, reason, encounter, attackRoll: null, damageRoll: null });
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "player") return denied("Movement is only available during your character's turn.");
  if (encounter.pendingResponse) return denied("Resolve the pending player response before moving.");
  if (x === active.position.x && y === active.position.y) return denied("Your character is already on that square.");
  const destination = legalMovementDestinations(encounter).find((cell) => cell.x === x && cell.y === y);
  if (!destination) return denied("That square cannot be reached with your remaining movement by a legal path.");

  let next = encounter;
  let lastAttackRoll: D20Result | null = null;
  let lastDamageRoll: DamageRoll | null = null;
  const notes: string[] = [];

  for (const step of destination.path) {
    const mover = next.combatants[next.activeIndex];
    const continuation: MovementContinuation = { combatantId: mover.id, ...step, destination: { x, y } };
    const threat = next.turn.disengaged ? null : next.combatants
      .filter((combatant) => combatant.side === "enemy" && combatant.hitPoints.current > 0 && combatant.reactionAvailable)
      .flatMap((combatant) => combatant.attacks.filter((attack) => attack.kind === "melee").map((attack) => ({ combatant, attack })))
      .find(({ combatant, attack }) => distanceFromCell(mover.position.x, mover.position.y, combatant) <= attack.normalRangeFeet
        && distanceFromCell(step.x, step.y, combatant) > attack.normalRangeFeet);

    if (!threat) {
      next = resolvePointHazardsForCombatant(applyMovementContinuation(next, continuation, false), mover.id, random);
      continue;
    }

    const attackResult = resolveReactionAttackRoll(next, threat.combatant.id, mover.id, threat.attack, random);
    if (!attackResult.legal) return { legal: false, reason: attackResult.reason, encounter: next, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
    lastAttackRoll = attackResult.roll;
    notes.push(`${threat.combatant.name} uses its reaction as ${mover.name} leaves its reach. ${attackResult.summary}`);
    if (!attackResult.hit) {
      next = resolvePointHazardsForCombatant(applyMovementContinuation(attackResult.encounter, continuation, false), mover.id, random);
      continue;
    }

    const updatedPlayer = attackResult.encounter.combatants.find((combatant) => combatant.id === mover.id)!;
    const availableReactionIds = updatedPlayer.reactionOptions.filter((option) => updatedPlayer.reactionAvailable
      && (!option.spellLevel || validateSpellSlot(attackResult.encounter, mover.id, option.spellLevel).legal)).map((option) => option.id);
    if (availableReactionIds.length) {
      next = {
        ...attackResult.encounter,
        pendingResponse: {
          type: "attack-reaction",
          sourceCombatantId: threat.combatant.id,
          targetCombatantId: mover.id,
          attack: threat.attack,
          attackTotal: attackResult.roll.total,
          attackNatural: attackResult.roll.natural,
          critical: attackResult.critical,
          targetArmorClass: attackResult.targetArmorClass,
          availableReactionIds,
          continuation,
        },
        log: [`Pause movement: ${mover.name} can react before the opportunity attack deals damage.`, ...attackResult.encounter.log],
      };
      return { legal: true, reason: `${notes.join(" ")} Resolve your reaction before movement continues toward ${String.fromCharCode(65 + x)}${y + 1}.`, encounter: next, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
    }

    const damageResult = resolveAttackDamage(attackResult.encounter, threat.attack, mover.id, attackResult.critical, random);
    if (!damageResult.legal) return { legal: false, reason: damageResult.reason, encounter: damageResult.encounter, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
    lastDamageRoll = damageResult.roll;
    notes.push(damageResult.summary);
    if (damageResult.encounter.pendingResponse?.type === "zero-hit-point-replacement" || damageResult.encounter.pendingResponse?.type === "damage-reduction-reaction") {
      const paused = {
        ...damageResult.encounter,
        pendingResponse: { ...damageResult.encounter.pendingResponse, continuation },
      };
      const prompt = paused.pendingResponse.type === "damage-reduction-reaction" ? `Decide whether ${mover.name} uses a damage-reduction reaction` : `Decide whether to use ${mover.name}'s zero-HP replacement feature`;
      return { legal: true, reason: `${notes.join(" ")} ${prompt} before movement continues.`, encounter: paused, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
    }
    const conscious = damageResult.encounter.combatants.find((combatant) => combatant.id === mover.id)!.hitPoints.current > 0;
    if (!conscious) return { legal: true, reason: `${notes.join(" ")} ${mover.name} falls unconscious before leaving the square.`, encounter: damageResult.encounter, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
    const concentrated = queueConcentrationCheck(damageResult.encounter, mover.id, damageResult.damageApplied, continuation);
    if (concentrated.pendingResponse?.type === "concentration-check") {
      return { legal: true, reason: `${notes.join(" ")} Resolve the concentration check before movement continues.`, encounter: concentrated, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
    }
    next = resolvePointHazardsForCombatant(applyMovementContinuation(concentrated, continuation, false), mover.id, random);
  }

  const coordinate = `${String.fromCharCode(65 + x)}${y + 1}`;
  const terrain = next.map.terrain.find((cell) => cell.x === x && cell.y === y);
  const objectiveNote = terrain?.kind === "objective" ? ` ${active.name} reached the objective square.` : "";
  const summary = `${active.name} moved ${destination.cost} feet to ${coordinate}.${objectiveNote} ${next.turn.movementRemaining} feet remain and can be used before or after an action.`;
  next = { ...next, log: [summary, ...next.log] };
  return { legal: true, reason: `${notes.join(" ")}${notes.length ? " " : ""}${summary}`, encounter: next, attackRoll: lastAttackRoll, damageRoll: lastDamageRoll };
}
