import type { EffectModifiers } from "./combat";

export type AbilityName = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

export type MechanicProvenance = {
  rulesetId: "dnd-2014" | "dnd-2024";
  sourceId: "srd-5.1" | "srd-5.2.1" | "official-errata" | "open5e-v2" | "user-imported" | "adam-original";
  sourceReference: string;
};

export type CharacterResource = {
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

export type CharacterAttack = {
  id: string;
  name: string;
  kind: "melee" | "ranged";
  attackBonus: number;
  damage: string;
  normalRangeFeet: number;
  longRangeFeet?: number;
  description?: string;
  ability?: AbilityName;
  mastery?: "sap" | "slow" | "topple";
  masteryProvenance?: MechanicProvenance;
};

export type CharacterSpell = {
  id: string;
  name: string;
  level: number;
  castingTime: "action" | "bonus-action" | "reaction";
  rangeFeet: number;
  target: "self" | "single" | "self-or-single" | "area" | "point";
  targetSide?: "friendly" | "hostile" | "any";
  requiresLineOfSight: boolean;
  requiresTargetHearing?: boolean;
  attackBonus?: number;
  damage?: string;
  healing?: string;
  save?: { ability: AbilityName; dc: number; damageOnSuccess: "half" | "none" };
  targetCreatureTypes?: string[];
  hostileSaveAdvantage?: boolean;
  ritual?: boolean;
  concentration?: boolean;
  durationRounds?: number;
  description?: string;
  unsupportedReason?: string;
  missingCapabilities?: string[];
  provenance?: MechanicProvenance;
  freeCastResourceName?: string;
  area?: {
    origin: "self";
    shape: "cone" | "cube";
    sizeFeet: number;
    affects: "all-creatures" | "hostile-creatures";
    pushFeetOnFailedSave?: number;
  };
  trigger?: "after-melee-hit";
  triggeredDamage?: string;
  onHitEffect?: {
    preventsHealing?: boolean;
    undeadTargetDisadvantageAgainstCaster?: boolean;
  };
  effect?: {
    name: string;
    description: string;
    modifiers?: EffectModifiers;
    temporaryHitPoints?: number;
    applyTo?: "caster" | "target";
    attackTarget?: "spell-target";
    starts?: "start-of-caster-next-turn";
    expires?: "end-of-target-next-turn" | "start-of-caster-next-turn" | "end-of-caster-next-turn";
    consumeOnAttackRoll?: boolean;
    dashOnCast?: boolean;
    turnStartTemporaryHitPoints?: number;
    turnStartDamage?: string;
    turnStartSave?: { ability: AbilityName; dc: number; endsOnSuccess: boolean };
    conditionGranted?: string;
    preventsHarmingSource?: boolean;
    endsWhenSourceHarmsTarget?: boolean;
    revealsSourceOnEnd?: boolean;
    senseMagic?: { rangeFeet: number; blockedByTotalCover: boolean };
    rollBonus?: { die: "1d4" | "1d6"; appliesTo: Array<"ability-check" | "attack-roll" | "saving-throw"> };
    consumeOnRollBonus?: boolean;
  };
  pointEffect?:
    | { type: "lights"; maximumPoints: number; dimLightFeet: number; movementFeet: number }
    | { type: "damaging-hazard"; sizeFeet: number; damage: string; save: { ability: AbilityName; dc: number; damageOnSuccess: "half" | "none" } };
  utilityChoices?: Array<{
    id: string;
    name: string;
    description: string;
    resolution:
      | { type: "illusion"; mode: "sound" | "image"; sizeFeet: 5 }
      | { type: "weather-sensor"; durationRounds: 1 }
      | { type: "bloom" }
      | { type: "sensory-effect"; sizeFeet: 5 }
      | { type: "flame"; operation: "light" | "snuff" | "control" };
  }>;
};

export type CharacterPassiveFeature = {
  id: string;
  name: string;
  description: string;
  resolution:
    | { type: "damage-resistance"; damageTypes: string[] }
    | { type: "ancestry-defense"; savingThrowAdvantageAgainstConditions: string[]; conditionImmunities: string[] }
    | { type: "unarmored-defense"; abilityModifiers: ["dexterity", "constitution"]; allowsShield: boolean }
    | { type: "skill-proficiency"; skill: string; ability: AbilityName }
    | { type: "free-spell-cast"; spellId: string; resourceName: string }
    | { type: "rest-alternative"; sleepRequired: false; meditationHours: number; semiconscious: true }
    | { type: "weapon-damage-reroll"; oncePerTurn: true }
    | { type: "ability-check-reroll"; skills: string[]; resourceName: string; spendOnlyWhenFailureBecomesSuccess: true };
  missingCapabilities?: string[];
  provenance: MechanicProvenance;
};

export type CharacterEquipmentRule = {
  id: string;
  name: string;
  equipped: boolean;
  description: string;
  resolution:
    | {
        type: "armor";
        category: "light" | "medium" | "heavy";
        baseArmorClass: number;
        dexterityModifier: "full" | "maximum-two" | "none";
        strengthRequirement?: number;
        stealthDisadvantage?: boolean;
      }
    | {
        type: "shield";
        armorClassBonus: number;
        trainingRequiredForBenefit: boolean;
      }
    | {
        type: "weapon";
        attackIds: string[];
        expendOnAttackIds?: string[];
      }
    | {
        type: "ammunition";
        attackIds: string[];
        expendOnAttackIds: string[];
      }
    | {
        type: "spellcasting-focus";
        spellcastingClass: string;
      }
    | {
        type: "light-source";
        brightLightFeet: number;
        dimLightFeet: number;
        hoodedDimLightFeet: number;
        fuelMinutes: number;
        adjustmentCost: "action" | "bonus-action";
      }
    | {
        type: "tool-check";
        purpose: string;
        allowedAbilities: AbilityName[];
        actionCost: "action";
      };
  provenance: MechanicProvenance;
};

export type CharacterFeatureAction = {
  id: string;
  name: string;
  cost: "action" | "bonus-action" | "reaction";
  description: string;
  resourceName: string;
  resourceCost: number | "variable";
  resolution:
    | {
        type: "dash-and-temporary-hit-points";
        temporaryHitPoints: "proficiency-bonus";
      }
    | {
        type: "healing-pool";
        rangeFeet: 5;
        excludedCreatureTypes?: string[];
        removesPoisoned?: boolean;
        removesAfflictions?: Array<"disease" | "poison">;
      }
    | {
        type: "activate-effect";
        effect: {
          name: string;
          description: string;
          duration: "end-of-next-turn";
          modifiers: EffectModifiers;
        };
      }
    | {
        type: "sense-creature-types";
        creatureTypes: string[];
        rangeFeet: number;
        duration: "end-of-next-turn";
        blockedByTotalCover: boolean;
      }
    | {
        type: "area-saving-throw";
        area: NonNullable<CharacterSpell["area"]>;
        save: { ability: AbilityName; dc: number; damageOnSuccess: "half" | "none" };
        damage: string;
      }
    | {
        type: "grant-roll-bonus";
        rangeFeet: number;
        excludesSelf: boolean;
        requiresHearing: boolean;
        die: "1d4" | "1d6";
        appliesTo: Array<"ability-check" | "attack-roll" | "saving-throw">;
        durationRounds: number;
      }
    | {
        type: "activate-large-form";
        minimumLevel: number;
        durationRounds: number;
        speedBonusFeet: number;
        strengthCheckAdvantage: true;
        requiresLargeSpace?: boolean;
      };
  missingCapabilities?: string[];
  provenance: MechanicProvenance;
};

export type CharacterTriggeredFeature = {
  id: string;
  name: string;
  trigger: "reduced-to-zero-hit-points" | "takes-damage" | "reduces-hostile-to-zero-hit-points";
  optional: boolean;
  description: string;
  resourceName?: string;
  resourceCost?: number;
  resolution:
    | { type: "drop-to-one-hit-point" }
    | { type: "reduce-damage-by-roll"; die: "1d12"; modifier: number }
    | { type: "gain-temporary-hit-points"; amount: number };
  missingCapabilities?: string[];
  provenance: MechanicProvenance;
};

export type CharacterProfile = {
  playerName?: string;
  species?: string;
  background?: string;
  alignment?: string;
  initiativeModifier?: number;
  spellcasting?: { ability: AbilityName; saveDc: number; attackBonus: number };
  senses?: { darkvisionFeet?: number; passivePerception?: number; passiveInsight?: number; passiveInvestigation?: number };
  skills?: Record<string, number>;
  proficiencies?: { armor: string[]; weapons: string[]; tools: string[]; languages: string[] };
  equipment?: Array<{ name: string; quantity: number; weightPounds?: number }>;
  features?: Array<{
    id?: string;
    name: string;
    description: string;
    executableActionId?: string;
    executableTriggerId?: string;
    executablePassiveId?: string;
    executableAttackIds?: string[];
    provenance?: MechanicProvenance;
  }>;
};

export type Character = {
  id: string;
  name: string;
  className: string;
  level: number;
  rulesetId?: "dnd-2014" | "dnd-2024";
  creatureType?: string;
  armorClass: number;
  speedFeet?: number;
  hitPoints: { current: number; maximum: number };
  proficiencyBonus: number;
  abilities: Record<AbilityName, number>;
  savingThrowModifiers?: Partial<Record<AbilityName, number>>;
  resources: CharacterResource[];
  featureActions?: CharacterFeatureAction[];
  passiveFeatures?: CharacterPassiveFeature[];
  equipmentRules?: CharacterEquipmentRule[];
  triggeredFeatures?: CharacterTriggeredFeature[];
  attacks?: CharacterAttack[];
  spells?: CharacterSpell[];
  actions?: string[];
  profile?: CharacterProfile;
  source: { format: "json" | "fillable-pdf" | "flattened-pdf" | "sample"; fileName?: string; importedAt: string };
};

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
