import type { EncounterState } from "../domain/combat";
import { actionCatalog, consumeAction, validateAction } from "./actions";
import { resolveAbilityCheck } from "./ability-checks";
import { charmSocialInteractionAdvantage, targetRegardsSourceAsFriendly } from "./effects";

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
  const targetId = actionId === "influence" ? encounter.selectedTargetId : null;
  const charmAdvantage = Boolean(targetId && charmSocialInteractionAdvantage(encounter, actor.id, targetId));
  const friendly = Boolean(targetId && targetRegardsSourceAsFriendly(encounter, actor.id, targetId));
  const result = resolveAbilityCheck(consumeAction(action, encounter), actor.id, skill, { random, situationalMode: charmAdvantage ? "advantage" : "normal" });
  if (!result) return denied("This character cannot make the selected check.");
  const charmCopy = charmAdvantage ? ` The target is Charmed by ${actor.name}, regards the caster as friendly, and grants Advantage on this social check.` : friendly ? " The target currently regards the caster as friendly." : "";
  const summary = `${result.summary}${charmCopy} The scenario or DM determines what is discovered or how the creature responds; a roll does not automatically change its behavior.`;
  return { legal: true as const, roll: result.roll, summary, encounter: { ...result.encounter, log: [summary, ...result.encounter.log] } };
}
