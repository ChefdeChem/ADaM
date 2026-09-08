import type { CharacterSpell } from "../domain/character";
import type { Combatant, EncounterState } from "../domain/combat";
import { analyzeTarget } from "./targeting";
import { canOccupyCells, occupiedCells, reconcileConcentration, revealHiddenInPlainSight } from "./effects";
import { crossesSolidCorner } from "./grid-movement";

type Area = NonNullable<CharacterSpell["area"]>;

function positionInsideArea(source: { x: number; y: number }, aim: { x: number; y: number }, target: { x: number; y: number }, area: Area): boolean {
  const directionX = aim.x - source.x;
  const directionY = aim.y - source.y;
  const directionLength = Math.hypot(directionX, directionY);
  if (directionLength === 0) return false;
  const unitX = directionX / directionLength;
  const unitY = directionY / directionLength;
  const relativeX = (target.x - source.x) * 5;
  const relativeY = (target.y - source.y) * 5;
  const forward = relativeX * unitX + relativeY * unitY;
  const lateral = Math.abs(relativeX * unitY - relativeY * unitX);
  const halfCell = 2.5;
  if (forward <= 0 || forward > area.sizeFeet + halfCell) return false;
  return area.shape === "cone"
    ? lateral <= forward / 2 + halfCell
    : area.shape === "line" ? lateral < 5 : lateral <= area.sizeFeet / 2 + halfCell;
}

function pointInsideArea(encounter: EncounterState, source: Combatant, aim: Combatant, point: { x: number; y: number }, area: Area): boolean {
  return occupiedCells(encounter, source.id).some((sourcePoint) => occupiedCells(encounter, aim.id)
    .some((aimPoint) => positionInsideArea(sourcePoint, aimPoint, point, area)));
}

export function areaTargets(encounter: EncounterState, sourceId: string, aimTargetId: string, area: Area): Combatant[] {
  const source = encounter.combatants.find((combatant) => combatant.id === sourceId);
  const aim = encounter.combatants.find((combatant) => combatant.id === aimTargetId);
  if (!source || !aim || source.id === aim.id) return [];
  return encounter.combatants.filter((target) => {
    if (target.id === source.id || target.deathSaves.failures >= 3) return false;
    if (area.affects === "hostile-creatures" && target.side === source.side) return false;
    if (!occupiedCells(encounter, target.id).some((point) => pointInsideArea(encounter, source, aim, point, area))) return false;
    return Boolean(analyzeTarget(encounter, target.id)?.lineOfSight);
  });
}

export function validateAreaAim(encounter: EncounterState, sourceId: string, aimTargetId: string, area: Area): { legal: boolean; reason?: string } {
  const source = encounter.combatants.find((combatant) => combatant.id === sourceId);
  const aim = encounter.combatants.find((combatant) => combatant.id === aimTargetId);
  if (!source || !aim || source.id === aim.id) return { legal: false, reason: "Choose another creature to set the area's direction." };
  if (aim.hitPoints.current <= 0) return { legal: false, reason: `${aim.name} is already defeated.` };
  if (area.affects === "hostile-creatures" && aim.side === source.side) return { legal: false, reason: "Choose a hostile creature to set the area's direction." };
  const analysis = analyzeTarget(encounter, aimTargetId);
  if (!analysis?.lineOfSight) return { legal: false, reason: `${aim.name} is outside your line of sight.` };
  if (!occupiedCells(encounter, aim.id).some((point) => pointInsideArea(encounter, source, aim, point, area))) return { legal: false, reason: `${aim.name} is outside the ${area.sizeFeet}-foot ${area.shape}.` };
  return { legal: true };
}

export function pushLooseObjectsInArea(encounter: EncounterState, sourceId: string, aimTargetId: string, area: Area, distanceFeet: number): { encounter: EncounterState; moved: number } {
  const source = encounter.combatants.find((combatant) => combatant.id === sourceId);
  const aim = encounter.combatants.find((combatant) => combatant.id === aimTargetId);
  if (!source || !aim || distanceFeet <= 0) return { encounter, moved: 0 };
  const objects = encounter.map.terrain.filter((cell) => cell.looseObject?.unsecured && pointInsideArea(encounter, source, aim, cell, area));
  let terrain = encounter.map.terrain.map((cell) => ({ ...cell }));
  let moved = 0;
  for (const object of objects) {
    const stepX = Math.sign(object.x - source.position.x);
    const stepY = Math.sign(object.y - source.position.y);
    if (!stepX && !stepY) continue;
    let position = { x: object.x, y: object.y };
    for (let step = 0; step < Math.floor(distanceFeet / 5); step += 1) {
      const next = { x: position.x + stepX, y: position.y + stepY };
      const blocked = next.x < 0 || next.y < 0 || next.x >= encounter.map.width || next.y >= encounter.map.height
        || terrain.some((cell) => cell !== object && cell.x === next.x && cell.y === next.y && (cell.kind === "wall" || cell.looseObject?.unsecured))
        || encounter.combatants.some((combatant) => occupiedCells(encounter, combatant.id).some((cell) => cell.x === next.x && cell.y === next.y));
      if (blocked) break;
      position = next;
    }
    if (position.x === object.x && position.y === object.y) continue;
    terrain = terrain.map((cell) => cell.x === object.x && cell.y === object.y && cell.looseObject?.unsecured ? { ...cell, ...position } : cell);
    moved += 1;
  }
  if (!moved) return { encounter, moved };
  return { encounter: { ...encounter, map: { ...encounter.map, terrain }, log: [`Thunderwave pushes ${moved} unsecured object${moved === 1 ? "" : "s"} 10 feet or until blocked.`, ...encounter.log] }, moved };
}

export function pushTargetAway(encounter: EncounterState, sourceId: string, targetId: string, distanceFeet: number): EncounterState {
  const source = encounter.combatants.find((combatant) => combatant.id === sourceId);
  const target = encounter.combatants.find((combatant) => combatant.id === targetId);
  if (!source || !target || distanceFeet <= 0) return encounter;
  const stepX = Math.sign(target.position.x - source.position.x);
  const stepY = Math.sign(target.position.y - source.position.y);
  if (stepX === 0 && stepY === 0) return encounter;
  let position = { ...target.position };
  for (let step = 0; step < Math.floor(distanceFeet / 5); step += 1) {
    const next = { x: position.x + stepX, y: position.y + stepY };
    if (!canOccupyCells(encounter, targetId, next)) break;
    if (crossesSolidCorner(encounter, targetId, position, next)) break;
    position = next;
  }
  if (position.x === target.position.x && position.y === target.position.y) return encounter;
  return reconcileConcentration(revealHiddenInPlainSight({
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === targetId ? { ...combatant, position } : combatant),
    log: [`${target.name} is pushed ${Math.max(Math.abs(position.x - target.position.x), Math.abs(position.y - target.position.y)) * 5} feet.`, ...encounter.log],
  }));
}
