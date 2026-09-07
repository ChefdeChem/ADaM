import type { EncounterState } from "../domain/combat";
import { actionCatalog, consumeAction, validateAction } from "./actions";
import { resolveAbilityCheck } from "./ability-checks";

export const skillActionChoices: Record<string, string[]> = {
  search: ["perception", "insight", "medicine", "survival"],
  study: ["arcana", "history", "investigation", "nature", "religion"],
  influence: ["persuasion", "deception", "intimidation", "animal handling"],
};
/** Rolls and action costs are executable; narrative results require scenario or DM adjudication. */
export function executeSkillAction(encounter: EncounterState, actionId: string, skill: string, random = Math.random) {
  const action = actionCatalog.find(a => a.id === actionId);
  const denied = (reason: string) => ({ legal: false as const, reason, encounter });
  if (!action || !skillActionChoices[actionId]?.includes(skill)) return denied("Choose a skill appropriate to this action.");
  const valid = validateAction(action, encounter);
  if (!valid.legal) return denied(valid.reason!);
  const actor = encounter.combatants[encounter.activeIndex];
  const result = resolveAbilityCheck(consumeAction(action, encounter), actor.id, skill, { random });
  if (!result) return denied("This character cannot make the selected check.");
  const summary = `${result.summary} The scenario or DM determines what is discovered or how the creature responds; a roll does not automatically change its behavior.`;
  return { legal: true as const, roll: result.roll, summary, encounter: { ...result.encounter, log: [summary, ...result.encounter.log] } };
}
