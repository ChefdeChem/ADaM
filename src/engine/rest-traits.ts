import type { EncounterState } from "../domain/combat";

export type RestAlternative = { sleepRequired: boolean; meditationHours?: number; semiconscious?: boolean };

export function restAlternative(encounter: EncounterState, combatantId: string): RestAlternative {
  const trait = encounter.combatants.find((combatant) => combatant.id === combatantId)?.restAlternative;
  return trait ? { ...trait } : { sleepRequired: true };
}
