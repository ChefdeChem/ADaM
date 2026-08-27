import type { EncounterState } from "../domain/combat";

export type ResourceCheck = { legal: true } | { legal: false; reason: string };

export function validateNamedResource(encounter: EncounterState, combatantId: string, resourceName: string, amount: number): ResourceCheck {
  const resource = encounter.combatants.find((combatant) => combatant.id === combatantId)?.resources
    .find((item) => item.name.toLowerCase() === resourceName.toLowerCase());
  if (!resource) return { legal: false, reason: `${resourceName} is not available on this character.` };
  if (resource.current < amount) return { legal: false, reason: `${resourceName} requires ${amount}; only ${resource.current} remains.` };
  return { legal: true };
}

export function spendNamedResource(encounter: EncounterState, combatantId: string, resourceName: string, amount: number): EncounterState {
  const validation = validateNamedResource(encounter, combatantId, resourceName, amount);
  if (!validation.legal) return encounter;
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
      ? {
          ...combatant,
          resources: combatant.resources.map((resource) => resource.name.toLowerCase() === resourceName.toLowerCase()
            ? { ...resource, current: resource.current - amount }
            : resource),
        }
      : combatant),
  };
}

export function validateSpellSlot(encounter: EncounterState, combatantId: string, level: number): ResourceCheck {
  if (level === 0) return { legal: true };
  const slot = encounter.combatants.find((combatant) => combatant.id === combatantId)?.resources
    .find((resource) => resource.kind === "spell-slot" && resource.level === level);
  if (!slot) return { legal: false, reason: `No level ${level} spell-slot pool is available.` };
  if (slot.current < 1) return { legal: false, reason: `No level ${level} spell slots remain.` };
  return { legal: true };
}

export function spendSpellSlot(encounter: EncounterState, combatantId: string, level: number): EncounterState {
  if (level === 0 || !validateSpellSlot(encounter, combatantId, level).legal) return encounter;
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
      ? {
          ...combatant,
          resources: combatant.resources.map((resource) => resource.kind === "spell-slot" && resource.level === level
            ? { ...resource, current: resource.current - 1 }
            : resource),
        }
      : combatant),
  };
}
