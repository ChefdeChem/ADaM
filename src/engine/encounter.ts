import type { Character } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import type { Scenario } from "../scenarios/types";
import { enemyProfile } from "../rulesets/enemy-profiles";
import { rollD20, type D20Result } from "./dice";
import { effectiveSpeed, expireEffectsAtTurnStart } from "./effects";

const abilityModifier=(score:number)=>Math.floor((score-10)/2);

export function createEncounter(character: Character, scenario: Scenario): EncounterState {
  const enemyPositions = [{ x: 9, y: 2 }, { x: 9, y: 5 }, { x: 10, y: 3 }];
  const enemySeeds = scenario.enemyProfileIds.map((profileId, index) => ({ instanceId: `${profileId}-${index + 1}`, profileId, position: enemyPositions[index] ?? { x: 10, y: Math.min(6, index + 1) } }));
  const enemies = enemySeeds.map((seed) => {
    const profile = enemyProfile(seed.profileId);
    return {
      id: seed.instanceId,
      name: profile.name,
      side: "enemy" as const,
      baseArmorClass: profile.armorClass,
      baseSpeedFeet: profile.speedFeet,
      hitPoints: { current: profile.hitPoints, maximum: profile.hitPoints },
      temporaryHitPoints: 0,
      resources: [],
      initiative: 0,
      initiativeModifier: profile.initiativeModifier,
      initiativeRolled: false,
      position: seed.position,
      attacks: profile.attacks.map((attack) => ({ ...attack })),
      tacticId: profile.tacticId,
    };
  });
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
        initiative: 0,
        initiativeModifier: abilityModifier(character.abilities.dexterity),
        initiativeRolled: false,
        position: { x: 1, y: 6 },
        attacks: (character.attacks ?? []).map((attack) => ({ ...attack })),
      },
      ...enemies,
    ],
    effects: [],
    map: scenario.grid,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30 },
    log: ["Encounter started. The collapsed gate is thirty feet ahead."],
  };
}

export function rollPlayerAndEnemyInitiative(encounter: EncounterState, playerId: string, random = Math.random): {
  encounter: EncounterState;
  playerRoll: D20Result;
  enemyRolls: Array<{ combatantId: string; name: string; roll: D20Result }>;
} {
  const player = encounter.combatants.find((combatant) => combatant.id === playerId && combatant.side === "player");
  if (!player) throw new Error("Player combatant not found for initiative.");
  let playerResult = rollCombatantInitiative(encounter, playerId, random);
  const enemyRolls: Array<{ combatantId: string; name: string; roll: D20Result }> = [];
  for (const enemy of playerResult.encounter.combatants.filter((combatant) => combatant.side === "enemy" && !combatant.initiativeRolled)) {
    const result = rollCombatantInitiative(playerResult.encounter, enemy.id, random);
    enemyRolls.push({ combatantId: enemy.id, name: enemy.name, roll: result.roll });
    playerResult = { ...playerResult, encounter: result.encounter };
  }
  return { encounter: playerResult.encounter, playerRoll: playerResult.roll, enemyRolls };
}

export function rollCombatantInitiative(encounter:EncounterState,combatantId:string,random=Math.random):{encounter:EncounterState;roll:D20Result}{
  const combatant=encounter.combatants.find((candidate)=>candidate.id===combatantId);
  if(!combatant)throw new Error("Combatant not found for initiative.");
  const roll=rollD20({mode:"normal",modifier:combatant.initiativeModifier,random});
  const combatants=encounter.combatants.map((candidate)=>candidate.id===combatantId?{...candidate,initiative:roll.total,initiativeRolled:true}:candidate);
  const allRolled=combatants.every((candidate)=>candidate.initiativeRolled);
  const ordered=allRolled?[...combatants].sort((left,right)=>right.initiative-left.initiative):combatants;
  return{roll,encounter:{...encounter,combatants:ordered,activeIndex:0,log:[`${combatant.name} rolled ${roll.total} initiative (${roll.kept} ${roll.modifier>=0?"+":"−"} ${Math.abs(roll.modifier)}).`,...encounter.log]}};
}

export function endTurn(encounter: EncounterState): EncounterState {
  const livingCombatants = encounter.combatants.filter((combatant) => combatant.hitPoints.current > 0);
  if (livingCombatants.length === 0) return encounter;
  let nextIndex = encounter.activeIndex;
  for (let offset = 1; offset <= encounter.combatants.length; offset += 1) {
    const candidateIndex = (encounter.activeIndex + offset) % encounter.combatants.length;
    if (encounter.combatants[candidateIndex].hitPoints.current > 0) { nextIndex = candidateIndex; break; }
  }
  const round = nextIndex <= encounter.activeIndex ? encounter.round + 1 : encounter.round;
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
