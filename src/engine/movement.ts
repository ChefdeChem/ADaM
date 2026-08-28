import type { EncounterState, MovementContinuation } from "../domain/combat";
import type { D20Result, DamageRoll } from "./dice";
import { resolveAttackDamage, resolveReactionAttackRoll } from "./combat-options";
import { queueConcentrationCheck } from "./defensive-responses";
import { validateSpellSlot } from "./resources";

export type MovementResult = {
  legal: boolean;
  reason: string;
  encounter: EncounterState;
  attackRoll: D20Result | null;
  damageRoll: DamageRoll | null;
};

const distanceFromCell = (x: number, y: number, other: { position: { x: number; y: number } }) => Math.max(
  Math.abs(x - other.position.x),
  Math.abs(y - other.position.y),
) * 5;

export function applyMovementContinuation(encounter: EncounterState, continuation: MovementContinuation): EncounterState {
  const mover = encounter.combatants.find((combatant) => combatant.id === continuation.combatantId);
  if (!mover || mover.hitPoints.current <= 0) return encounter;
  const coordinate = `${String.fromCharCode(65 + continuation.x)}${continuation.y + 1}`;
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === mover.id
      ? { ...combatant, position: { x: continuation.x, y: continuation.y } }
      : combatant),
    turn: { ...encounter.turn, movementRemaining: Math.max(0, encounter.turn.movementRemaining - continuation.cost) },
    log: [`${mover.name} moved ${continuation.cost} feet to ${coordinate}.`, ...encounter.log],
  };
}

export function moveActiveCombatant(encounter: EncounterState, x: number, y: number, random = Math.random): MovementResult {
  const denied = (reason: string): MovementResult => ({ legal: false, reason, encounter, attackRoll: null, damageRoll: null });
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "player") return denied("Movement is only available during your character's turn.");
  if (encounter.pendingResponse) return denied("Resolve the pending player response before moving.");
  if (x < 0 || y < 0 || x >= encounter.map.width || y >= encounter.map.height) return denied("That square is outside the map.");

  const dx = Math.abs(active.position.x - x);
  const dy = Math.abs(active.position.y - y);
  if (Math.max(dx, dy) !== 1) return denied("Choose an adjacent square. Each horizontal, vertical, or diagonal square is 5 feet.");

  const terrain = encounter.map.terrain.find((cell) => cell.x === x && cell.y === y);
  if (terrain?.kind === "wall") return denied(`${terrain.label} blocks that square.`);
  if (encounter.combatants.some((combatant) => combatant.position.x === x && combatant.position.y === y)) return denied("Another creature occupies that square.");

  const cost = terrain?.kind === "difficult" ? 10 : 5;
  if (encounter.turn.movementRemaining < cost) return denied(`That square costs ${cost} feet and you only have ${encounter.turn.movementRemaining} feet remaining.`);
  const continuation: MovementContinuation = { combatantId: active.id, x, y, cost };

  const threat = encounter.turn.disengaged ? null : encounter.combatants
    .filter((combatant) => combatant.side === "enemy" && combatant.hitPoints.current > 0 && combatant.reactionAvailable)
    .flatMap((combatant) => combatant.attacks.filter((attack) => attack.kind === "melee").map((attack) => ({ combatant, attack })))
    .find(({ combatant, attack }) => distanceFromCell(active.position.x, active.position.y, combatant) <= attack.normalRangeFeet
      && distanceFromCell(x, y, combatant) > attack.normalRangeFeet);

  if (!threat) {
    const moved = applyMovementContinuation(encounter, continuation);
    const terrainNote = terrain ? ` (${terrain.label})` : "";
    const objectiveNote = terrain?.kind === "objective" ? ` ${active.name} reached the objective square.` : "";
    return { legal: true, reason: `${active.name} moved ${cost} feet${terrainNote}.${objectiveNote} ${moved.turn.movementRemaining} feet remain and can be used before or after an action.`, encounter: moved, attackRoll: null, damageRoll: null };
  }

  const attackResult = resolveReactionAttackRoll(encounter, threat.combatant.id, active.id, threat.attack, random);
  if (!attackResult.legal) return denied(attackResult.reason);
  if (!attackResult.hit) {
    const moved = applyMovementContinuation(attackResult.encounter, continuation);
    return { legal: true, reason: `${threat.combatant.name} uses its reaction as you leave its reach. ${attackResult.summary} You complete the move.`, encounter: moved, attackRoll: attackResult.roll, damageRoll: null };
  }

  const updatedPlayer = attackResult.encounter.combatants.find((combatant) => combatant.id === active.id)!;
  const availableReactionIds = updatedPlayer.reactionOptions.filter((option) => updatedPlayer.reactionAvailable
    && (!option.spellLevel || validateSpellSlot(attackResult.encounter, active.id, option.spellLevel).legal)).map((option) => option.id);
  if (availableReactionIds.length) {
    const pending: EncounterState = {
      ...attackResult.encounter,
      pendingResponse: {
        type: "attack-reaction",
        sourceCombatantId: threat.combatant.id,
        targetCombatantId: active.id,
        attack: threat.attack,
        attackTotal: attackResult.roll.total,
        attackNatural: attackResult.roll.natural,
        critical: attackResult.critical,
        targetArmorClass: attackResult.targetArmorClass,
        availableReactionIds,
        continuation,
      },
      log: [`Pause movement: ${active.name} can react before the opportunity attack deals damage.`, ...attackResult.encounter.log],
    };
    return { legal: true, reason: `${threat.combatant.name} hits with an opportunity attack. Resolve your reaction before movement continues.`, encounter: pending, attackRoll: attackResult.roll, damageRoll: null };
  }

  const damageResult = resolveAttackDamage(attackResult.encounter, threat.attack, active.id, attackResult.critical, random);
  if (!damageResult.legal) return { legal: false, reason: damageResult.reason, encounter: damageResult.encounter, attackRoll: attackResult.roll, damageRoll: null };
  const conscious = damageResult.encounter.combatants.find((combatant) => combatant.id === active.id)!.hitPoints.current > 0;
  const moved = conscious ? applyMovementContinuation(damageResult.encounter, continuation) : damageResult.encounter;
  const next = queueConcentrationCheck(moved, active.id, damageResult.damageApplied);
  return {
    legal: true,
    reason: `${threat.combatant.name} uses its reaction as you leave its reach. ${attackResult.summary} ${damageResult.summary}${conscious ? " You complete the move." : " You fall unconscious before leaving the square."}`,
    encounter: next,
    attackRoll: attackResult.roll,
    damageRoll: damageResult.roll,
  };
}
