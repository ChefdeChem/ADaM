import type { CharacterAttack } from "../domain/character";
import type { Combatant, EncounterState, ExperienceMode } from "../domain/combat";
import type { D20Result, DamageRoll } from "./dice";
import { resolveAttackDamage, resolveAttackRoll, validateAttackTarget } from "./combat-options";
import { gridDistanceFeet } from "./targeting";

export type EnemyTurnStep = {
  kind: "move" | "attack" | "damage" | "miss" | "wait";
  summary: string;
};

export type EnemyTurnResolution = {
  encounter: EncounterState;
  steps: EnemyTurnStep[];
  attackRoll: D20Result | null;
  damageRoll: DamageRoll | null;
};

export type CombatOutcome = "active" | "victory" | "defeat";

export function combatOutcome(encounter: EncounterState): CombatOutcome {
  const playerAlive = encounter.combatants.some((combatant) => combatant.side === "player" && combatant.hitPoints.current > 0);
  const enemyAlive = encounter.combatants.some((combatant) => combatant.side === "enemy" && combatant.hitPoints.current > 0);
  if (!playerAlive) return "defeat";
  if (!enemyAlive) return "victory";
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

function legalAttack(encounter: EncounterState, targetId: string, attacks: CharacterAttack[]): CharacterAttack | null {
  return attacks.find((attack) => validateAttackTarget(encounter, attack, targetId).legal) ?? null;
}

function chooseEnemyPosition(encounter: EncounterState, target: Combatant, attacks: CharacterAttack[]): { encounter: EncounterState; cost: number } {
  if (legalAttack(encounter, target.id, attacks)) return { encounter, cost: 0 };
  const active = encounter.combatants[encounter.activeIndex];
  const options = reachableCells(encounter).map((cell) => {
    const state = withActivePosition(encounter, cell);
    const moved = state.combatants[state.activeIndex];
    return { cell, state, canAttack: Boolean(legalAttack(state, target.id, attacks)), distance: gridDistanceFeet(moved, target) };
  });
  options.sort((left, right) => {
    if (left.canAttack !== right.canAttack) return left.canAttack ? -1 : 1;
    if (left.canAttack && right.canAttack) return left.cell.cost - right.cell.cost || left.distance - right.distance;
    return left.distance - right.distance || right.cell.cost - left.cell.cost;
  });
  const chosen = options[0];
  if (!chosen || (chosen.cell.x === active.position.x && chosen.cell.y === active.position.y)) return { encounter, cost: 0 };
  const coordinate = `${String.fromCharCode(65 + chosen.cell.x)}${chosen.cell.y + 1}`;
  return {
    cost: chosen.cell.cost,
    encounter: {
      ...chosen.state,
      turn: { ...chosen.state.turn, movementRemaining: Math.max(0, chosen.state.turn.movementRemaining - chosen.cell.cost) },
      log: [`${active.name} moved ${chosen.cell.cost} feet to ${coordinate}.`, ...chosen.state.log],
    },
  };
}

export function resolveEnemyTurn(encounter: EncounterState, random = Math.random): EnemyTurnResolution {
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "enemy") return { encounter, steps: [], attackRoll: null, damageRoll: null };
  if (active.hitPoints.current <= 0) return { encounter, steps: [{ kind: "wait", summary: `${active.name} is defeated and cannot act.` }], attackRoll: null, damageRoll: null };
  const target = encounter.combatants
    .filter((combatant) => combatant.side === "player" && combatant.hitPoints.current > 0)
    .sort((left, right) => gridDistanceFeet(active, left) - gridDistanceFeet(active, right))[0];
  if (!target) return { encounter, steps: [{ kind: "wait", summary: `${active.name} has no conscious target.` }], attackRoll: null, damageRoll: null };

  const attacks = active.attacks ?? [];
  const positioned = chooseEnemyPosition(encounter, target, attacks);
  let next: EncounterState = { ...positioned.encounter, selectedTargetId: target.id };
  const movedActive = next.combatants[next.activeIndex];
  const steps: EnemyTurnStep[] = [];
  if (positioned.cost > 0) steps.push({ kind: "move", summary: `${active.name} moves ${positioned.cost} feet toward ${target.name}.` });
  const attack = legalAttack(next, target.id, attacks);
  if (!attack) {
    const summary = `${active.name} cannot reach a legal attack and ends its turn.`;
    return { encounter: { ...next, log: [summary, ...next.log] }, steps: [...steps, { kind: "wait", summary }], attackRoll: null, damageRoll: null };
  }

  const attackResult = resolveAttackRoll(next, attack, random);
  if (!attackResult.legal) return { encounter: next, steps: [...steps, { kind: "wait", summary: attackResult.reason }], attackRoll: null, damageRoll: null };
  next = attackResult.encounter;
  steps.push({ kind: attackResult.hit ? "attack" : "miss", summary: `${movedActive.name} targets ${target.name}. ${attackResult.summary}` });
  if (!attackResult.hit) return { encounter: next, steps, attackRoll: attackResult.roll, damageRoll: null };

  const damageResult = resolveAttackDamage(next, attack, target.id, attackResult.critical, random);
  if (!damageResult.legal) return { encounter: next, steps: [...steps, { kind: "wait", summary: damageResult.reason }], attackRoll: attackResult.roll, damageRoll: null };
  next = damageResult.encounter;
  const updatedTarget = next.combatants.find((combatant) => combatant.id === target.id)!;
  steps.push({ kind: "damage", summary: `${damageResult.summary} ${updatedTarget.name} has ${updatedTarget.hitPoints.current}/${updatedTarget.hitPoints.maximum} HP remaining.` });
  return { encounter: next, steps, attackRoll: attackResult.roll, damageRoll: damageResult.roll };
}
