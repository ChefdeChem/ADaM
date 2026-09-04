import type { EncounterState } from "../domain/combat";
import { rollD20, type D20Result, type RollMode } from "./dice";
import { abilityCheckRollMode } from "./effects";

export function abilityCheckModifier(encounter: EncounterState, combatantId: string, skill: string): number {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  return combatant?.skillModifiers[skill.toLowerCase()] ?? 0;
}

export function rollAbilityCheck(
  encounter: EncounterState,
  combatantId: string,
  skill: string,
  random = Math.random,
  situationalMode: RollMode = "normal",
): { roll: D20Result; proficient: boolean } | null {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant) return null;
  return {
    roll: rollD20({
      mode: abilityCheckRollMode(encounter, combatantId, skill, situationalMode),
      modifier: abilityCheckModifier(encounter, combatantId, skill),
      random,
    }),
    proficient: combatant.skillProficiencies.includes(skill.toLowerCase()),
  };
}
