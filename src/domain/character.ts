import type { EffectModifiers } from "./combat";

export type AbilityName = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

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
  target: "self" | "single";
  requiresLineOfSight: boolean;
  attackBonus?: number;
  damage?: string;
  concentration?: boolean;
  durationRounds?: number;
  effect?: {
    name: string;
    description: string;
    modifiers?: EffectModifiers;
    temporaryHitPoints?: number;
  };
};

export type Character = {
  id: string;
  name: string;
  className: string;
  level: number;
  armorClass: number;
  speedFeet?: number;
  hitPoints: { current: number; maximum: number };
  proficiencyBonus: number;
  abilities: Record<AbilityName, number>;
  savingThrowModifiers?: Partial<Record<AbilityName, number>>;
  resources: CharacterResource[];
  attacks?: CharacterAttack[];
  spells?: CharacterSpell[];
  actions?: string[];
  source: { format: "json" | "fillable-pdf" | "flattened-pdf" | "sample"; fileName?: string; importedAt: string };
};

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
