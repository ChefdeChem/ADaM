import type { CharacterSpell } from "../domain/character";
import type { Combatant, EncounterState } from "../domain/combat";
import { analyzeTarget } from "./targeting";
import { canOccupyCells } from "./effects";

type Area = NonNullable<CharacterSpell["area"]>;

function pointInsideArea(source: Combatant, aim: Combatant, target: Combatant, area: Area): boolean {
  const directionX = aim.position.x - source.position.x;
  const directionY = aim.position.y - source.position.y;
  const directionLength = Math.hypot(directionX, directionY);
  if (directionLength === 0) return false;
  const unitX = directionX / directionLength;
  const unitY = directionY / directionLength;
  const relativeX = (target.position.x - source.position.x) * 5;
  const relativeY = (target.position.y - source.position.y) * 5;
  const forward = relativeX * unitX + relativeY * unitY;
  const lateral = Math.abs(relativeX * unitY - relativeY * unitX);
  const halfCell = 2.5;
  if (forward <= 0 || forward > area.sizeFeet + halfCell) return false;
  return area.shape === "cone"
    ? lateral <= forward / 2 + halfCell
    : lateral <= area.sizeFeet / 2 + halfCell;
}

export function areaTargets(encounter: EncounterState, sourceId: string, aimTargetId: string, area: Area): Combatant[] {
  const source = encounter.combatants.find((combatant) => combatant.id === sourceId);
  const aim = encounter.combatants.find((combatant) => combatant.id === aimTargetId);
  if (!source || !aim || source.id === aim.id) return [];
  return encounter.combatants.filter((target) => {
    if (target.id === source.id || target.hitPoints.current <= 0) return false;
    if (area.affects === "hostile-creatures" && target.side === source.side) return false;
    if (!pointInsideArea(source, aim, target, area)) return false;
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
  if (!pointInsideArea(source, aim, aim, area)) return { legal: false, reason: `${aim.name} is outside the ${area.sizeFeet}-foot ${area.shape}.` };
  return { legal: true };
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
    position = next;
  }
  if (position.x === target.position.x && position.y === target.position.y) return encounter;
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === targetId ? { ...combatant, position } : combatant),
    log: [`${target.name} is pushed ${Math.max(Math.abs(position.x - target.position.x), Math.abs(position.y - target.position.y)) * 5} feet.`, ...encounter.log],
  };
}
