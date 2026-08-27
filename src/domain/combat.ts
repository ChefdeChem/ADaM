import type { RulesetId } from "../rulesets";
import type { ScenarioGrid } from "../scenarios/types";

export type ExperienceMode = "beginner" | "training" | "advanced";
export type ActionCost = "action" | "bonus-action" | "reaction" | "movement" | "free";

export type AreaShape = "cone" | "cube" | "cylinder" | "line" | "sphere" | "emanation";
export type AffectedCreatures = "all-creatures" | "hostile-creatures" | "chosen-creatures";
export type TargetResolution = "attack-per-target" | "save-per-target" | "shared-roll" | "automatic";

export type TargetingProfile =
  | { mode: "single"; rangeFeet: number; requiresLineOfSight: boolean }
  | {
      mode: "area";
      origin: "self" | "selected-point";
      rangeFeet: number;
      requiresLineOfSight: boolean;
      shape: AreaShape;
      sizeFeet: number;
      affects: AffectedCreatures;
      resolution: TargetResolution;
    };

export type CombatAction = {
  id: string;
  name: string;
  cost: ActionCost;
  description: string;
  rulesets: RulesetId[];
  targeting?: TargetingProfile;
  resourceCost?: { resourceName: string; amount: number };
};

export type TurnResources = {
  action: boolean;
  bonusAction: boolean;
  reaction: boolean;
  movementRemaining: number;
};

export type CombatResource = {
  id: string;
  name: string;
  kind: "generic" | "spell-slot";
  level?: number;
  current: number;
  maximum: number;
};

export type EffectModifiers = {
  armorClass?: number;
  attackRolls?: number;
  savingThrows?: number;
  speedFeet?: number;
  incomingAttacks?: "disadvantage";
};

export type ActiveEffect = {
  id: string;
  name: string;
  description: string;
  sourceCombatantId: string;
  targetCombatantId: string;
  concentration: boolean;
  modifiers: EffectModifiers;
  expiresAt?: { round: number; combatantId: string; phase: "start" };
  temporaryHitPointsGranted?: number;
};

export type Combatant = {
  id: string;
  name: string;
  side: "player" | "enemy";
  baseArmorClass: number;
  baseSpeedFeet: number;
  hitPoints: { current: number; maximum: number };
  temporaryHitPoints: number;
  temporaryHitPointsSourceEffectId?: string;
  resources: CombatResource[];
  initiative: number;
  initiativeModifier: number;
  initiativeRolled: boolean;
  position: { x: number; y: number };
};

export type EncounterState = {
  round: number;
  activeIndex: number;
  selectedTargetId: string | null;
  combatants: Combatant[];
  effects: ActiveEffect[];
  map: ScenarioGrid;
  turn: TurnResources;
  log: string[];
};
