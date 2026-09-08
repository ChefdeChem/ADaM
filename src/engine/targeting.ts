import type { Combatant, EncounterState } from "../domain/combat";

export type CoverLevel = "none" | "half";

export type TargetAnalysis = {
  target: Combatant;
  distanceFeet: number;
  lineOfSight: boolean;
  cover: CoverLevel;
};

function combatantCells(encounter: EncounterState, combatant: Combatant): Array<{ x: number; y: number }> {
  const large = combatant.size === "large" || encounter.effects.some((effect) => effect.targetCombatantId === combatant.id && effect.modifiers.size === "large");
  const width = large ? 2 : 1;
  return Array.from({ length: width * width }, (_, index) => ({ x: combatant.position.x + index % width, y: combatant.position.y + Math.floor(index / width) }));
}

export function gridDistanceFeet(origin: Combatant, target: Combatant): number {
  const dx = Math.abs(origin.position.x - target.position.x);
  const dy = Math.abs(origin.position.y - target.position.y);
  return Math.max(dx, dy) * 5;
}

function cellsBetweenPoints(origin: { x: number; y: number }, target: { x: number; y: number }): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  let x = origin.x;
  let y = origin.y;
  const targetX = target.x;
  const targetY = target.y;
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

function wallAt(encounter: EncounterState, point: { x: number; y: number }): boolean {
  return encounter.map.terrain.some((terrain) => terrain.x === point.x && terrain.y === point.y && terrain.kind === "wall");
}

export function lineCellsBetween(origin: { x: number; y: number }, target: { x: number; y: number }) {
  return cellsBetweenPoints(origin, target);
}

export function hasLineOfSightToPoint(encounter: EncounterState, originId: string, x: number, y: number): boolean {
  const origin = encounter.combatants.find((combatant) => combatant.id === originId);
  if (!origin) return false;
  return combatantCells(encounter, origin).some((cell) => !cellsBetweenPoints(cell, { x, y }).some((point) => wallAt(encounter, point)));
}

export function analyzeTarget(encounter: EncounterState, targetId: string): TargetAnalysis | null {
  const origin = encounter.combatants[encounter.activeIndex];
  const target = encounter.combatants.find((combatant) => combatant.id === targetId);
  if (!origin || !target || origin.id === target.id) return null;

  const sourceCells = combatantCells(encounter, origin);
  const targetCells = combatantCells(encounter, target);
  const rays = sourceCells.flatMap((from) => targetCells.map((to) => {
    const intervening = cellsBetweenPoints(from, to);
    const lineOfSight = !intervening.some((cell) => wallAt(encounter, cell));
    const terrainCover = intervening.some((cell) => encounter.map.terrain.some((terrain) => terrain.x === cell.x && terrain.y === cell.y && terrain.kind === "cover"));
    const creatureCover = intervening.some((cell) => encounter.combatants.some((combatant) => combatant.id !== origin.id && combatant.id !== target.id
      && combatantCells(encounter, combatant).some((occupied) => occupied.x === cell.x && occupied.y === cell.y)));
    const targetCover = encounter.map.terrain.some((terrain) => terrain.x === to.x && terrain.y === to.y && terrain.kind === "cover");
    return { from, to, intervening, lineOfSight, cover: targetCover || terrainCover || creatureCover };
  }));
  const visibleRays = rays.filter((ray) => ray.lineOfSight);
  const bestRay = visibleRays.find((ray) => !ray.cover) ?? visibleRays[0];
  const distanceFeet = Math.min(...sourceCells.flatMap((from) => targetCells.map((to) => Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) * 5)));

  return {
    target,
    distanceFeet,
    lineOfSight: Boolean(bestRay),
    cover: bestRay?.cover ? "half" : "none",
  };
}

export function selectTarget(encounter: EncounterState, targetId: string | null): EncounterState {
  if (targetId === null) return { ...encounter, selectedTargetId: null };
  return analyzeTarget(encounter, targetId) ? { ...encounter, selectedTargetId: targetId } : encounter;
}
