import type { Character } from "../domain/character";
import type { CombatAction, EncounterState, ExperienceMode } from "../domain/combat";
import type { RulesetId } from "../rulesets";
import { validateAttackChoice } from "./combat-options";
import { effectiveSpeed, hasBonusActionDash } from "./effects";
import { featureCombatActions } from "./feature-actions";
import { spendNamedResource, validateNamedResource } from "./resources";
import { analyzeTarget } from "./targeting";

const both: RulesetId[] = ["dnd-2014", "dnd-2024"];

export const actionCatalog: CombatAction[] = [
  { id: "attack", name: "Attack", cost: "action", description: "Choose a weapon or attack from the character sheet, then resolve its specific range and modifiers.", rulesets: both },
  { id: "magic", name: "Magic", cost: "action", description: "Cast a spell, use a magic item, or activate a magical feature that uses the Magic action.", rulesets: ["dnd-2024"] },
  { id: "cast-spell", name: "Cast a Spell", cost: "action", description: "Cast a spell with a casting time of one action.", rulesets: ["dnd-2014"] },
  { id: "dash", name: "Dash", cost: "action", description: "Gain extra movement equal to your Speed for this turn.", rulesets: both },
  { id: "disengage", name: "Disengage", cost: "action", description: "Your movement does not provoke opportunity attacks this turn.", rulesets: both },
  { id: "dodge", name: "Dodge", cost: "action", description: "Focus on defense until the start of your next turn.", rulesets: both },
  { id: "help", name: "Help", cost: "action", description: "Assist the selected creature with a task or attack while within 5 feet.", rulesets: both, targeting: { mode: "single", rangeFeet: 5, requiresLineOfSight: true } },
  { id: "hide", name: "Hide", cost: "action", description: "Attempt to become hidden when the environment permits it.", rulesets: both },
  { id: "ready", name: "Ready", cost: "action", description: "Prepare a response to a perceivable trigger; a readied spell may require concentration.", rulesets: both },
  { id: "search", name: "Search", cost: "action", description: "Devote attention to finding something concealed.", rulesets: both },
  { id: "utilize", name: "Utilize", cost: "action", description: "Use a nonmagical object that requires an action.", rulesets: ["dnd-2024"] },
  { id: "use-object", name: "Use an Object", cost: "action", description: "Interact with an object when doing so requires an action.", rulesets: ["dnd-2014"] },
  { id: "study", name: "Study", cost: "action", description: "Recall or analyze information using an Intelligence check.", rulesets: ["dnd-2024"] },
  { id: "influence", name: "Influence", cost: "action", description: "Attempt to influence a selected creature you can communicate with within 30 feet.", rulesets: ["dnd-2024"], targeting: { mode: "single", rangeFeet: 30, requiresLineOfSight: true } },
  { id: "quickened-spell", name: "Quickened Spell", cost: "bonus-action", description: "Spend 2 Sorcery Points to change an eligible spell's casting time to a Bonus Action.", rulesets: both, resourceCost: { resourceName: "Sorcery Points", amount: 2 } },
  { id: "expeditious-retreat-dash", name: "Expeditious Retreat Dash", cost: "bonus-action", description: "Dash using the recurring permission granted by Expeditious Retreat.", rulesets: ["dnd-2014"] },
  { id: "move", name: "Move 5 ft.", cost: "movement", description: "Move one grid space, subject to terrain and opportunity attacks.", rulesets: both },
  { id: "end-turn", name: "End Turn", cost: "free", description: "End your current turn and advance initiative.", rulesets: both },
];

export type ActionValidation = { legal: boolean; reason?: string };

export function validateAction(action: CombatAction, encounter: EncounterState, character?: Character): ActionValidation {
  const active = encounter.combatants[encounter.activeIndex];
  if (encounter.pendingResponse) return { legal: false, reason: "Resolve the pending player response first." };
  if (active?.side !== "player") return { legal: false, reason: "ADaM controls and advances enemy turns automatically." };
  if (active.hitPoints.current <= 0 && action.id !== "end-turn") return { legal: false, reason: "An unconscious character cannot take actions." };
  if (action.cost === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (action.cost === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  if (action.cost === "reaction" && !encounter.turn.reaction) return { legal: false, reason: "Your Reaction is unavailable." };
  if (action.cost === "movement" && encounter.turn.movementRemaining < 5) return { legal: false, reason: "You do not have enough movement remaining." };
  if (action.id === "expeditious-retreat-dash" && !hasBonusActionDash(encounter, active.id)) return { legal: false, reason: "Expeditious Retreat is not active." };
  if (action.resourceCost && active) {
    const resource = validateNamedResource(encounter, active.id, action.resourceCost.resourceName, action.resourceCost.amount);
    if (!resource.legal) return resource;
  }
  if (action.id === "attack" && character?.attacks?.length) {
    if (!encounter.selectedTargetId) return { legal: false, reason: "Select a target on the tactical map first." };
    if (!character.attacks.some((attack) => validateAttackChoice(encounter, attack).legal)) {
      return { legal: false, reason: "None of this character's attacks can legally reach the selected target." };
    }
  }
  if (action.targeting?.mode === "area") return { legal: false, reason: "This area effect needs the upcoming multi-target map selector." };
  if (action.targeting?.mode === "single") {
    if (!encounter.selectedTargetId) return { legal: false, reason: "Select a target on the tactical map first." };
    const target = analyzeTarget(encounter, encounter.selectedTargetId);
    if (!target) return { legal: false, reason: "The selected target is no longer available." };
    if (action.targeting.requiresLineOfSight && !target.lineOfSight) return { legal: false, reason: `${target.target.name} is outside your line of sight.` };
    if (target.distanceFeet > action.targeting.rangeFeet) return { legal: false, reason: `${target.target.name} is ${target.distanceFeet} feet away; ${action.name} currently reaches ${action.targeting.rangeFeet} feet.` };
  }
  return { legal: true };
}

export function availableActions(character: Character, ruleset: RulesetId): CombatAction[] {
  const allowedNames = new Set(character.actions?.map((item) => item.toLowerCase()) ?? []);
  const coreActions = actionCatalog.filter((action) => action.rulesets.includes(ruleset) && (
    action.cost === "free" || action.cost === "movement" || !character.actions?.length || allowedNames.has(action.name.toLowerCase())
  ));
  return [...coreActions, ...featureCombatActions(character)];
}

export function visibleActionsForMode(character: Character, ruleset: RulesetId, mode: ExperienceMode, encounter: EncounterState): CombatAction[] {
  const active = encounter.combatants[encounter.activeIndex];
  const expeditiousRetreatAction = actionCatalog.find((action) => action.id === "expeditious-retreat-dash");
  const dynamicActions = expeditiousRetreatAction && active && hasBonusActionDash(encounter, active.id) ? [expeditiousRetreatAction] : [];
  const candidates = mode === "beginner"
    ? [...availableActions(character, ruleset), ...dynamicActions]
    : [...actionCatalog.filter((action) => action.rulesets.includes(ruleset)), ...featureCombatActions(character)];
  if (mode !== "beginner") return candidates;

  return candidates.filter((action) => {
    if (validateAction(action, encounter, character).legal) return true;
    const active = encounter.combatants[encounter.activeIndex];
    return action.id === "attack"
      && Boolean(character.attacks?.length)
      && active?.side === "player"
      && encounter.turn.action;
  });
}

export function findActionFromText(text: string, ruleset: RulesetId, character?: Character): CombatAction | undefined {
  const normalized = text.toLowerCase();
  const candidates = character
    ? [...actionCatalog.filter((action) => action.rulesets.includes(ruleset)), ...featureCombatActions(character)]
    : actionCatalog.filter((action) => action.rulesets.includes(ruleset));
  return candidates.find((action) =>
    normalized.includes(action.name.toLowerCase()) || normalized.startsWith(action.id.replaceAll("-", " "))
  );
}

export function consumeAction(action: CombatAction, encounter: EncounterState): EncounterState {
  const turn = { ...encounter.turn };
  if (action.cost === "action") turn.action = false;
  if (action.cost === "bonus-action") turn.bonusAction = false;
  if (action.cost === "reaction") turn.reaction = false;
  if (action.cost === "movement") turn.movementRemaining = Math.max(0, turn.movementRemaining - 5);
  const active = encounter.combatants[encounter.activeIndex];
  if (action.id === "dash" && active) turn.movementRemaining += effectiveSpeed(encounter, active.id);
  if (action.id === "expeditious-retreat-dash" && active) turn.movementRemaining += effectiveSpeed(encounter, active.id);
  if (action.id === "disengage") turn.disengaged = true;
  const spent = action.resourceCost && active
    ? spendNamedResource(encounter, active.id, action.resourceCost.resourceName, action.resourceCost.amount)
    : encounter;
  return { ...spent, turn, log: [`${active?.name ?? "Combatant"}: ${action.name}.`, ...spent.log] };
}
