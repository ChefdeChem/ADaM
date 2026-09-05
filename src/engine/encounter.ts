import type { AbilityName, Character } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import type { Scenario } from "../scenarios/types";
import { enemyProfile } from "../rulesets/enemy-profiles";
import { rollD20, type D20Result } from "./dice";
import { effectiveSpeed, expireEffectsAtTurnEnd, expireEffectsAtTurnStart, reconcileConcentration } from "./effects";
import { availableCharacterAttacks, combatInventoryForCharacter } from "./inventory";
import { resolveTurnStartEffects } from "./turn-effects";
import { resolvePointHazardsForCombatant } from "./point-effects";

const abilityModifier=(score:number)=>Math.floor((score-10)/2);
const abilities:AbilityName[]=["strength","dexterity","constitution","intelligence","wisdom","charisma"];

function characterSavingThrows(character:Character):Record<AbilityName,number>{
  return Object.fromEntries(abilities.map((ability)=>[ability,character.savingThrowModifiers?.[ability]??abilityModifier(character.abilities[ability])])) as Record<AbilityName,number>;
}

function characterSkillModifiers(character: Character): Record<string, number> {
  const modifiers = Object.fromEntries(Object.entries(character.profile?.skills ?? {}).map(([skill, modifier]) => [skill.toLowerCase(), modifier]));
  for (const feature of character.passiveFeatures ?? []) {
    if (feature.resolution.type !== "skill-proficiency") continue;
    const skill = feature.resolution.skill.toLowerCase();
    modifiers[skill] = Math.max(modifiers[skill] ?? Number.NEGATIVE_INFINITY, abilityModifier(character.abilities[feature.resolution.ability]) + character.proficiencyBonus);
  }
  return modifiers;
}

function hasEquipmentTraining(character: Character, category: "light" | "medium" | "heavy" | "shield"): boolean {
  const proficiencies = (character.profile?.proficiencies?.armor ?? []).map((entry) => entry.toLowerCase());
  return category === "shield"
    ? proficiencies.some((entry) => entry === "shields" || entry === "shield")
    : proficiencies.some((entry) => entry === `${category} armor`);
}

function equippedEquipmentRules(character: Character) {
  return (character.equipmentRules ?? []).filter((rule) => rule.equipped);
}

function characterBaseArmorClass(character: Character): number {
  const equipment = equippedEquipmentRules(character);
  const shieldBonus = equipment.reduce((total, rule) => rule.resolution.type === "shield"
    && (!rule.resolution.trainingRequiredForBenefit || hasEquipmentTraining(character, "shield"))
    ? total + rule.resolution.armorClassBonus
    : total, 0);
  const armor = equipment.find((rule) => rule.resolution.type === "armor");
  if (armor?.resolution.type === "armor") {
    const dexterityModifier = abilityModifier(character.abilities.dexterity);
    const dexterityBonus = armor.resolution.dexterityModifier === "full"
      ? dexterityModifier
      : armor.resolution.dexterityModifier === "maximum-two"
        ? Math.min(2, dexterityModifier)
        : 0;
    return armor.resolution.baseArmorClass + dexterityBonus + shieldBonus;
  }
  const unarmoredDefense = (character.passiveFeatures ?? []).find((feature) => feature.resolution.type === "unarmored-defense");
  const wearingArmor = (character.profile?.equipment ?? []).some((item) => /armor|mail|plate|leather|hide/i.test(item.name));
  if (!unarmoredDefense || wearingArmor) return character.armorClass;
  return 10 + abilityModifier(character.abilities.dexterity) + abilityModifier(character.abilities.constitution) + shieldBonus;
}

function characterBaseSpeed(character: Character): number {
  const armor = equippedEquipmentRules(character).find((rule) => rule.resolution.type === "armor");
  const strengthRequirement = armor?.resolution.type === "armor" ? armor.resolution.strengthRequirement : undefined;
  return (character.speedFeet ?? 30) - (strengthRequirement && character.abilities.strength < strengthRequirement ? 10 : 0);
}

function equipmentAbilityCheckDisadvantages(character: Character): string[] {
  const armor = equippedEquipmentRules(character).find((rule) => rule.resolution.type === "armor");
  const disadvantages = armor?.resolution.type === "armor" && armor.resolution.stealthDisadvantage ? ["stealth"] : [];
  return armor?.resolution.type === "armor" && !hasEquipmentTraining(character, armor.resolution.category)
    ? [...disadvantages, "strength", "dexterity"]
    : disadvantages;
}

function armorTrainingViolation(character: Character): boolean {
  const armor = equippedEquipmentRules(character).find((rule) => rule.resolution.type === "armor");
  return Boolean(armor?.resolution.type === "armor" && !hasEquipmentTraining(character, armor.resolution.category));
}

function equippedArmorCategory(character: Character): "light" | "medium" | "heavy" | undefined {
  const armor = equippedEquipmentRules(character).find((rule) => rule.resolution.type === "armor");
  return armor?.resolution.type === "armor" ? armor.resolution.category : undefined;
}

export function createEncounter(character: Character, scenario: Scenario): EncounterState {
  const characterInventory = combatInventoryForCharacter(character);
  const enemyPositions = [{ x: 9, y: 2 }, { x: 9, y: 5 }, { x: 10, y: 3 }];
  const enemySeeds = scenario.enemyProfileIds.map((profileId, index) => ({ instanceId: `${profileId}-${index + 1}`, profileId, position: enemyPositions[index] ?? { x: 10, y: Math.min(6, index + 1) } }));
  const enemies = enemySeeds.map((seed) => {
    const profile = enemyProfile(seed.profileId);
    return {
      id: seed.instanceId,
      name: profile.name,
      side: "enemy" as const,
      proficiencyBonus: 0,
      level: 1,
      size: "medium" as const,
      baseArmorClass: profile.armorClass,
      baseSpeedFeet: profile.speedFeet,
      hitPoints: { current: profile.hitPoints, maximum: profile.hitPoints },
      temporaryHitPoints: 0,
      damageResistances: [],
      creatureType: profile.creatureType,
      skillModifiers: {},
      skillProficiencies: [],
      abilityModifiers: Object.fromEntries(abilities.map((ability) => [ability, 0])) as Record<AbilityName, number>,
      toolProficiencies: [],
      conditions: [],
      knownCharmSources: [],
      savingThrowAdvantagesAgainstConditions: [],
      conditionImmunities: [],
      abilityCheckDisadvantages: [],
      savingThrowDisadvantages: [],
      weaponAttackDisadvantage: false,
      spellcastingBlockedByArmor: false,
      resources: [],
      inventory: [],
      triggeredFeatures: [],
      abilityCheckRerolls: [],
      initiative: 0,
      initiativeModifier: profile.initiativeModifier,
      initiativeRolled: false,
      position: seed.position,
      attacks: profile.attacks.map((attack) => ({ ...attack })),
      spells: [],
      savingThrowModifiers: { strength: 0, dexterity: profile.initiativeModifier, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
      reactionAvailable: true,
      reactionOptions: [],
      abilities: profile.abilities.map((ability) => ({ ...ability })),
      usedAbilityIds: [],
      deathSaves: { successes: 0, failures: 0 },
      stabilized: false,
      tacticId: profile.tacticId,
    };
  });
  return {
    round: 1,
    activeIndex: 0,
    selectedTargetId: null,
    combatants: [
      {
        id: character.id,
        name: character.name,
        side: "player",
        proficiencyBonus: character.proficiencyBonus,
        level: character.level,
        rulesetId: character.rulesetId,
        size: "medium",
        armorCategory: equippedArmorCategory(character),
        baseArmorClass: characterBaseArmorClass(character),
        baseSpeedFeet: characterBaseSpeed(character),
        hitPoints: { ...character.hitPoints },
        temporaryHitPoints: 0,
        creatureType: character.creatureType ?? "humanoid",
        skillModifiers: characterSkillModifiers(character),
        skillProficiencies: (character.passiveFeatures ?? []).flatMap((feature) =>
          feature.resolution.type === "skill-proficiency" ? [feature.resolution.skill.toLowerCase()] : []),
        abilityModifiers: Object.fromEntries(abilities.map((ability) => [ability, abilityModifier(character.abilities[ability])])) as Record<AbilityName, number>,
        toolProficiencies: (character.profile?.proficiencies?.tools ?? []).map((tool) => tool.toLowerCase()),
        spellSaveDc: character.profile?.spellcasting?.saveDc,
        damageResistances: (character.passiveFeatures ?? []).flatMap((feature) =>
          feature.resolution.type === "damage-resistance" ? feature.resolution.damageTypes : []),
        conditions: [],
        knownCharmSources: [],
        savingThrowAdvantagesAgainstConditions: (character.passiveFeatures ?? []).flatMap((feature) =>
          feature.resolution.type === "ancestry-defense" ? feature.resolution.savingThrowAdvantageAgainstConditions : []),
        conditionImmunities: (character.passiveFeatures ?? []).flatMap((feature) =>
          feature.resolution.type === "ancestry-defense" ? feature.resolution.conditionImmunities : []),
        abilityCheckDisadvantages: equipmentAbilityCheckDisadvantages(character),
        savingThrowDisadvantages: armorTrainingViolation(character) ? ["strength", "dexterity"] : [],
        weaponAttackDisadvantage: armorTrainingViolation(character),
        spellcastingBlockedByArmor: armorTrainingViolation(character),
        resources: character.resources.map((resource) => ({ ...resource })),
        inventory: characterInventory,
        triggeredFeatures: (character.triggeredFeatures ?? []).map((feature) => ({ ...feature, provenance: { ...feature.provenance }, resolution: { ...feature.resolution } })),
        weaponDamageRerollFeatureId: (character.passiveFeatures ?? []).find((feature) => feature.resolution.type === "weapon-damage-reroll")?.id,
        abilityCheckRerolls: (character.passiveFeatures ?? []).flatMap((feature) => feature.resolution.type === "ability-check-reroll"
          ? [{ featureId: feature.id, skills: [...feature.resolution.skills], resourceName: feature.resolution.resourceName, spendOnlyWhenFailureBecomesSuccess: feature.resolution.spendOnlyWhenFailureBecomesSuccess }]
          : []),
        restAlternative: (() => {
          const feature = (character.passiveFeatures ?? []).find((candidate) => candidate.resolution.type === "rest-alternative");
          return feature?.resolution.type === "rest-alternative"
            ? { sleepRequired: feature.resolution.sleepRequired, meditationHours: feature.resolution.meditationHours, semiconscious: feature.resolution.semiconscious }
            : undefined;
        })(),
        initiative: 0,
        initiativeModifier: abilityModifier(character.abilities.dexterity),
        initiativeRolled: false,
        position: { x: 1, y: 6 },
        attacks: availableCharacterAttacks(character, characterInventory),
        spells: (character.spells ?? []).map((spell) => ({ ...spell })),
        savingThrowModifiers: characterSavingThrows(character),
        reactionAvailable: true,
        reactionOptions: (character.spells ?? []).filter((spell) => spell.name.toLowerCase() === "shield").map(() => ({ id: "shield", name: "Shield", kind: "armor-class" as const, armorClassBonus: 5, spellLevel: 1, description: "+5 AC until the start of your next turn, including against the triggering attack." })),
        abilities: [],
        usedAbilityIds: [],
        deathSaves: { successes: 0, failures: 0 },
        stabilized: false,
      },
      ...enemies,
    ],
    effects: [],
    map: scenario.grid,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, disengaged: false, usedFeatureIds: [] },
    pendingResponse: null,
    log: ["Encounter started. The collapsed gate is thirty feet ahead."],
  };
}

export function rollPlayerAndEnemyInitiative(encounter: EncounterState, playerId: string, random = Math.random): {
  encounter: EncounterState;
  playerRoll: D20Result;
  enemyRolls: Array<{ combatantId: string; name: string; roll: D20Result }>;
} {
  const player = encounter.combatants.find((combatant) => combatant.id === playerId && combatant.side === "player");
  if (!player) throw new Error("Player combatant not found for initiative.");
  let playerResult = rollCombatantInitiative(encounter, playerId, random);
  const enemyRolls: Array<{ combatantId: string; name: string; roll: D20Result }> = [];
  for (const enemy of playerResult.encounter.combatants.filter((combatant) => combatant.side === "enemy" && !combatant.initiativeRolled)) {
    const result = rollCombatantInitiative(playerResult.encounter, enemy.id, random);
    enemyRolls.push({ combatantId: enemy.id, name: enemy.name, roll: result.roll });
    playerResult = { ...playerResult, encounter: result.encounter };
  }
  return { encounter: playerResult.encounter, playerRoll: playerResult.roll, enemyRolls };
}

export function rollCombatantInitiative(encounter:EncounterState,combatantId:string,random=Math.random):{encounter:EncounterState;roll:D20Result}{
  const combatant=encounter.combatants.find((candidate)=>candidate.id===combatantId);
  if(!combatant)throw new Error("Combatant not found for initiative.");
  const roll=rollD20({mode:"normal",modifier:combatant.initiativeModifier,random});
  const combatants=encounter.combatants.map((candidate)=>candidate.id===combatantId?{...candidate,initiative:roll.total,initiativeRolled:true}:candidate);
  const allRolled=combatants.every((candidate)=>candidate.initiativeRolled);
  const ordered=allRolled?[...combatants].sort((left,right)=>right.initiative-left.initiative):combatants;
  return{roll,encounter:{...encounter,combatants:ordered,activeIndex:0,log:[`${combatant.name} rolled ${roll.total} initiative (${roll.kept} ${roll.modifier>=0?"+":"−"} ${Math.abs(roll.modifier)}).`,...encounter.log]}};
}

export function endTurn(encounter: EncounterState, random = Math.random): EncounterState {
  encounter = reconcileConcentration(encounter);
  const endingCombatant = encounter.combatants[encounter.activeIndex];
  const afterHazards = endingCombatant ? resolvePointHazardsForCombatant(encounter, endingCombatant.id, random) : encounter;
  const afterEndEffects = endingCombatant ? expireEffectsAtTurnEnd(afterHazards, encounter.round, endingCombatant.id) : afterHazards;
  const eligible = (combatant: EncounterState["combatants"][number]) => combatant.side === "enemy"
    ? combatant.hitPoints.current > 0
    : combatant.hitPoints.current > 0 || (!combatant.stabilized && combatant.deathSaves.failures < 3);
  const livingCombatants = afterEndEffects.combatants.filter(eligible);
  if (livingCombatants.length === 0) return afterEndEffects;
  let nextIndex = afterEndEffects.activeIndex;
  for (let offset = 1; offset <= afterEndEffects.combatants.length; offset += 1) {
    const candidateIndex = (afterEndEffects.activeIndex + offset) % afterEndEffects.combatants.length;
    if (eligible(afterEndEffects.combatants[candidateIndex])) { nextIndex = candidateIndex; break; }
  }
  const round = nextIndex <= afterEndEffects.activeIndex ? afterEndEffects.round + 1 : afterEndEffects.round;
  const nextCombatant = afterEndEffects.combatants[nextIndex];
  const combatants = afterEndEffects.combatants.map((combatant, index) => index === nextIndex ? { ...combatant, reactionAvailable: true } : combatant);
  const advanced = {
    ...afterEndEffects,
    combatants,
    round,
    activeIndex: nextIndex,
    selectedTargetId: null,
    turn: { action: true, bonusAction: true, reaction: true, movementRemaining: nextCombatant.hitPoints.current > 0 ? nextCombatant.baseSpeedFeet : 0, disengaged: false, usedFeatureIds: [] },
    log: [`Turn passed to ${nextCombatant.name}.`, ...afterEndEffects.log],
  };
  const expired = expireEffectsAtTurnStart(advanced, round, nextCombatant.id);
  const started = resolveTurnStartEffects(expired, nextCombatant.id, random);
  return { ...started, turn: { ...started.turn, movementRemaining: effectiveSpeed(started, nextCombatant.id) } };
}
