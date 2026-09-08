export type TurnGuidancePhase =
  | "initiative"
  | "enemy"
  | "response"
  | "choose-action"
  | "choose-option"
  | "choose-target"
  | "resolve-roll"
  | "finish-turn"
  | "complete";

export type TurnGuidanceFocus = "initiative" | "actions" | "map" | "response" | "outcome";

export interface TurnGuidanceInput {
  initiativeReady: boolean;
  outcome: "active" | "victory" | "defeat" | "stabilized";
  activeSide: "player" | "enemy";
  hasRequiredResponse: boolean;
  choiceMode: "attack" | "spell" | null;
  attackPhase: "target" | "attack-roll" | "damage-roll" | null;
  spellPhase: "resource" | "option" | "target" | "point" | "attack-roll" | "damage-roll" | null;
  breathActive: boolean;
  healingPhase: "target" | "amount" | null;
  interactionActive: boolean;
  skillActive: boolean;
  actionAvailable: boolean;
  bonusActionAvailable: boolean;
  movementRemaining: number;
}

export interface TurnGuidance {
  phase: TurnGuidancePhase;
  step: 1 | 2 | 3 | 4;
  title: string;
  detail: string;
  focus: TurnGuidanceFocus;
  primaryLabel: string | null;
  secondaryLabel?: string;
}

export function buildTurnGuidance(input: TurnGuidanceInput): TurnGuidance {
  if (!input.initiativeReady) {
    return {
      phase: "initiative",
      step: 1,
      title: "Roll initiative to enter combat",
      detail: "You roll for Surina. ADaM rolls for the enemies, orders the turns, and shows who acts first.",
      focus: "initiative",
      primaryLabel: "Roll Surina's initiative",
    };
  }

  if (input.outcome !== "active") {
    return {
      phase: "complete",
      step: 4,
      title: input.outcome === "victory" ? "Encounter complete" : "Surina's encounter has ended",
      detail: input.outcome === "victory"
        ? "Review the result, then use the recovery controls before starting another encounter."
        : "Review the final state and combat log before rebuilding the encounter.",
      focus: "outcome",
      primaryLabel: "Review encounter result",
    };
  }

  if (input.hasRequiredResponse) {
    return {
      phase: "response",
      step: 3,
      title: "A response is required",
      detail: "Resolve the highlighted saving throw, reaction, concentration check, or death save before play continues.",
      focus: "response",
      primaryLabel: "Go to required response",
    };
  }

  if (input.activeSide === "enemy") {
    return {
      phase: "enemy",
      step: 3,
      title: "ADaM is resolving the enemy turn",
      detail: "Watch for a saving throw or reaction prompt. Surina's next turn will begin automatically.",
      focus: "response",
      primaryLabel: null,
    };
  }

  if (input.attackPhase === "target" || input.spellPhase === "target" || input.spellPhase === "point") {
    return {
      phase: "choose-target",
      step: 2,
      title: input.spellPhase === "point" ? "Choose a location on the map" : "Choose a highlighted target",
      detail: "Gold highlights show legal choices after range, sight, cover, and target rules are checked.",
      focus: "map",
      primaryLabel: "Go to tactical map",
    };
  }

  if (input.attackPhase === "attack-roll" || input.attackPhase === "damage-roll" || input.spellPhase === "attack-roll" || input.spellPhase === "damage-roll") {
    return {
      phase: "resolve-roll",
      step: 3,
      title: input.attackPhase === "damage-roll" || input.spellPhase === "damage-roll" ? "Roll damage" : "Roll to see if the attack hits",
      detail: "Use the highlighted roll prompt. ADaM applies the modifier, defenses, damage, and resulting effects.",
      focus: "response",
      primaryLabel: "Go to roll prompt",
    };
  }

  if (input.breathActive || input.healingPhase || input.interactionActive || input.skillActive || input.spellPhase === "resource" || input.spellPhase === "option") {
    return {
      phase: "choose-option",
      step: 2,
      title: input.breathActive ? "Aim Surina's Breath Weapon" : input.healingPhase ? "Complete Lay on Hands" : "Complete the current choice",
      detail: input.breathActive
        ? "Choose the area shape and aim, review every affected creature, then roll damage."
        : input.healingPhase === "target"
          ? "Choose a creature within touch range before deciding how many points to spend."
          : "Use the open choice panel to finish this action before selecting another one.",
      focus: "actions",
      primaryLabel: "Go to current choice",
    };
  }

  if (input.choiceMode) {
    return {
      phase: "choose-option",
      step: 2,
      title: input.choiceMode === "attack" ? "Choose how Surina attacks" : "Choose a spell",
      detail: input.choiceMode === "attack"
        ? "Select a weapon or choose Damage, Grapple, or Shove under Unarmed Strike."
        : "Choose a spell, then ADaM will guide its resource, target, and roll steps.",
      focus: "actions",
      primaryLabel: input.choiceMode === "attack" ? "Review attack options" : "Review spell options",
    };
  }

  if (!input.actionAvailable) {
    return {
      phase: "finish-turn",
      step: 4,
      title: input.movementRemaining > 0 ? "Move again or end Surina's turn" : "End Surina's turn",
      detail: input.movementRemaining > 0
        ? `${input.movementRemaining} feet of movement remains. Movement can be split before and after the Action.`
        : input.bonusActionAvailable
          ? "No Action or movement remains. Review any available Bonus Action, or finish the turn."
          : "Surina's choices for this turn are complete. Advance initiative when you are ready.",
      focus: "actions",
      primaryLabel: "End Surina's turn",
      secondaryLabel: input.movementRemaining > 0 ? "Use remaining movement" : undefined,
    };
  }

  return {
    phase: "choose-action",
    step: 2,
    title: "Choose Surina's next move",
    detail: "Start with an Action, reposition on the map, or combine both. ADaM will open only the decisions needed to resolve your choice.",
    focus: "actions",
    primaryLabel: "Choose an action",
    secondaryLabel: input.movementRemaining > 0 ? `Move up to ${input.movementRemaining} feet` : undefined,
  };
}
