import { BUILT_IN_CHARACTERS } from "../characters/built-ins";
import type { Character, CharacterAttack, CharacterEquipmentRule, CharacterFeatureAction, CharacterPassiveFeature, CharacterResource, CharacterTriggeredFeature, MechanicProvenance } from "../domain/character";

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
  attackIds?: string[];
};

const featureTemplates: FeatureTemplate[] = BUILT_IN_CHARACTERS.flatMap((character) => (character.profile?.features ?? []).flatMap((sourceFeature) => {
  if (!officialSource(sourceFeature.provenance)) return [];
  const action = character.featureActions?.find((feature) => feature.id === sourceFeature.executableActionId);
  const passive = character.passiveFeatures?.find((feature) => feature.id === sourceFeature.executablePassiveId);
  const trigger = character.triggeredFeatures?.find((feature) => feature.id === sourceFeature.executableTriggerId);
  const attackIds = sourceFeature.executableAttackIds?.length ? [...sourceFeature.executableAttackIds] : undefined;
  if (!action && !passive && !trigger && !attackIds) return [];
  return [{ sourceFeature, sourceCharacter: character, action, passive, trigger, attackIds }];
}));

function featureTemplate(character: Character, name: string): FeatureTemplate | undefined {
  const matches = featureTemplates.filter((candidate) => normalize(candidate.sourceFeature.name) === normalize(name));
  const edition = character.source.editionAssessment?.edition;
  if (edition === "dnd-2014" || edition === "dnd-2024") {
    return matches.find((candidate) => candidate.sourceFeature.provenance?.rulesetId === edition);
  }
  const signatures = new Set(matches.map((candidate) => `${candidate.action?.id ?? ""}|${candidate.passive?.id ?? ""}|${candidate.trigger?.id ?? ""}|${candidate.attackIds?.join(",") ?? ""}`));
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

const abilityNames = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
const damageTypes = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"] as const;

function boundedFeet(value: string): number | null {
  const feet = Number(value);
  return Number.isInteger(feet) && feet >= 5 && feet <= 1000 && feet % 5 === 0 ? feet : null;
}

function adaptFeatureAction(feature: { name: string; description: string }, template: CharacterFeatureAction): { action: CharacterFeatureAction; evidence: string[] } | null {
  const action = clone(template);
  const evidence: string[] = [];
  const description = feature.description;

  if (action.resolution.type === "area-saving-throw") {
    const save = description.match(/\bDC\s*(\d{1,2})\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/i);
    const damage = description.match(new RegExp(`\\b(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+(${damageTypes.join("|")})\\s+damage\\b`, "i"));
    const area = description.match(/\b(\d{1,3})[-\s]foot\s+(cone|line|cube|sphere|cylinder)\b/i);
    const saveAbility = abilityNames.find((ability) => ability === save?.[2].toLowerCase());
    const damageType = damage?.[2].toLowerCase();
    const templateDamageType = action.resolution.damage.trim().split(/\s+/).at(-1)?.toLowerCase();
    const areaFeet = area ? boundedFeet(area[1]) : null;
    const isBreathWeapon = action.id.startsWith("breath-weapon-");
    const namesActionCost = /\b(?:use|using)\s+(?:your|an?)\s+action\b/i.test(description)
      || /\bas\s+an\s+action\b/i.test(description);
    const namesSelfOriginExhalation = /\byou(?:r)?\b.{0,32}\bexhal(?:e|es|ed|ing)\b/i.test(description);
    const namesEveryCreature = /\beach\s+creature\b.{0,64}\b(?:area|cone|line)\b/i.test(description)
      || /\b(?:area|cone|line)\b.{0,64}\beach\s+creature\b/i.test(description);
    const namesFailedSaveDamage = /\bdamage\b.{0,48}\bon\s+(?:a\s+)?fail(?:ed|ure)\b/i.test(description)
      || /\bon\s+(?:a\s+)?fail(?:ed|ure)\b.{0,48}\bdamage\b/i.test(description);
    const namesHalfOnSuccess = /\bhalf\b.{0,32}\bdamage\b.{0,48}\bon\s+(?:a\s+)?success(?:ful(?:\s+one)?|)\b/i.test(description)
      || /\bon\s+(?:a\s+)?success(?:ful(?:\s+one)?|)\b.{0,48}\bhalf\b.{0,32}\bdamage\b/i.test(description);
    if (!save || !saveAbility || saveAbility !== action.resolution.save.ability || !damage || damageType !== templateDamageType || !area || area[2].toLowerCase() !== action.resolution.area.shape || !areaFeet) return null;
    if (isBreathWeapon && (!namesActionCost || !namesSelfOriginExhalation || !namesEveryCreature || !namesFailedSaveDamage || !namesHalfOnSuccess)) return null;
    const dc = Number(save[1]);
    if (!Number.isInteger(dc) || dc < 1 || dc > 30) return null;
    action.resolution.save.dc = dc;
    action.resolution.damage = `${damage[1].replace(/\s+/g, " ")} ${damageType}`;
    action.resolution.area.sizeFeet = areaFeet;
    action.description = description;
    if (isBreathWeapon) {
      evidence.push("Printed Action cost.");
      evidence.push("Printed self-origin exhalation.");
      evidence.push("Printed every-creature area targeting.");
      evidence.push("Printed full damage on a failed save.");
      evidence.push("Printed half damage on a successful save.");
    }
    evidence.push(`Printed save DC ${dc} (${saveAbility}).`);
    evidence.push(`Printed damage ${action.resolution.damage}.`);
    evidence.push(`Printed area ${areaFeet}-foot ${action.resolution.area.shape}.`);
  }

  if (action.resolution.type === "sense-creature-types") {
    const range = description.match(/\bwithin\s+(\d{1,4})\s+feet\b/i) ?? description.match(/\b(\d{1,4})[-\s]foot\s+range\b/i);
    const rangeFeet = range ? boundedFeet(range[1]) : null;
    const namesAction = /\bas\s+an\s+action\b/i.test(description);
    const namesDuration = /\buntil\s+the\s+end\s+of\s+your\s+next\s+turn\b/i.test(description);
    const namesCreatureTypes = action.resolution.creatureTypes.every((creatureType) =>
      new RegExp(`\\b${creatureType.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}s?\\b`, "i").test(description));
    const namesTotalCoverBoundary = /\bnot\s+behind\s+total\s+cover\b/i.test(description);
    const namesSacredPresence = /\b(?:place|object)\b/i.test(description)
      && /\bconsecrated\b/i.test(description)
      && /\bdesecrated\b/i.test(description);
    if (!rangeFeet || !namesAction || !namesDuration || !namesCreatureTypes || !namesTotalCoverBoundary || !namesSacredPresence) return null;
    action.resolution.rangeFeet = rangeFeet;
    action.description = description;
    evidence.push("Printed Action cost.");
    evidence.push("Printed end-of-next-turn duration.");
    evidence.push(`Printed sensed creature types: ${action.resolution.creatureTypes.join(", ")}.`);
    evidence.push("Printed Total Cover boundary.");
    evidence.push("Printed consecrated-or-desecrated place or object detection.");
    evidence.push(`Printed range ${rangeFeet} feet.`);
  }

  if (action.resolution.type === "grant-roll-bonus") {
    const range = description.match(/\bwithin\s+(\d{1,4})\s+feet\b/i) ?? description.match(/\b(\d{1,4})[-\s]foot\s+range\b/i);
    const die = description.match(/\b(?:a|one)\s+d(4|6|8|10|12)\b/i) ?? description.match(/\bd(4|6|8|10|12)\s+inspiration\s+die\b/i);
    const rangeFeet = range ? boundedFeet(range[1]) : null;
    const namesBonusAction = /\b(?:as|using)\s+a\s+bonus\s+action\b/i.test(description);
    const namesOtherCreature = /\b(?:one\s+creature\s+other\s+than\s+(?:you|yourself)|another\s+creature)\b/i.test(description);
    const namesHearing = /\b(?:who|that)\s+can\s+hear\s+(?:you|the\s+bard)\b/i.test(description);
    const namesSupportedRolls = /\bability\s+check\b/i.test(description)
      && /\battack\s+roll\b/i.test(description)
      && /\bsaving\s+throw\b/i.test(description);
    const duration = description.match(/\b(?:within\s+)?(?:the\s+)?(?:next\s+)?(\d{1,3})\s+minutes?\b/i);
    const durationRounds = duration ? Number(duration[1]) * 10 : null;
    if (!rangeFeet || !die || !namesBonusAction || !namesOtherCreature || !namesHearing || !namesSupportedRolls || durationRounds !== action.resolution.durationRounds) return null;
    action.resolution.rangeFeet = rangeFeet;
    action.resolution.die = `1d${die[1]}` as typeof action.resolution.die;
    action.description = description;
    evidence.push("Printed Bonus Action cost.");
    evidence.push("Printed another-creature target that excludes the bard.");
    evidence.push("Printed requirement that the target can hear the bard.");
    evidence.push("Printed eligible rolls: ability check, attack roll, saving throw.");
    evidence.push(`Printed duration ${duration?.[1]} minutes (${durationRounds} rounds).`);
    evidence.push(`Printed range ${rangeFeet} feet.`);
    evidence.push(`Printed bonus die ${action.resolution.die}.`);
  }

  if (action.resolution.type === "activate-effect" && action.id === "rage") {
    const namesBonusActionEntry = /\b(?:enter|start|activate)\b.{0,32}\bbonus\s+action\b/i.test(description);
    const namesEntryArmorBoundary = /\b(?:aren't|are\s+not|not)\s+wearing\s+heavy\s+armor\b/i.test(description);
    const namesPhysicalResistance = /\bresistan(?:ce|t)\b/i.test(description)
      && ["bludgeoning", "piercing", "slashing"].every((type) => new RegExp(`\\b${type}\\b`, "i").test(description));
    const namesRageDamage = /\bstrength\b/i.test(description)
      && /\b(?:weapon|unarmed\s+strike)\b/i.test(description)
      && /(?:\+\s*2\b|\bbonus\s+(?:of\s+)?2\b)/i.test(description)
      && /\bdamage\b/i.test(description);
    const namesStrengthAdvantage = /\badvantage\b/i.test(description)
      && /\bstrength\s+checks?\b/i.test(description)
      && /\bstrength\s+saving\s+throws?\b/i.test(description);
    const namesSpellBoundary = /\b(?:can't|cannot|can\s+not)\s+maintain\s+concentration\b/i.test(description)
      && /\b(?:can't|cannot|can\s+not)\s+cast\s+spells?\b/i.test(description);
    const namesInitialDuration = /\buntil\s+the\s+end\s+of\s+your\s+next\s+turn\b/i.test(description);
    const namesEarlyEnds = /\bends?\b.{0,48}\b(?:don|wear)\s+heavy\s+armor\b/i.test(description)
      && /\bincapacitated\b/i.test(description);
    const namesExtensions = /\battack\s+roll\b/i.test(description)
      && /\bforc(?:e|es|ing)\b.{0,24}\bsaving\s+throw\b/i.test(description)
      && /\bbonus\s+action\b.{0,24}\bextend\b/i.test(description);
    const namesMaximumDuration = /\b(?:up\s+to\s+)?10\s+minutes?\b/i.test(description);
    if (!namesBonusActionEntry || !namesEntryArmorBoundary || !namesPhysicalResistance || !namesRageDamage || !namesStrengthAdvantage
      || !namesSpellBoundary || !namesInitialDuration || !namesEarlyEnds || !namesExtensions || !namesMaximumDuration) return null;
    action.description = description;
    evidence.push("Printed Resistance to Bludgeoning, Piercing, and Slashing damage.");
    evidence.push("Printed +2 Rage Damage for Strength attacks with a weapon or Unarmed Strike.");
    evidence.push("Printed Advantage on Strength checks and Strength saving throws.");
    evidence.push("Printed no-Concentration and no-spellcasting boundaries.");
    evidence.push("Printed Bonus Action entry, Heavy Armor and Incapacitated boundaries, end-of-next-turn duration, three extension options, and 10-minute maximum.");
  }

  if (action.resolution.type === "activate-large-form") {
    const minimumLevel = description.match(/\b(?:starting\s+)?at\s+level\s+(\d{1,2})\b/i);
    const duration = description.match(/\b(\d{1,3})\s+minutes?\b/i);
    const speedBonus = description.match(/\b(?:increase|increases|gain|gains)\s+(?:your\s+)?speed\s+by\s+(\d{1,3})\s+feet\b/i);
    const level = Number(minimumLevel?.[1]);
    const durationRounds = Number(duration?.[1]) * 10;
    const speedBonusFeet = speedBonus ? boundedFeet(speedBonus[1]) : null;
    if (level !== action.resolution.minimumLevel || durationRounds !== action.resolution.durationRounds || speedBonusFeet !== action.resolution.speedBonusFeet) return null;
    action.description = description;
    evidence.push(`Printed level requirement ${level}.`);
    evidence.push(`Printed duration ${duration?.[1]} minutes.`);
    evidence.push(`Printed Speed bonus ${speedBonusFeet} feet.`);
  }

  if (action.resolution.type === "dash-and-temporary-hit-points") {
    const namesDash = /\bdash\b/i.test(description);
    const namesBonusAction = /\bbonus\s+action\b/i.test(description);
    const namesTemporaryHitPoints = /\btemporary\s+(?:hit\s+points|hp)\b/i.test(description);
    const namesProficiencyBonus = /\bproficiency\s+bonus\b/i.test(description);
    if (!namesDash || !namesBonusAction || !namesTemporaryHitPoints || !namesProficiencyBonus) return null;
    action.description = description;
    evidence.push("Printed Bonus Action Dash.");
    evidence.push("Printed temporary Hit Points equal to Proficiency Bonus.");
  }

  if (action.resolution.type === "healing-pool") {
    const namesTouch = /\btouch\b/i.test(description);
    const namesHealingPool = /\b(?:pool|lay\s+on\s+hands\s+points?)\b/i.test(description)
      && /\b(?:heal|healing|restore)\b/i.test(description)
      && /\b(?:hit\s+points|hp)\b/i.test(description);
    const rulesetId = action.provenance.rulesetId;
    if (!namesTouch || !namesHealingPool) return null;

    if (rulesetId === "dnd-2014") {
      const namesAction = /\bas\s+an\s+action\b/i.test(description);
      const namesExcludedTypes = /\b(?:no\s+effect\s+on|does(?:n't|\s+not)\s+affect)\b.{0,40}\bundead\b.{0,20}\bconstructs?\b/i.test(description);
      const namesCleansing = /\b(?:spend|expend)\s+5\b.{0,40}\b(?:points?|hit\s+points|hp)\b/i.test(description)
        && /\bcure\b.{0,30}\b(?:one\s+)?disease\b/i.test(description)
        && /\bneutralize\b.{0,30}\b(?:one\s+)?poison\b/i.test(description);
      if (!namesAction || !namesExcludedTypes || !namesCleansing) return null;
      action.description = description;
      evidence.push("Printed Action-cost touch healing from the Lay on Hands pool.");
      evidence.push("Printed no-effect boundary for Undead and Constructs.");
      evidence.push("Printed 5-point cure-one-disease or neutralize-one-poison option.");
    }

    if (rulesetId === "dnd-2024") {
      const namesBonusAction = /\bas\s+a\s+bonus\s+action\b/i.test(description);
      const namesPoisonedRemoval = /\b(?:spend|expend)\s+5\b.{0,40}\b(?:points?|hit\s+points|hp)\b/i.test(description)
        && /\bremove\b.{0,30}\bpoisoned\b/i.test(description);
      if (!namesBonusAction || !namesPoisonedRemoval) return null;
      action.description = description;
      evidence.push("Printed Bonus Action touch healing from the Lay On Hands pool.");
      evidence.push("Printed 5-point Poisoned-condition removal.");
    }
  }

  return { action, evidence };
}

function namedClassLevel(character: Character, className: string): number | null {
  const classes = character.className.split("/").map((entry) => entry.trim());
  for (const entry of classes) {
    const match = entry.match(/^(.+?)(?:\s+(\d+))?$/);
    if (normalize(match?.[1] ?? "") !== normalize(className)) continue;
    if (match?.[2]) return Number(match[2]);
    return classes.length === 1 ? character.level : null;
  }
  return null;
}

function adaptTriggeredFeature(character: Character, feature: { name: string; description: string }, template: CharacterTriggeredFeature): { trigger: CharacterTriggeredFeature; evidence: string[] } | null {
  const trigger = clone(template);
  const evidence: string[] = [];
  const description = feature.description;

  if (trigger.resolution.type === "reduce-damage-by-roll") {
    const die = description.match(/\b(\d+d\d+)\b/i)?.[1].toLowerCase();
    const printedModifier = description.match(/\b\d+d\d+\s*\+\s*(\d+)\b/i)?.[1];
    const namesConstitution = /\bconstitution\s+modifier\b/i.test(description);
    const constitutionModifier = Math.floor((character.abilities.constitution - 10) / 2);
    if (die !== trigger.resolution.die || (!namesConstitution && printedModifier === undefined) || (printedModifier !== undefined && Number(printedModifier) !== constitutionModifier)) return null;
    trigger.resolution.modifier = constitutionModifier;
    trigger.description = description;
    evidence.push(`Printed reduction die ${die}.`);
    evidence.push(`Imported Constitution modifier ${constitutionModifier >= 0 ? "+" : ""}${constitutionModifier}.`);
  }

  if (trigger.resolution.type === "gain-temporary-hit-points") {
    const warlockLevel = namedClassLevel(character, "Warlock");
    const charismaModifier = Math.floor((character.abilities.charisma - 10) / 2);
    const amount = warlockLevel === null ? null : Math.max(1, warlockLevel + charismaModifier);
    const printedAmount = description.match(/\bgain\s+(\d+)\s+temporary\s+(?:hit\s+points|hp)\b/i)?.[1];
    const namesFormula = /\bcharisma\s+modifier\b/i.test(description) && /\bwarlock\s+level\b/i.test(description);
    if (amount === null || (!namesFormula && printedAmount === undefined) || (printedAmount !== undefined && Number(printedAmount) !== amount)) return null;
    trigger.resolution.amount = amount;
    trigger.description = description;
    evidence.push(`Imported Warlock level ${warlockLevel}.`);
    evidence.push(`Imported Charisma modifier ${charismaModifier >= 0 ? "+" : ""}${charismaModifier}.`);
    evidence.push(`Verified temporary Hit Points ${amount}.`);
  }

  if (trigger.resolution.type === "drop-to-one-hit-point") {
    const reducedToZero = /\breduced\s+to\s+0\s+(?:hit\s+points|hp)\b/i.test(description);
    const notKilledOutright = /\bnot\s+killed\s+outright\b/i.test(description);
    const dropsToOne = /\b(?:drop|drops)\s+to\s+1\s+(?:hit\s+point|hit\s+points|hp)\s+instead\b/i.test(description);
    if (!reducedToZero || !notKilledOutright || !dropsToOne) return null;
    trigger.description = description;
    evidence.push("Printed 0 Hit Point trigger without instant death.");
    evidence.push("Printed replacement at 1 Hit Point.");
  }

  return { trigger, evidence };
}

function adaptPassiveFeature(character: Character, feature: { name: string; description: string }, template: CharacterPassiveFeature): { passive: CharacterPassiveFeature; evidence: string[] } | null {
  const passive = clone(template);
  const evidence: string[] = [];
  const description = feature.description;
  const normalizedDescription = normalize(description);

  if (passive.resolution.type === "ancestry-defense") {
    const hasCharmAdvantage = /\badvantage\b/.test(normalizedDescription)
      && /\bsaving throws?\b|\bsaves?\b/.test(normalizedDescription)
      && /\bcharm(?:ed)?\b/.test(normalizedDescription);
    const hasMagicalSleepImmunity = /\bmagic(?:al)?\b/.test(normalizedDescription)
      && /\bsleep\b/.test(normalizedDescription)
      && /\b(?:can't|cannot|can not|immune)\b/.test(normalizedDescription);
    if (!hasCharmAdvantage || !hasMagicalSleepImmunity) return null;
    passive.description = description;
    evidence.push("Printed Advantage on saves against Charmed.");
    evidence.push("Printed immunity to magical sleep.");
  }

  if (passive.resolution.type === "skill-proficiency") {
    const skill = normalize(passive.resolution.skill);
    const namesProficiency = /\bproficien(?:t|cy)\b/.test(normalizedDescription);
    const namesSkill = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(normalizedDescription);
    if (!namesProficiency || !namesSkill) return null;
    passive.description = description;
    evidence.push(`Printed proficiency in ${passive.resolution.skill}.`);
  }

  if (passive.resolution.type === "rest-alternative") {
    const hours = description.match(/\b(\d{1,2})\s+hours?\b/i);
    const doesNotNeedSleep = /\b(?:does not|doesn't|doesn’t|do not|don't|don’t)\s+need\s+(?:to\s+)?sleep\b/i.test(description);
    const meditates = /\bmeditat(?:e|es|ing|ion)\b/i.test(description);
    const semiconscious = /\bsemi[-\s]?conscious(?:ly)?\b/i.test(description);
    if (!doesNotNeedSleep || !meditates || !semiconscious || Number(hours?.[1]) !== passive.resolution.meditationHours) return null;
    passive.description = description;
    evidence.push("Printed sleep alternative.");
    evidence.push(`Printed semiconscious meditation for ${passive.resolution.meditationHours} hours.`);
  }

  if (passive.resolution.type === "unarmored-defense") {
    if (namedClassLevel(character, "Barbarian") === null) return null;
    const dexterityModifier = Math.floor((character.abilities.dexterity - 10) / 2);
    const constitutionModifier = Math.floor((character.abilities.constitution - 10) / 2);
    const baseArmorClass = 10 + dexterityModifier + constitutionModifier;
    const printedBase = description.match(/\bbase\s+(?:armor\s+class|ac)(?:\s+equals|\s+is)?\s+(\d{1,2})\b/i);
    const namesFormula = /\b10\b/.test(description)
      && /\bdexterity\s+(?:and|\+)\s+constitution\s+modifiers?\b/i.test(description);
    const namesUnarmoredRequirement = /\b(?:not|aren't|are not|isn't|is not)\s+wearing\s+(?:any\s+)?armor\b/i.test(description)
      || /\bwhile\s+unarmored\b/i.test(description);
    const namesShield = /\bshield\b/i.test(description);
    if (!namesUnarmoredRequirement || !namesShield || (!namesFormula && Number(printedBase?.[1]) !== baseArmorClass)) return null;
    passive.description = description;
    evidence.push(`Imported Dexterity modifier ${dexterityModifier >= 0 ? "+" : ""}${dexterityModifier}.`);
    evidence.push(`Imported Constitution modifier ${constitutionModifier >= 0 ? "+" : ""}${constitutionModifier}.`);
    evidence.push(`Verified unarmored base AC ${baseArmorClass} with Shield compatibility.`);
  }

  if (passive.resolution.type === "damage-resistance") {
    const printedTypes = damageTypes.filter((type) => new RegExp(`\\b${type}\\s+damage\\b`, "i").test(description));
    const expectedTypes = passive.resolution.damageTypes.map(normalize);
    const namesResistance = /\bresistan(?:ce|t)\b/i.test(description);
    if (!namesResistance || printedTypes.length !== expectedTypes.length || !expectedTypes.every((type) => printedTypes.includes(type as typeof damageTypes[number]))) return null;
    passive.description = description;
    evidence.push(`Printed resistance to ${passive.resolution.damageTypes.join(", ")} damage.`);
  }

  if (passive.resolution.type === "weapon-damage-reroll") {
    const oncePerTurn = /\bonce\s+per\s+turn\b/i.test(description);
    const weaponHit = /\bweapon\b/i.test(description) && /\bhit\b/i.test(description);
    const damageDiceTwice = /\bdamage\s+dice\s+twice\b/i.test(description);
    const eitherResult = /\b(?:choose|use)\s+either\s+(?:result|roll)\b/i.test(description);
    if (!oncePerTurn || !weaponHit || !damageDiceTwice || !eitherResult) return null;
    passive.description = description;
    evidence.push("Printed once-per-turn weapon-hit limit.");
    evidence.push("Printed two weapon-damage rolls with either result chosen.");
  }

  if (passive.resolution.type === "free-spell-cast") {
    const spellId = passive.resolution.spellId;
    const spell = character.spells?.find((candidate) => candidate.id === spellId);
    const spellName = spell?.name ? normalize(spell.name) : "";
    const namesSpell = spellName.length > 0 && normalizedDescription.includes(spellName);
    const onceWithoutSlot = /\b(?:cast|use)\b.{0,40}\bonce\b.{0,40}\bwithout\s+(?:using\s+)?a\s+spell\s+slot\b/i.test(description)
      || /\bonce\b.{0,40}\bwithout\s+(?:using\s+)?a\s+spell\s+slot\b/i.test(description);
    const longRestRecovery = /\blong\s+rest\b/i.test(description);
    if (!namesSpell || !onceWithoutSlot || !longRestRecovery) return null;
    passive.description = description;
    evidence.push(`Printed free cast of ${spell?.name}.`);
    evidence.push("Printed once-per-Long-Rest recovery.");
  }

  return { passive, evidence };
}

function adaptWeaponMastery(
  character: Character,
  feature: { name: string; description: string },
  template: FeatureTemplate,
): { attacks: CharacterAttack[]; executableAttackIds: string[]; evidence: string[] } | null {
  if (!template.attackIds?.length || template.sourceFeature.provenance?.rulesetId !== "dnd-2024") return null;
  const sourceAttacks = template.attackIds.map((attackId) => template.sourceCharacter.attacks?.find((attack) => attack.id === attackId));
  if (sourceAttacks.some((attack) => !attack?.mastery)) return null;
  const masteries = new Set(sourceAttacks.map((attack) => attack!.mastery));
  if (masteries.size !== 1) return null;
  const mastery = sourceAttacks[0]!.mastery!;
  const importedAttacks = (character.attacks ?? []).map(clone);
  const matches = sourceAttacks.map((sourceAttack) => importedAttacks.find((attack) => normalize(attack.name) === normalize(sourceAttack!.name)));
  if (matches.some((attack) => !attack)) return null;

  const description = feature.description;
  const namesHit = /\bhit(?:s|ting)?\b/i.test(description);
  const namesStartOfNextTurn = /\b(?:before|until)\s+the\s+start\s+of\s+(?:your|the\s+attacker'?s)\s+next\s+turn\b/i.test(description);
  const evidence: string[] = [];
  if (mastery === "slow") {
    const namesDamage = /\b(?:deal|deals|dealing)\b.{0,24}\bdamage\b|\bdamag(?:e|es|ed|ing)\b/i.test(description);
    const namesChoice = /\b(?:can|may|choose|optionally)\b/i.test(description);
    const namesReduction = /\breduc(?:e|es|ing)\b.{0,24}\bspeed\b.{0,24}\b10\s+feet\b/i.test(description);
    const namesCap = /\b(?:does(?:n't|\s+not)|cannot|can'?t)\b.{0,48}\b(?:exceed|stack\s+beyond)\s+10\s+feet\b/i.test(description)
      || /\bmaximum\s+(?:speed\s+)?reduction\s+(?:of\s+)?10\s+feet\b/i.test(description);
    if (!namesHit || !namesDamage || !namesChoice || !namesReduction || !namesStartOfNextTurn || !namesCap) return null;
    evidence.push("Printed damaging-hit trigger for the selected weapon.");
    evidence.push("Printed optional 10-foot Speed reduction until the start of the attacker's next turn.");
    evidence.push("Printed 10-foot maximum reduction across repeated Slow hits.");
  } else if (mastery === "sap") {
    const namesDisadvantage = /\bdisadvantage\b/i.test(description);
    const namesNextAttack = /\bnext\s+attack\s+roll\b/i.test(description);
    if (!namesHit || !namesDisadvantage || !namesNextAttack || !namesStartOfNextTurn) return null;
    evidence.push("Printed weapon-hit trigger.");
    evidence.push("Printed Disadvantage on the target's next attack roll before the start of the attacker's next turn.");
  } else {
    return null;
  }

  const executableAttackIds = matches.map((attack) => attack!.id);
  const linkedIds = new Set(executableAttackIds);
  const provenance = clone(template.sourceFeature.provenance!);
  return {
    attacks: importedAttacks.map((attack) => linkedIds.has(attack.id)
      ? { ...attack, mastery, masteryOwnership: "granted", masteryProvenance: provenance }
      : attack),
    executableAttackIds,
    evidence: [`Verified ${feature.name} ownership for ${matches.map((attack) => attack!.name).join(" and ")}.`, ...evidence],
  };
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
  let attacks = (character.attacks ?? []).map(clone);
  const features = (character.profile?.features ?? []).map((feature) => {
    const template = featureTemplate(character, feature.name);
    if (!template || !dependenciesReady(character, template)) return feature;
    const adaptedAction = template.action ? adaptFeatureAction(feature, template.action) : null;
    const adaptedTrigger = template.trigger ? adaptTriggeredFeature(character, feature, template.trigger) : null;
    const adaptedPassive = template.passive ? adaptPassiveFeature(character, feature, template.passive) : null;
    const adaptedAttacks = template.attackIds ? adaptWeaponMastery({ ...character, attacks }, feature, template) : null;
    if (template.action && !adaptedAction) return feature;
    if (template.trigger && !adaptedTrigger) return feature;
    if (template.passive && !adaptedPassive) return feature;
    if (template.attackIds && !adaptedAttacks) return feature;
    if (adaptedAction && !actions.some((candidate) => candidate.id === adaptedAction.action.id)) actions.push(adaptedAction.action);
    if (adaptedPassive && !passives.some((candidate) => candidate.id === adaptedPassive.passive.id)) passives.push(adaptedPassive.passive);
    if (adaptedTrigger && !triggers.some((candidate) => candidate.id === adaptedTrigger.trigger.id)) triggers.push(adaptedTrigger.trigger);
    if (adaptedAttacks) attacks = adaptedAttacks.attacks;
    const valueEvidence = [...(adaptedAction?.evidence ?? []), ...(adaptedTrigger?.evidence ?? []), ...(adaptedPassive?.evidence ?? []), ...(adaptedAttacks?.evidence ?? [])];
    return {
      ...feature,
      id: feature.id ?? slug(feature.name),
      executableActionId: adaptedAction?.action.id,
      executablePassiveId: adaptedPassive?.passive.id,
      executableTriggerId: adaptedTrigger?.trigger.id,
      executableAttackIds: adaptedAttacks?.executableAttackIds,
      executableValueEvidence: valueEvidence.length ? valueEvidence : undefined,
      provenance: clone(template.sourceFeature.provenance!),
    };
  });
  return { actions, passives, triggers, attacks, features };
}

export function linkVerifiedImportedMechanics(character: Character): Character {
  const resources = importedFeatureResources(character);
  const resourceLinkedCharacter = { ...character, resources };
  const equipmentRules = importedEquipmentRules(resourceLinkedCharacter);
  const linkedFeatures = importedFeatures(resourceLinkedCharacter);
  return {
    ...resourceLinkedCharacter,
    equipmentRules,
    attacks: linkedFeatures.attacks,
    featureActions: linkedFeatures.actions,
    passiveFeatures: linkedFeatures.passives,
    triggeredFeatures: linkedFeatures.triggers,
    profile: character.profile ? { ...character.profile, features: linkedFeatures.features } : character.profile,
  };
}
