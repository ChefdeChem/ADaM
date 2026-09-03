import type { CombatResource, EncounterState } from "../domain/combat";

export type ResourceCheck = { legal: true } | { legal: false; reason: string };
export type RestType = "short-rest" | "long-rest";

export type ResourceRecovery = {
  resourceId: string;
  resourceName: string;
  amount: number;
  current: number;
  maximum: number;
};

export type RestRecoveryResult =
  | { legal: true; encounter: EncounterState; recovered: ResourceRecovery[]; summary: string }
  | { legal: false; encounter: EncounterState; recovered: []; reason: string; summary: string };

function configuredRecovery(resource: CombatResource, restType: RestType): number | "all" | undefined {
  if (resource.recovery === "short-rest") return "all";
  if (resource.recovery === "long-rest") return restType === "long-rest" ? "all" : undefined;
  return restType === "short-rest" ? resource.shortRestRecovery : resource.longRestRecovery;
}

export function recoveryAmount(resource: CombatResource, restType: RestType): number {
  const configured = configuredRecovery(resource, restType);
  const missing = Math.max(0, resource.maximum - resource.current);
  if (configured === "all") return missing;
  if (configured === undefined) return 0;
  return Math.min(missing, Math.max(0, configured));
}

export function recoverRestResources(encounter: EncounterState, combatantId: string, restType: RestType): RestRecoveryResult {
  if (encounter.pendingResponse) {
    const reason = "Resolve the pending player response before recovering resources.";
    return { legal: false, encounter, recovered: [], reason, summary: reason };
  }
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant) {
    const reason = "Combatant not found for resource recovery.";
    return { legal: false, encounter, recovered: [], reason, summary: reason };
  }

  const recovered = combatant.resources.flatMap((resource) => {
    const amount = recoveryAmount(resource, restType);
    return amount > 0 ? [{ resourceId: resource.id, resourceName: resource.name, amount, current: resource.current + amount, maximum: resource.maximum }] : [];
  });
  const nextEncounter: EncounterState = {
    ...encounter,
    combatants: encounter.combatants.map((candidate) => candidate.id === combatantId
      ? {
          ...candidate,
          resources: candidate.resources.map((resource) => {
            const amount = recoveryAmount(resource, restType);
            return amount > 0 ? { ...resource, current: resource.current + amount } : resource;
          }),
        }
      : candidate),
  };
  const restName = restType === "short-rest" ? "Short Rest" : "Long Rest";
  const recoverySummary = recovered.length
    ? recovered.map((resource) => `${resource.resourceName} +${resource.amount}`).join(", ")
    : "no expended resources were eligible";
  const summary = `${combatant.name} completed ${restName} resource recovery: ${recoverySummary}.`;
  return {
    legal: true,
    recovered,
    summary,
    encounter: { ...nextEncounter, log: [summary, ...nextEncounter.log] },
  };
}

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
