import type { Character } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import type { Scenario } from "../scenarios/types";

export function createEncounter(character: Character, scenario: Scenario): EncounterState {
  const enemies = [
    { id: "scout-1", name: "Ashen Scout", side: "enemy" as const, armorClass: 13, hitPoints: { current: 18, maximum: 18 }, initiative: 12, position: { x: 9, y: 2 } },
    { id: "brute-1", name: "Ruined Guardian", side: "enemy" as const, armorClass: 15, hitPoints: { current: 30, maximum: 30 }, initiative: 8, position: { x: 9, y: 5 } },
    { id: "skirmisher-1", name: "Cinder Skirmisher", side: "enemy" as const, armorClass: 14, hitPoints: { current: 22, maximum: 22 }, initiative: 6, position: { x: 10, y: 3 } },
  ];
  const enemyCount = scenario.difficulty === "easy" ? 1 : scenario.difficulty === "hard" ? 3 : 2;
  return {
    round: 1,
    activeIndex: 0,
    selectedTargetId: null,
    combatants: [
      { id: character.id, name: character.name, side: "player", armorClass: character.armorClass, hitPoints: character.hitPoints, initiative: 16, position: { x: 1, y: 6 } },
      ...enemies.slice(0, enemyCount),
    ],
    map: scenario.grid,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30 },
    log: ["Encounter started. The collapsed gate is thirty feet ahead."],
  };
}

export function endTurn(encounter: EncounterState): EncounterState {
  const nextIndex = (encounter.activeIndex + 1) % encounter.combatants.length;
  const round = nextIndex === 0 ? encounter.round + 1 : encounter.round;
  return {
    ...encounter,
    round,
    activeIndex: nextIndex,
    selectedTargetId: null,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30 },
    log: [`Turn passed to ${encounter.combatants[nextIndex].name}.`, ...encounter.log],
  };
}
