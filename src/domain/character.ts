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
};

export type CharacterSpell = {
  id: string;
  name: string;
  level: number;
  castingTime: "action" | "bonus-action" | "reaction";
  rangeFeet: number;
  target: "self" | "single" | "self-or-single";
  targetSide?: "friendly" | "hostile" | "any";
  requiresLineOfSight: boolean;
  attackBonus?: number;
  damage?: string;
  healing?: string;
  save?: { ability: AbilityName; dc: number; damageOnSuccess: "half" | "none" };
  ritual?: boolean;
  concentration?: boolean;
  durationRounds?: number;
  description?: string;
  unsupportedReason?: string;
  effect?: {
    name: string;
    description: string;
    modifiers?: EffectModifiers;
    temporaryHitPoints?: number;
  };
};

export type CharacterFeatureAction = {
  id: string;
  name: string;
  cost: "action" | "bonus-action" | "reaction";
  description: string;
  resourceName: string;
  resourceCost: number;
  resolution: {
    type: "dash-and-temporary-hit-points";
    temporaryHitPoints: "proficiency-bonus";
  };
  missingCapabilities?: string[];
  provenance: MechanicProvenance;
};

export type CharacterTriggeredFeature = {
  id: string;
  name: string;
  trigger: "reduced-to-zero-hit-points" | "takes-damage";
  optional: boolean;
  description: string;
  resourceName: string;
  resourceCost: number;
  resolution:
    | { type: "drop-to-one-hit-point" }
    | { type: "reduce-damage-by-roll"; die: "1d12"; modifier: number };
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
    provenance?: MechanicProvenance;
  }>;
};

export type Character = {
  id: string;
  name: string;
  className: string;
  level: number;
  rulesetId?: "dnd-2014" | "dnd-2024";
  armorClass: number;
  speedFeet?: number;
  hitPoints: { current: number; maximum: number };
  proficiencyBonus: number;
  abilities: Record<AbilityName, number>;
  savingThrowModifiers?: Partial<Record<AbilityName, number>>;
  resources: CharacterResource[];
  featureActions?: CharacterFeatureAction[];
  triggeredFeatures?: CharacterTriggeredFeature[];
  attacks?: CharacterAttack[];
  spells?: CharacterSpell[];
  actions?: string[];
  profile?: CharacterProfile;
  source: { format: "json" | "fillable-pdf" | "flattened-pdf" | "sample"; fileName?: string; importedAt: string };
};

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
