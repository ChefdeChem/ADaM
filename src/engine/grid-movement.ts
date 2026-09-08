import type { EncounterState } from "../domain/combat";
import { occupiedCells } from "./effects";

type Point = { x: number; y: number };

/** The trainer uses 5-foot diagonals, but solid terrain corners cannot be crossed. */
export function crossesSolidCorner(e: EncounterState, id: string, from: Point, to: Point): boolean {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx || !dy) return false;
  return occupiedCells(e, id, from).some(cell => e.map.terrain.some(terrain => terrain.kind === "wall"
    && ((terrain.x === cell.x + dx && terrain.y === cell.y) || (terrain.x === cell.x && terrain.y === cell.y + dy))));
}

/** Crawling and Difficult Terrain add costs; they do not multiply one another. */
export function gridStepCost(e: EncounterState, id: string, to: Point): number {
  const actor = e.combatants.find(c => c.id === id);
  const difficult = occupiedCells(e, id, to).some(point => e.map.terrain.some(cell => cell.x === point.x && cell.y === point.y && cell.kind === "difficult"));
  const crawling = actor?.conditions?.some(condition => condition.toLowerCase() === "prone");
  return 5 + (difficult ? 5 : 0) + (crawling ? 5 : 0);
}
