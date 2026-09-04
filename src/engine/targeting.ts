import type { Combatant, EncounterState } from "../domain/combat";

export type CoverLevel = "none" | "half";

export type TargetAnalysis = {
  target: Combatant;
  distanceFeet: number;
  lineOfSight: boolean;
  cover: CoverLevel;
};

export function gridDistanceFeet(origin: Combatant, target: Combatant): number {
  const dx = Math.abs(origin.position.x - target.position.x);
  const dy = Math.abs(origin.position.y - target.position.y);
  return Math.max(dx, dy) * 5;
}

function cellsBetween(origin: Combatant, target: Pick<Combatant, "position">): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  let x = origin.position.x;
  let y = origin.position.y;
  const targetX = target.position.x;
  const targetY = target.position.y;
  const dx = Math.abs(targetX - x);
  const sx = x < targetX ? 1 : -1;
  const dy = -Math.abs(targetY - y);
  const sy = y < targetY ? 1 : -1;
  let error = dx + dy;

  while (x !== targetX || y !== targetY) {
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
    if (x !== targetX || y !== targetY) cells.push({ x, y });
  }
  return cells;
}

export function hasLineOfSightToPoint(encounter: EncounterState, originId: string, x: number, y: number): boolean {
  const origin = encounter.combatants.find((combatant) => combatant.id === originId);
  if (!origin) return false;
  return !cellsBetween(origin, { position: { x, y } }).some((cell) =>
    encounter.map.terrain.some((terrain) => terrain.x === cell.x && terrain.y === cell.y && terrain.kind === "wall"));
}

export function analyzeTarget(encounter: EncounterState, targetId: string): TargetAnalysis | null {
  const origin = encounter.combatants[encounter.activeIndex];
  const target = encounter.combatants.find((combatant) => combatant.id === targetId);
  if (!origin || !target || origin.id === target.id) return null;

  const intervening = cellsBetween(origin, target);
  const lineOfSight = !intervening.some((cell) => encounter.map.terrain.some((terrain) => terrain.x === cell.x && terrain.y === cell.y && terrain.kind === "wall"));
  const targetTerrain = encounter.map.terrain.find((cell) => cell.x === target.position.x && cell.y === target.position.y);
  const terrainCover = intervening.some((cell) => encounter.map.terrain.some((terrain) => terrain.x === cell.x && terrain.y === cell.y && terrain.kind === "cover"));
  const creatureCover = intervening.some((cell) => encounter.combatants.some((combatant) => combatant.id !== origin.id && combatant.id !== target.id && combatant.position.x === cell.x && combatant.position.y === cell.y));

  return {
    target,
    distanceFeet: gridDistanceFeet(origin, target),
    lineOfSight,
    cover: targetTerrain?.kind === "cover" || terrainCover || creatureCover ? "half" : "none",
  };
}

export function selectTarget(encounter: EncounterState, targetId: string | null): EncounterState {
  if (targetId === null) return { ...encounter, selectedTargetId: null };
  return analyzeTarget(encounter, targetId) ? { ...encounter, selectedTargetId: targetId } : encounter;
}
