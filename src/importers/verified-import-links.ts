import { BUILT_IN_CHARACTERS } from "../characters/built-ins";
import type { Character, CharacterEquipmentRule, CharacterFeatureAction, CharacterPassiveFeature, CharacterResource, CharacterTriggeredFeature, MechanicProvenance } from "../domain/character";

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const slug = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const officialSource = (provenance: MechanicProvenance | undefined) => Boolean(provenance && ["srd-5.1", "srd-5.2.1", "official-errata"].includes(provenance.sourceId));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const equipmentTemplates = BUILT_IN_CHARACTERS.flatMap((character) => (character.equipmentRules ?? [])
  .filter((rule) => officialSource(rule.provenance))
  .map((rule) => ({ character, rule })));

function equipmentTemplate(name: string) {
  const matches = equipmentTemplates.filter((candidate) => normalize(candidate.rule.name) === normalize(name));
  return matches.find((candidate) => candidate.rule.provenance.rulesetId === "dnd-2024") ?? matches[0];
}

function linkedAttackIds(character: Character, template: (typeof equipmentTemplates)[number]): string[] {
  if (template.rule.resolution.type !== "weapon" && template.rule.resolution.type !== "ammunition") return [];
  const sourceNames = new Set(template.rule.resolution.attackIds.flatMap((id) => {
    const attack = template.character.attacks?.find((candidate) => candidate.id === id);
    return attack ? [normalize(attack.name), normalize(attack.name).replace(/^thrown /, "")] : [];
  }));
  const itemName = normalize(template.rule.name);
  return (character.attacks ?? []).filter((attack) => {
    const attackName = normalize(attack.name);
    return sourceNames.has(attackName)
      || (template.rule.resolution.type === "weapon" && attackName.replace(/^thrown /, "") === itemName);
  }).map((attack) => attack.id);
}

function armorTraining(character: Character, category: "light" | "medium" | "heavy" | "shield") {
  const armor = (character.profile?.proficiencies?.armor ?? []).map(normalize);
  return category === "shield"
    ? armor.some((entry) => entry === "shield" || entry === "shields")
    : armor.some((entry) => entry === `${category} armor`);
}

function armorClassFor(character: Character, armor: CharacterEquipmentRule | undefined, shield: CharacterEquipmentRule | undefined): number | null {
  const dexterity = Math.floor((character.abilities.dexterity - 10) / 2);
  let armorClass = 10 + dexterity;
  if (armor?.resolution.type === "armor") {
    if (!armorTraining(character, armor.resolution.category)) return null;
    const dexterityBonus = armor.resolution.dexterityModifier === "full" ? dexterity : armor.resolution.dexterityModifier === "maximum-two" ? Math.min(2, dexterity) : 0;
    armorClass = armor.resolution.baseArmorClass + dexterityBonus;
  }
  if (shield?.resolution.type === "shield") {
    if (shield.resolution.trainingRequiredForBenefit && !armorTraining(character, "shield")) return null;
    armorClass += shield.resolution.armorClassBonus;
  }
  return armorClass;
}

function markUniqueDefensiveLoadout(character: Character, rules: CharacterEquipmentRule[]): CharacterEquipmentRule[] {
  const armors = rules.filter((rule) => rule.resolution.type === "armor");
  const shields = rules.filter((rule) => rule.resolution.type === "shield");
  const candidates: Array<{ armor?: CharacterEquipmentRule; shield?: CharacterEquipmentRule }> = [];
  for (const armor of [undefined, ...armors]) for (const shield of [undefined, ...shields]) {
    if (!armor && !shield) continue;
    if (armorClassFor(character, armor, shield) === character.armorClass) candidates.push({ armor, shield });
  }
  if (candidates.length !== 1) return rules;
  const equippedIds = new Set([candidates[0].armor?.id, candidates[0].shield?.id].filter(Boolean));
  return rules.map((rule) => rule.resolution.type === "armor" || rule.resolution.type === "shield" ? { ...rule, equipped: equippedIds.has(rule.id) } : rule);
}

function importedEquipmentRules(character: Character): CharacterEquipmentRule[] {
  const rules = (character.profile?.equipment ?? []).flatMap((item): CharacterEquipmentRule[] => {
    const template = equipmentTemplate(item.name);
    if (!template) return [];
    const rule = clone(template.rule);
    if (rule.resolution.type === "spellcasting-focus") {
      const spellcastingClass = normalize(rule.resolution.spellcastingClass);
      const classNames = character.className.split("/").map((entry) => normalize(entry).replace(/\s+\d+$/, ""));
      if (!classNames.some((entry) => entry === spellcastingClass) || !character.profile?.spellcasting) return [];
    }
    rule.id = `imported-${slug(item.name)}`;
    rule.name = item.name;
    rule.equipped = rule.resolution.type !== "armor" && rule.resolution.type !== "shield";
    if (rule.resolution.type === "weapon" || rule.resolution.type === "ammunition") {
      const attackIds = linkedAttackIds(character, template);
      if (!attackIds.length) return [];
      const expends = rule.resolution.type === "ammunition"
        ? attackIds
        : template.rule.resolution.type === "weapon" && template.rule.resolution.expendOnAttackIds?.length
          ? (character.attacks ?? []).filter((attack) => attackIds.includes(attack.id) && attack.kind === "ranged").map((attack) => attack.id)
          : [];
      rule.resolution.attackIds = attackIds;
      rule.resolution.expendOnAttackIds = expends;
    }
    return [rule];
  });
  return markUniqueDefensiveLoadout(character, rules);
}

type FeatureTemplate = {
  sourceFeature: NonNullable<NonNullable<Character["profile"]>["features"]>[number];
  sourceCharacter: Character;
  action?: CharacterFeatureAction;
  passive?: CharacterPassiveFeature;
  trigger?: CharacterTriggeredFeature;
};

const featureTemplates: FeatureTemplate[] = BUILT_IN_CHARACTERS.flatMap((character) => (character.profile?.features ?? []).flatMap((sourceFeature) => {
  if (!officialSource(sourceFeature.provenance)) return [];
  const action = character.featureActions?.find((feature) => feature.id === sourceFeature.executableActionId);
  const passive = character.passiveFeatures?.find((feature) => feature.id === sourceFeature.executablePassiveId);
  const trigger = character.triggeredFeatures?.find((feature) => feature.id === sourceFeature.executableTriggerId);
  if (!action && !passive && !trigger) return [];
  return [{ sourceFeature, sourceCharacter: character, action, passive, trigger }];
}));

function featureTemplate(character: Character, name: string): FeatureTemplate | undefined {
  const matches = featureTemplates.filter((candidate) => normalize(candidate.sourceFeature.name) === normalize(name));
  const edition = character.source.editionAssessment?.edition;
  if (edition === "dnd-2014" || edition === "dnd-2024") {
    return matches.find((candidate) => candidate.sourceFeature.provenance?.rulesetId === edition);
  }
  const signatures = new Set(matches.map((candidate) => `${candidate.action?.id ?? ""}|${candidate.passive?.id ?? ""}|${candidate.trigger?.id ?? ""}`));
  return signatures.size === 1 ? matches[0] : undefined;
}

function dependenciesReady(character: Character, template: FeatureTemplate): boolean {
  const resourceNames = new Set(character.resources.map((resource) => normalize(resource.name)));
  const spellIds = new Set((character.spells ?? []).map((spell) => spell.id));
  if (template.action && !resourceNames.has(normalize(template.action.resourceName))) return false;
  if (template.trigger?.resourceName && !resourceNames.has(normalize(template.trigger.resourceName))) return false;
  if (template.passive?.resolution.type === "ability-check-reroll" && !resourceNames.has(normalize(template.passive.resolution.resourceName))) return false;
  if (template.passive?.resolution.type === "free-spell-cast") return resourceNames.has(normalize(template.passive.resolution.resourceName)) && spellIds.has(template.passive.resolution.spellId);
  return true;
}

const countWords: Record<string, number> = {
  once: 1,
  twice: 2,
  thrice: 3,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

function explicitRecovery(description: string): CharacterResource["recovery"] | null {
  const hasShortRest = /\bshort(?:\s+or\s+long)?\s+rest\b/i.test(description);
  const hasLongRest = /\blong\s+rest\b/i.test(description);
  if (hasShortRest) return "short-rest";
  if (hasLongRest) return "long-rest";
  return null;
}

function explicitCounter(description: string): { current: number; maximum: number } | null {
  const ratio = description.match(/\b(?:uses?\s*)?(\d+)\s*\/\s*(\d+)(?:\s*uses?)?\b/i);
  if (ratio) {
    const current = Number(ratio[1]);
    const maximum = Number(ratio[2]);
    return maximum > 0 && current >= 0 && current <= maximum ? { current, maximum } : null;
  }
  const pool = description.match(/\b(\d+|one|two|three|four|five|six)[-\s](?:point|use)[-\s](?:pool|s?)\b/i);
  const cadence = description.match(/\b(once|twice|thrice|one|two|three|four|five|six|\d+)\b(?=.{0,24}\b(?:per|each)\b.{0,16}\b(?:short|long)\s+rest\b)/i);
  const value = pool?.[1] ?? cadence?.[1];
  if (!value) return null;
  const maximum = /^\d+$/.test(value) ? Number(value) : countWords[value.toLowerCase()];
  return maximum > 0 ? { current: maximum, maximum } : null;
}

function requiredResourceName(template: FeatureTemplate): string | null {
  if (template.action) return template.action.resourceName;
  if (template.trigger?.resourceName) return template.trigger.resourceName;
  if (template.passive?.resolution.type === "ability-check-reroll" || template.passive?.resolution.type === "free-spell-cast") {
    return template.passive.resolution.resourceName;
  }
  return null;
}

function importedFeatureResources(character: Character): CharacterResource[] {
  const resources = character.resources.map(clone);
  const knownNames = new Set(resources.map((resource) => normalize(resource.name)));
  for (const feature of character.profile?.features ?? []) {
    const template = featureTemplate(character, feature.name);
    const resourceName = template ? requiredResourceName(template) : null;
    if (!template || !resourceName || knownNames.has(normalize(resourceName))) continue;
    const counter = explicitCounter(feature.description);
    const recovery = explicitRecovery(feature.description);
    const sourceResource = template.sourceCharacter.resources.find((resource) => normalize(resource.name) === normalize(resourceName));
    if (!counter || !recovery || !sourceResource || sourceResource.kind !== "generic" || sourceResource.recovery !== recovery) continue;
    resources.push({
      id: `imported-${slug(resourceName)}`,
      name: resourceName,
      kind: "generic",
      ...counter,
      recovery,
      sourceFeatureName: feature.name,
      provenance: clone(template.sourceFeature.provenance!),
    });
    knownNames.add(normalize(resourceName));
  }
  return resources;
}

function importedFeatures(character: Character) {
  const actions: CharacterFeatureAction[] = [];
  const passives: CharacterPassiveFeature[] = [];
  const triggers: CharacterTriggeredFeature[] = [];
  const features = (character.profile?.features ?? []).map((feature) => {
    const template = featureTemplate(character, feature.name);
    if (!template || !dependenciesReady(character, template)) return feature;
    if (template.action && !actions.some((candidate) => candidate.id === template.action!.id)) actions.push(clone(template.action));
    if (template.passive && !passives.some((candidate) => candidate.id === template.passive!.id)) passives.push(clone(template.passive));
    if (template.trigger && !triggers.some((candidate) => candidate.id === template.trigger!.id)) triggers.push(clone(template.trigger));
    return {
      ...feature,
      id: feature.id ?? slug(feature.name),
      executableActionId: template.action?.id,
      executablePassiveId: template.passive?.id,
      executableTriggerId: template.trigger?.id,
      provenance: clone(template.sourceFeature.provenance!),
    };
  });
  return { actions, passives, triggers, features };
}

export function linkVerifiedImportedMechanics(character: Character): Character {
  const resources = importedFeatureResources(character);
  const resourceLinkedCharacter = { ...character, resources };
  const equipmentRules = importedEquipmentRules(resourceLinkedCharacter);
  const linkedFeatures = importedFeatures(resourceLinkedCharacter);
  return {
    ...resourceLinkedCharacter,
    equipmentRules,
    featureActions: linkedFeatures.actions,
    passiveFeatures: linkedFeatures.passives,
    triggeredFeatures: linkedFeatures.triggers,
    profile: character.profile ? { ...character.profile, features: linkedFeatures.features } : character.profile,
  };
}
