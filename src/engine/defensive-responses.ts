import type { EncounterState, MovementContinuation } from "../domain/combat";
import { endConcentration } from "./effects";

export function queueConcentrationCheck(encounter: EncounterState, targetCombatantId: string, damageTaken: number, continuation?: MovementContinuation): EncounterState {
  if (damageTaken <= 0) return { ...encounter, pendingResponse: null };
  const target = encounter.combatants.find((combatant) => combatant.id === targetCombatantId);
  const concentrating = encounter.effects.some((effect) => effect.concentration && effect.sourceCombatantId === targetCombatantId);
  if (!target || !concentrating) return { ...encounter, pendingResponse: null };
  if (target.hitPoints.current <= 0) return { ...endConcentration(encounter, targetCombatantId, `${target.name} became unconscious`), pendingResponse: null };
  return {
    ...encounter,
    pendingResponse: {
      type: "concentration-check",
      targetCombatantId,
      damageTaken,
      dc: Math.max(10, Math.floor(damageTaken / 2)),
      continuation,
    },
  };
}
