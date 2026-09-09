import type { EncounterState } from "../domain/combat";
import { actionCatalog, validateAction } from "../engine/actions";
import { effectiveSpeed } from "../engine/effects";

export type SurinaUtilityActionId = "dash" | "disengage" | "hide" | "study" | "influence";

export type SurinaUtilityAction = {
  id: SurinaUtilityActionId;
  label: string;
  status: string;
  tone: "ready" | "setup" | "blocked";
  detail: string;
  cost: "Action";
};

const copy: Record<SurinaUtilityActionId, { label: string; detail: string }> = {
  dash: { label: "Dash", detail: "Add your Speed to this turn's remaining movement, then choose a destination on the map." },
  disengage: { label: "Disengage", detail: "Move for the rest of this turn without provoking opportunity attacks." },
  hide: { label: "Hide", detail: "Requires Total Cover from every enemy. Roll Stealth against DC 15 when the position qualifies." },
  study: { label: "Study", detail: "Choose an Intelligence skill, roll the check, and take the total to the scenario or DM." },
  influence: { label: "Influence", detail: "Choose a visible creature within 30 feet, then select the social skill that fits the approach." },
};

function registered(id: SurinaUtilityActionId) {
  return actionCatalog.find((action) => action.id === id)!;
}

function blocked(id: SurinaUtilityActionId, status: string): SurinaUtilityAction {
  return { id, ...copy[id], cost: "Action", tone: "blocked", status };
}

export function legalInfluenceTargetIds(encounter: EncounterState): string[] {
  const actor = encounter.combatants[encounter.activeIndex];
  if (!actor) return [];
  return encounter.combatants
    .filter((combatant) => combatant.id !== actor.id && combatant.hitPoints.current > 0)
    .filter((combatant) => validateAction(registered("influence"), { ...encounter, selectedTargetId: combatant.id }).legal)
    .map((combatant) => combatant.id);
}

export function buildSurinaUtilityActions(encounter: EncounterState): SurinaUtilityAction[] {
  const actor = encounter.combatants[encounter.activeIndex];
  const initiativeReady = encounter.combatants.every((combatant) => combatant.initiativeRolled);
  const beforeInitiative = (id: SurinaUtilityActionId) => blocked(id, "Roll initiative first");
  if (!initiativeReady) return (["dash", "disengage", "hide", "study", "influence"] as const).map(beforeInitiative);
  if (!encounter.combatants.some((combatant) => combatant.side === "enemy" && combatant.hitPoints.current > 0)) {
    return (["dash", "disengage", "hide", "study", "influence"] as const).map((id) => blocked(id, "Encounter complete"));
  }

  const actions: SurinaUtilityAction[] = [];
  for (const id of ["dash", "disengage", "hide", "study"] as const) {
    const validation = validateAction(registered(id), encounter);
    if (!validation.legal) {
      actions.push(blocked(id, validation.reason ?? "Unavailable"));
      continue;
    }
    const status = id === "dash"
      ? `Gain ${effectiveSpeed(encounter, actor.id)} ft. movement`
      : id === "disengage"
        ? encounter.turn.disengaged ? "Already active this turn" : "Protect movement this turn"
        : id === "hide"
          ? "Roll Stealth now"
          : "Choose 1 of 5 skills";
    actions.push({ id, ...copy[id], cost: "Action", tone: id === "study" ? "setup" : "ready", status });
  }

  const selectedValidation = validateAction(registered("influence"), encounter);
  if (selectedValidation.legal) {
    actions.push({ id: "influence", ...copy.influence, cost: "Action", tone: "setup", status: "Choose a social skill" });
  } else {
    const targets = legalInfluenceTargetIds(encounter);
    if (targets.length) actions.push({ id: "influence", ...copy.influence, cost: "Action", tone: "setup", status: `Choose ${targets.length} legal target${targets.length === 1 ? "" : "s"}` });
    else actions.push(blocked("influence", selectedValidation.reason ?? "No legal target"));
  }
  return actions;
}
