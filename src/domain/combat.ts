import type { RulesetId } from "../rulesets";

export type ExperienceMode = "beginner" | "training" | "advanced";
export type ActionCost = "action" | "bonus-action" | "reaction" | "movement" | "free";

export type CombatAction = {
  id: string;
  name: string;
  cost: ActionCost;
  description: string;
  rulesets: RulesetId[];
  requiresTarget?: boolean;
};

export type TurnResources = {
  action: boolean;
  bonusAction: boolean;
  reaction: boolean;
  movementRemaining: number;
};

export type Combatant = {
  id: string;
  name: string;
  side: "player" | "enemy";
  armorClass: number;
  hitPoints: { current: number; maximum: number };
  initiative: number;
};

export type EncounterState = {
  round: number;
  activeIndex: number;
  combatants: Combatant[];
  turn: TurnResources;
  log: string[];
};
