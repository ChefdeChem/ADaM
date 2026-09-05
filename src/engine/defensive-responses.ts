import type { EncounterState, MovementContinuation } from "../domain/combat";
import { endConcentration, canMaintainConcentration } from "./effects";

export function queueConcentrationCheck(encounter: EncounterState, targetCombatantId: string, damageTaken: number, continuation?: MovementContinuation): EncounterState {
  if (encounter.pendingResponse) return encounter;
  if (damageTaken <= 0) return { ...encounter, pendingResponse: null };
  const target = encounter.combatants.find((combatant) => combatant.id === targetCombatantId);
  const concentrating = encounter.effects.some((effect) => effect.concentration && effect.sourceCombatantId === targetCombatantId);
  if (!target || !concentrating) return { ...encounter, pendingResponse: null };
  if (!canMaintainConcentration(encounter, targetCombatantId)) return { ...endConcentration(encounter, targetCombatantId, `${target.name} can no longer concentrate`), pendingResponse: null };
  return {
    ...encounter,
    pendingResponse: {
      type: "concentration-check",
      targetCombatantId,
      damageTaken,
      dc: Math.min(target.rulesetId === "dnd-2024" ? 30 : Infinity, Math.max(10, Math.floor(damageTaken / 2))),
      continuation,
    },
  };
}
