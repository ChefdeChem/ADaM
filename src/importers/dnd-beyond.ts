import type { AbilityName, CharacterAttack } from "../domain/character";

export type DndBeyondCharacterData = {
  name: string;
  className: string;
  level: number;
  armorClass: number;
  speedFeet: number;
  hitPoints: { current: number; maximum: number };
  proficiencyBonus: number;
  abilities: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  savingThrowModifiers: Record<AbilityName, number>;
  attacks: CharacterAttack[];
};

const integer = (value: string | undefined) => {
  const normalized = String(value ?? "").replace(/[^0-9-]/g, "");
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isLevel = (value: string | undefined) => {
  const parsed = integer(value);
  return parsed !== null && parsed >= 1 && parsed <= 20 && /^\d+$/.test(value ?? "");
};

const isAbilityScore = (value: string | undefined) => {
  const parsed = integer(value);
  return parsed !== null && parsed >= 1 && parsed <= 30;
};

const compoundAttackNames = new Set([
  "Double-Bladed Scimitar", "Great Axe", "Great Club", "Great Sword", "Hand Crossbow",
  "Heavy Crossbow", "Light Crossbow", "Long Bow", "Long Sword", "Poison Dart",
  "Short Bow", "Short Sword", "Two-Handed Sword", "Unarmed Strike", "War Hammer",
]);

const classNames = new Set([
  "artificer", "barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
]);

const idFor = (name: string, index: number) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "attack"}-${index + 1}`;

function extractAttacks(tokens: string[], start: number): CharacterAttack[] {
  const attacks: CharacterAttack[] = [];
  const hitPattern = /^[+-]\d+$/;
  const damagePattern = /^(?:\d+d\d+(?:[+-]\d+)?|\d+)$/i;
  const rangePattern = /\((\d+)\s*\/\s*(\d+)\)/;

  for (let index = Math.max(1, start); index < tokens.length - 2; index += 1) {
    if (!hitPattern.test(tokens[index]) || !damagePattern.test(tokens[index + 1])) continue;
    const finalNamePart = tokens[index - 1];
    if (!finalNamePart || /^(STR|DEX|CON|INT|WIS|CHA|P|E)$/i.test(finalNamePart)) continue;

    const previousNamePart = tokens[index - 2];
    const name = previousNamePart && compoundAttackNames.has(`${previousNamePart} ${finalNamePart}`)
      ? `${previousNamePart} ${finalNamePart}`
      : finalNamePart;
    const damageType = tokens[index + 2] ?? "damage";
    const nextAttack = tokens.findIndex((token, candidate) => candidate > index + 1 && hitPattern.test(token) && damagePattern.test(tokens[candidate + 1] ?? ""));
    const nearby = tokens.slice(index + 2, nextAttack > index ? nextAttack : tokens.length);
    const range = nearby.map((token) => token.match(rangePattern)).find(Boolean);
    const normalRangeFeet = range ? Number(range[1]) : 5;
    const longRangeFeet = range ? Number(range[2]) : undefined;

    attacks.push({
      id: idFor(name, attacks.length),
      name,
      kind: range ? "ranged" : "melee",
      attackBonus: integer(tokens[index]) ?? 0,
      damage: `${tokens[index + 1]} ${damageType.toLowerCase()}`,
      normalRangeFeet,
      longRangeFeet,
      description: range
        ? `Imported range ${normalRangeFeet}/${longRangeFeet} feet; long-range attacks have disadvantage.`
        : "Imported melee attack.",
    });
  }

  return attacks;
}

export function parseDndBeyondTokens(rawTokens: string[]): DndBeyondCharacterData | null {
  const tokens = rawTokens.map((token) => token.replace(/\s+/g, " ").trim()).filter(Boolean);
  const marker = tokens.lastIndexOf("ABILITY SAVE DC");
  if (marker < 0) return null;

  const start = marker + 1;
  const experienceIndex = tokens.findIndex((token, index) => index >= start && /^\(.*milestone.*\)$/i.test(token));
  if (experienceIndex < 0) return null;
  const classIndex = tokens.findIndex((token, index) => index >= start && index < experienceIndex && classNames.has(token.toLowerCase()) && isLevel(tokens[index + 1]));
  if (classIndex < 0) return null;
  const levelIndex = classIndex + 1;

  const abilityStart = experienceIndex + 1;
  const abilityValues = [0, 2, 4, 6, 8, 10].map((offset) => integer(tokens[abilityStart + offset]));
  if (abilityValues.some((score, index) => score === null || !isAbilityScore(tokens[abilityStart + index * 2]))) return null;

  const speedIndex = tokens.findIndex((token, index) => index > abilityStart + 11 && /^\d+$/.test(token) && /^ft\.?$/i.test(tokens[index + 1] ?? "") && /walking/i.test(tokens[index + 2] ?? ""));
  if (speedIndex < 3) return null;

  const proficiencyBonus = integer(tokens[speedIndex - 1]);
  const armorClass = integer(tokens[speedIndex - 2]);
  if (proficiencyBonus === null || armorClass === null) return null;

  const hitDiceIndex = tokens.findIndex((token, index) => index > speedIndex && /^\d+d\d+$/i.test(token));
  if (hitDiceIndex < 0) return null;
  let speedEnd = speedIndex + 2;
  for (let index = speedIndex + 2; index < hitDiceIndex; index += 1) {
    if (/walking|climbing|flying|swimming|burrowing/i.test(tokens[index])) speedEnd = index;
  }
  const hpValues = tokens.slice(speedEnd + 1, hitDiceIndex).map(integer).filter((value): value is number => value !== null && value > 0);
  const maximumHitPoints = hpValues[0] ?? 1;
  const currentHitPoints = hpValues[1] ?? maximumHitPoints;
  const attacks = extractAttacks(tokens, hitDiceIndex + 1);
  const abilityOrder: AbilityName[] = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
  const legacySaveOrder: AbilityName[] = ["charisma", "dexterity", "intelligence", "strength", "wisdom", "constitution"];
  const rawSaveTokens = tokens.slice(abilityStart + 12, abilityStart + 30);
  const markedAbilityOrder = rawSaveTokens.includes("•");
  const saveOrder = markedAbilityOrder ? abilityOrder : legacySaveOrder;
  const saveValues = rawSaveTokens.map(integer).filter((item): item is number => item !== null).slice(0, 6);
  const savingThrowModifiers = Object.fromEntries(saveOrder.map((ability, index) => [ability, saveValues[index] ?? abilityModifier(abilityValues[abilityOrder.indexOf(ability)]!)])) as Record<AbilityName, number>;

  return {
    name: tokens.slice(start, classIndex).join(" ") || "Unnamed Adventurer",
    className: tokens[classIndex] || "Adventurer",
    level: integer(tokens[levelIndex]) ?? 1,
    armorClass,
    speedFeet: integer(tokens[speedIndex]) ?? 30,
    hitPoints: { current: currentHitPoints, maximum: maximumHitPoints },
    proficiencyBonus,
    abilities: {
      strength: abilityValues[0]!,
      dexterity: abilityValues[1]!,
      constitution: abilityValues[2]!,
      intelligence: abilityValues[3]!,
      wisdom: abilityValues[4]!,
      charisma: abilityValues[5]!,
    },
    savingThrowModifiers,
    attacks,
  };
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}
