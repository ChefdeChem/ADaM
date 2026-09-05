import type { RulesetId } from "../rulesets";
import type { ScenarioGrid } from "../scenarios/types";
import type { AbilityName, CharacterAttack, CharacterSpell, CharacterTriggeredFeature } from "./character";

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
  disengaged: boolean;
  usedFeatureIds: string[];
};

export type MovementContinuation = {
  combatantId: string;
  x: number;
  y: number;
  cost: number;
  destination?: { x: number; y: number };
};

export type CombatResource = {
  id: string;
  name: string;
  kind: "generic" | "spell-slot";
  level?: number;
  current: number;
  maximum: number;
  recovery: "short-rest" | "long-rest" | "special";
  shortRestRecovery?: number | "all";
  longRestRecovery?: number | "all";
};

export type CombatInventoryItem = {
  id: string;
  name: string;
  current: number;
  maximum: number;
  attackIds: string[];
  expendOnAttackIds: string[];
  spellcastingFocusFor?: string;
  lightSource?: {
    mode: "off" | "bright" | "hooded";
    brightLightFeet: number;
    dimLightFeet: number;
    hoodedDimLightFeet: number;
    fuelMinutesRemaining: number;
    adjustmentCost: "action" | "bonus-action";
  };
  tool?: {
    purpose: string;
    proficient: boolean;
    allowedAbilities: AbilityName[];
  };
};

export type ReactionOption = {
  id: string;
  name: string;
  kind: "armor-class";
  armorClassBonus: number;
  spellLevel?: number;
  description: string;
};

export type EnemySaveAbility = {
  id: string;
  name: string;
  kind: "saving-throw";
  saveAbility: AbilityName;
  saveDc: number;
  damage: string;
  damageOnSuccess: "half" | "none";
  rangeFeet: number;
  requiresLineOfSight: boolean;
  uses?: number;
  description: string;
};

export type PendingPlayerResponse =
  | {
      type: "saving-throw";
      sourceCombatantId: string;
      targetCombatantId: string;
      ability: EnemySaveAbility;
    }
  | {
      type: "attack-reaction";
      sourceCombatantId: string;
      targetCombatantId: string;
      attack: CharacterAttack;
      attackTotal: number;
      attackNatural: number;
      critical: boolean;
      targetArmorClass: number;
      availableReactionIds: string[];
      continuation?: MovementContinuation;
    }
  | {
      type: "opportunity-attack";
      sourceCombatantId: string;
      targetCombatantId: string;
      phase: "choice" | "attack-roll" | "damage-roll";
      availableAttackIds: string[];
      attackId?: string;
      critical?: boolean;
      continuation: MovementContinuation;
    }
  | {
      type: "concentration-check";
      targetCombatantId: string;
      damageTaken: number;
      dc: number;
      continuation?: MovementContinuation;
    }
  | {
      type: "zero-hit-point-replacement";
      targetCombatantId: string;
      featureId: string;
      damageTaken: number;
      continuation?: MovementContinuation;
    }
  | {
      type: "damage-reduction-reaction";
      targetCombatantId: string;
      featureId: string;
      damageTaken: number;
      damageType?: string;
      sourceCombatantId?: string;
      critical: boolean;
      continuation?: MovementContinuation;
    }
  | {
      type: "weapon-mastery-choice";
      mastery: "slow" | "topple";
      sourceCombatantId: string;
      targetCombatantId: string;
      attackName: string;
      expiresAt?: { round: number; combatantId: string; phase: "start" };
      saveDc?: number;
      continuation?: MovementContinuation;
    }
  | {
      type: "post-hit-spell-choice";
      sourceCombatantId: string;
      targetCombatantId: string;
      spellId: string;
      attackName: string;
      critical: boolean;
    };

export type EffectModifiers = {
  armorClass?: number;
  attackRolls?: number;
  savingThrows?: number;
  speedFeet?: number;
  incomingAttacks?: "disadvantage";
  outgoingAttacks?: "advantage" | "disadvantage";
  damageResistances?: string[];
  healingPrevented?: boolean;
  bonusActionDash?: boolean;
  conditionImmunities?: string[];
  preventsHarmingSource?: boolean;
  abilityCheckAdvantages?: string[];
  savingThrowAdvantages?: AbilityName[];
  weaponDamageBonus?: number;
  preventsSpellcasting?: boolean;
  endsOnIncapacitated?: boolean;
  size?: "large";
  rageExtension?: boolean;
};

export type ActiveEffect = {
  id: string;
  name: string;
  description: string;
  sourceCombatantId: string;
  targetCombatantId: string;
  concentration: boolean;
  modifiers: EffectModifiers;
  expiresAt?: { round: number; combatantId: string; phase: "start" | "end" };
  temporaryHitPointsGranted?: number;
  consumeOnAttackRoll?: boolean;
  attackTargetId?: string;
  startsAt?: { round: number; combatantId: string; phase: "start" };
  turnStartTemporaryHitPoints?: number;
  turnStartDamage?: string;
  turnStartSave?: { ability: AbilityName; dc: number; endsOnSuccess: boolean };
  conditionGranted?: string;
  endsWhenSourceHarmsTarget?: boolean;
  revealsSourceOnEnd?: boolean;
  sense?: { creatureTypes: string[]; rangeFeet: number; blockedByTotalCover: boolean };
  senseMagic?: { rangeFeet: number; blockedByTotalCover: boolean };
  rollBonus?: { die: "1d4" | "1d6"; appliesTo: Array<"ability-check" | "attack-roll" | "saving-throw"> };
  consumeOnRollBonus?: boolean;
  points?: Array<{ x: number; y: number }>;
  pointEffect?:
    | { type: "lights"; dimLightFeet: number; movementFeet: number }
    | { type: "damaging-hazard"; sizeFeet: number; damage: string; save: { ability: AbilityName; dc: number; damageOnSuccess: "half" | "none" } }
    | { type: "illusion"; mode: "sound" | "image"; sizeFeet: 5; investigationDc: number; discoveredBy: string[] }
    | { type: "utility-marker"; kind: "weather-sensor" | "bloom"; sizeFeet: number };
  maximumExpiresAtRound?: number;
  afflictionKind?: "disease" | "poison";
  magical?: boolean;
};

export type Combatant = {
  id: string;
  rulesetId?: RulesetId;
  name: string;
  side: "player" | "enemy";
  proficiencyBonus: number;
  level: number;
  size: "small" | "medium" | "large";
  armorCategory?: "light" | "medium" | "heavy";
  baseArmorClass: number;
  baseSpeedFeet: number;
  hitPoints: { current: number; maximum: number };
  temporaryHitPoints: number;
  temporaryHitPointsSourceEffectId?: string;
  damageResistances: string[];
  creatureType?: string;
  skillModifiers: Record<string, number>;
  skillProficiencies: string[];
  abilityModifiers: Record<AbilityName, number>;
  toolProficiencies: string[];
  spellSaveDc?: number;
  conditions: string[];
  knownCharmSources?: string[];
  savingThrowAdvantagesAgainstConditions: string[];
  conditionImmunities: string[];
  abilityCheckDisadvantages: string[];
  savingThrowDisadvantages: AbilityName[];
  weaponAttackDisadvantage: boolean;
  spellcastingBlockedByArmor: boolean;
  resources: CombatResource[];
  inventory: CombatInventoryItem[];
  triggeredFeatures: CharacterTriggeredFeature[];
  weaponDamageRerollFeatureId?: string;
  abilityCheckRerolls: Array<{ featureId: string; skills: string[]; resourceName: string; spendOnlyWhenFailureBecomesSuccess: true }>;
  restAlternative?: { sleepRequired: false; meditationHours: number; semiconscious: true };
  initiative: number;
  initiativeModifier: number;
  initiativeRolled: boolean;
  position: { x: number; y: number };
  attacks: CharacterAttack[];
  spells: CharacterSpell[];
  savingThrowModifiers: Record<AbilityName, number>;
  reactionAvailable: boolean;
  reactionOptions: ReactionOption[];
  abilities: EnemySaveAbility[];
  usedAbilityIds: string[];
  deathSaves: { successes: number; failures: number };
  stabilized: boolean;
  tacticId?: "ranged-skirmisher" | "melee-brute" | "mobile-harrier";
};

export type EncounterState = {
  round: number;
  activeIndex: number;
  selectedTargetId: string | null;
  combatants: Combatant[];
  effects: ActiveEffect[];
  map: ScenarioGrid;
  turn: TurnResources;
  pendingResponse: PendingPlayerResponse | null;
  log: string[];
};
