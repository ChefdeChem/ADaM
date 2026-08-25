import type { EncounterState } from "../domain/combat";

export type MovementResult = { legal: boolean; reason: string; encounter: EncounterState };

export function moveActiveCombatant(encounter: EncounterState, x: number, y: number): MovementResult {
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "player") return { legal: false, reason: "Movement is only available during your character's turn.", encounter };
  if (x < 0 || y < 0 || x >= encounter.map.width || y >= encounter.map.height) return { legal: false, reason: "That square is outside the map.", encounter };

  const dx = Math.abs(active.position.x - x);
  const dy = Math.abs(active.position.y - y);
  if (Math.max(dx, dy) !== 1) return { legal: false, reason: "Choose an adjacent square. Each horizontal, vertical, or diagonal square is 5 feet.", encounter };

  const terrain = encounter.map.terrain.find((cell) => cell.x === x && cell.y === y);
  if (terrain?.kind === "wall") return { legal: false, reason: `${terrain.label} blocks that square.`, encounter };
  if (encounter.combatants.some((combatant) => combatant.position.x === x && combatant.position.y === y)) return { legal: false, reason: "Another creature occupies that square.", encounter };

  const cost = terrain?.kind === "difficult" ? 10 : 5;
  if (encounter.turn.movementRemaining < cost) return { legal: false, reason: `That square costs ${cost} feet and you only have ${encounter.turn.movementRemaining} feet remaining.`, encounter };

  const combatants = encounter.combatants.map((combatant, index) => index === encounter.activeIndex ? { ...combatant, position: { x, y } } : combatant);
  const terrainNote = terrain ? ` (${terrain.label})` : "";
  const objectiveNote = terrain?.kind === "objective" ? ` ${active.name} reached the objective square.` : "";
  return {
    legal: true,
    reason: `${active.name} moved ${cost} feet${terrainNote}.${objectiveNote}`,
    encounter: {
      ...encounter,
      combatants,
      turn: { ...encounter.turn, movementRemaining: encounter.turn.movementRemaining - cost },
      log: [`${active.name} moved to ${String.fromCharCode(65 + x)}${y + 1}.${objectiveNote}`, ...encounter.log],
    },
  };
}
