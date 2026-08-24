import type { Character } from "../domain/character";
import type { CombatAction, EncounterState } from "../domain/combat";
import type { RulesetId } from "../rulesets";

const both: RulesetId[] = ["dnd-2014", "dnd-2024"];

export const actionCatalog: CombatAction[] = [
  { id: "attack", name: "Attack", cost: "action", description: "Make an attack with an equipped weapon or unarmed strike.", rulesets: both, requiresTarget: true },
  { id: "magic", name: "Magic", cost: "action", description: "Cast a spell, use a magic item, or activate a magical feature that uses the Magic action.", rulesets: ["dnd-2024"] },
  { id: "cast-spell", name: "Cast a Spell", cost: "action", description: "Cast a spell with a casting time of one action.", rulesets: ["dnd-2014"] },
  { id: "dash", name: "Dash", cost: "action", description: "Gain extra movement equal to your Speed for this turn.", rulesets: both },
  { id: "disengage", name: "Disengage", cost: "action", description: "Your movement does not provoke opportunity attacks this turn.", rulesets: both },
  { id: "dodge", name: "Dodge", cost: "action", description: "Focus on defense until the start of your next turn.", rulesets: both },
  { id: "help", name: "Help", cost: "action", description: "Assist another creature with a task or attack.", rulesets: both, requiresTarget: true },
  { id: "hide", name: "Hide", cost: "action", description: "Attempt to become hidden when the environment permits it.", rulesets: both },
  { id: "ready", name: "Ready", cost: "action", description: "Prepare a response to a perceivable trigger; a readied spell may require concentration.", rulesets: both },
  { id: "search", name: "Search", cost: "action", description: "Devote attention to finding something concealed.", rulesets: both },
  { id: "utilize", name: "Utilize", cost: "action", description: "Use a nonmagical object that requires an action.", rulesets: ["dnd-2024"] },
  { id: "use-object", name: "Use an Object", cost: "action", description: "Interact with an object when doing so requires an action.", rulesets: ["dnd-2014"] },
  { id: "study", name: "Study", cost: "action", description: "Recall or analyze information using an Intelligence check.", rulesets: ["dnd-2024"] },
  { id: "influence", name: "Influence", cost: "action", description: "Attempt to alter another creature's attitude or behavior.", rulesets: ["dnd-2024"], requiresTarget: true },
  { id: "quickened-spell", name: "Quickened Spell", cost: "bonus-action", description: "Spend Sorcery Points to change an eligible spell's casting time to a Bonus Action.", rulesets: both },
  { id: "move", name: "Move 5 ft.", cost: "movement", description: "Move one grid space, subject to terrain and opportunity attacks.", rulesets: both },
  { id: "end-turn", name: "End Turn", cost: "free", description: "End your current turn and advance initiative.", rulesets: both },
];

export type ActionValidation = { legal: boolean; reason?: string };

export function validateAction(action: CombatAction, encounter: EncounterState): ActionValidation {
  if (action.cost === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (action.cost === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  if (action.cost === "reaction" && !encounter.turn.reaction) return { legal: false, reason: "Your Reaction is unavailable." };
  if (action.cost === "movement" && encounter.turn.movementRemaining < 5) return { legal: false, reason: "You do not have enough movement remaining." };
  return { legal: true };
}

export function availableActions(character: Character, ruleset: RulesetId): CombatAction[] {
  const allowedNames = new Set(character.actions?.map((item) => item.toLowerCase()) ?? []);
  return actionCatalog.filter((action) => action.rulesets.includes(ruleset) && (
    action.cost === "free" || action.cost === "movement" || !character.actions?.length || allowedNames.has(action.name.toLowerCase())
  ));
}

export function findActionFromText(text: string, ruleset: RulesetId): CombatAction | undefined {
  const normalized = text.toLowerCase();
  return actionCatalog.filter((action) => action.rulesets.includes(ruleset)).find((action) =>
    normalized.includes(action.name.toLowerCase()) || normalized.startsWith(action.id.replaceAll("-", " "))
  );
}

export function consumeAction(action: CombatAction, encounter: EncounterState): EncounterState {
  const turn = { ...encounter.turn };
  if (action.cost === "action") turn.action = false;
  if (action.cost === "bonus-action") turn.bonusAction = false;
  if (action.cost === "reaction") turn.reaction = false;
  if (action.cost === "movement") turn.movementRemaining = Math.max(0, turn.movementRemaining - 5);
  return { ...encounter, turn, log: [`${encounter.combatants[encounter.activeIndex]?.name ?? "Combatant"}: ${action.name}.`, ...encounter.log] };
}
