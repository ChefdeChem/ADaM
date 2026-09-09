import type { EncounterState } from "../domain/combat";
import { actionCatalog, validateAction } from "../engine/actions";
import { validateGrapple } from "../engine/grappling";
import { validateShove } from "../engine/shove";

export type SurinaTacticalActionId = "grapple" | "shove" | "help" | "ready" | "search";

export type SurinaTacticalAction = {
  id: SurinaTacticalActionId;
  label: string;
  status: string;
  tone: "setup" | "blocked";
  detail: string;
  cost: "Action";
};

const actionCopy: Record<SurinaTacticalActionId, { label: string; detail: string }> = {
  grapple: { label: "Grapple", detail: "Choose an adjacent enemy. Requires one free hand and sets its Speed to 0 on a failed save." },
  shove: { label: "Shove", detail: "Choose an adjacent enemy, then knock it Prone or push it 5 feet on a failed save." },
  help: { label: "Help", detail: "Distract an adjacent enemy, stabilize an adjacent ally, or assist an ally's matching skill check." },
  ready: { label: "Ready", detail: "Choose a visible target, held weapon, and supported trigger. Releasing the attack uses your Reaction." },
  search: { label: "Search", detail: "Choose Perception, Insight, Medicine, or Survival. The scenario or DM interprets the total." },
};

function coreAction(encounter: EncounterState, id: "attack" | "help" | "ready" | "search") {
  const action = actionCatalog.find((candidate) => candidate.id === id);
  if (!action) return { legal: false as const, reason: `${id} is not registered.` };
  return validateAction(action, encounter);
}

function targetedChoice(
  encounter: EncounterState,
  id: "grapple" | "shove",
  validateTarget: (encounter: EncounterState, targetId: string) => { legal: boolean; reason?: string },
): SurinaTacticalAction {
  const copy = actionCopy[id];
  const general = coreAction(encounter, "attack");
  if (!general.legal) return { id, ...copy, cost: "Action", tone: "blocked", status: general.reason ?? "Unavailable" };
  const enemies = encounter.combatants.filter((combatant) => combatant.side === "enemy" && combatant.hitPoints.current > 0);
  if (!enemies.length) return { id, ...copy, cost: "Action", tone: "blocked", status: "No living enemy target" };
  const validations = enemies.map((enemy) => validateTarget(encounter, enemy.id));
  const legalTargets = validations.filter((validation) => validation.legal).length;
  if (!legalTargets) return {
    id,
    ...copy,
    cost: "Action",
    tone: "blocked",
    status: validations.find((validation) => validation.reason)?.reason ?? "No legal target",
  };
  return { id, ...copy, cost: "Action", tone: "setup", status: `Choose ${legalTargets} legal target${legalTargets === 1 ? "" : "s"}` };
}

function guidedChoice(encounter: EncounterState, id: "help" | "ready" | "search"): SurinaTacticalAction {
  const copy = actionCopy[id];
  const validation = coreAction(encounter, id);
  return validation.legal
    ? { id, ...copy, cost: "Action", tone: "setup", status: "Start here" }
    : { id, ...copy, cost: "Action", tone: "blocked", status: validation.reason ?? "Unavailable" };
}

export function buildSurinaTacticalActions(encounter: EncounterState): SurinaTacticalAction[] {
  return [
    targetedChoice(encounter, "grapple", validateGrapple),
    targetedChoice(encounter, "shove", validateShove),
    guidedChoice(encounter, "help"),
    guidedChoice(encounter, "ready"),
    guidedChoice(encounter, "search"),
  ];
}
