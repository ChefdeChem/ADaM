import type { Character } from "../domain/character";
import type { EncounterState } from "../domain/combat";

export function createEncounter(character: Character): EncounterState {
  return {
    round: 1,
    activeIndex: 0,
    combatants: [
      { id: character.id, name: character.name, side: "player", armorClass: character.armorClass, hitPoints: character.hitPoints, initiative: 16 },
      { id: "scout-1", name: "Ashen Scout", side: "enemy", armorClass: 13, hitPoints: { current: 18, maximum: 18 }, initiative: 12 },
      { id: "brute-1", name: "Ruined Guardian", side: "enemy", armorClass: 15, hitPoints: { current: 30, maximum: 30 }, initiative: 8 },
    ],
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
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30 },
    log: [`Turn passed to ${encounter.combatants[nextIndex].name}.`, ...encounter.log],
  };
}
