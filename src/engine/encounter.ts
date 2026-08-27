import type { Character } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import type { Scenario } from "../scenarios/types";
import { effectiveSpeed, expireEffectsAtTurnStart } from "./effects";

export function createEncounter(character: Character, scenario: Scenario): EncounterState {
  const enemies = [
    { id: "scout-1", name: "Ashen Scout", side: "enemy" as const, baseArmorClass: 13, baseSpeedFeet: 30, hitPoints: { current: 18, maximum: 18 }, temporaryHitPoints: 0, resources: [], initiative: 12, position: { x: 9, y: 2 } },
    { id: "brute-1", name: "Ruined Guardian", side: "enemy" as const, baseArmorClass: 15, baseSpeedFeet: 30, hitPoints: { current: 30, maximum: 30 }, temporaryHitPoints: 0, resources: [], initiative: 8, position: { x: 9, y: 5 } },
    { id: "skirmisher-1", name: "Cinder Skirmisher", side: "enemy" as const, baseArmorClass: 14, baseSpeedFeet: 30, hitPoints: { current: 22, maximum: 22 }, temporaryHitPoints: 0, resources: [], initiative: 6, position: { x: 10, y: 3 } },
  ];
  const enemyCount = scenario.difficulty === "easy" ? 1 : scenario.difficulty === "hard" ? 3 : 2;
  return {
    round: 1,
    activeIndex: 0,
    selectedTargetId: null,
    combatants: [
      {
        id: character.id,
        name: character.name,
        side: "player",
        baseArmorClass: character.armorClass,
        baseSpeedFeet: character.speedFeet ?? 30,
        hitPoints: { ...character.hitPoints },
        temporaryHitPoints: 0,
        resources: character.resources.map((resource) => ({ ...resource })),
        initiative: 16,
        position: { x: 1, y: 6 },
      },
      ...enemies.slice(0, enemyCount),
    ],
    effects: [],
    map: scenario.grid,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30 },
    log: ["Encounter started. The collapsed gate is thirty feet ahead."],
  };
}

export function endTurn(encounter: EncounterState): EncounterState {
  const nextIndex = (encounter.activeIndex + 1) % encounter.combatants.length;
  const round = nextIndex === 0 ? encounter.round + 1 : encounter.round;
  const nextCombatant = encounter.combatants[nextIndex];
  const advanced = {
    ...encounter,
    round,
    activeIndex: nextIndex,
    selectedTargetId: null,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: nextCombatant.baseSpeedFeet },
    log: [`Turn passed to ${nextCombatant.name}.`, ...encounter.log],
  };
  const expired = expireEffectsAtTurnStart(advanced, round, nextCombatant.id);
  return { ...expired, turn: { ...expired.turn, movementRemaining: effectiveSpeed(expired, nextCombatant.id) } };
}
