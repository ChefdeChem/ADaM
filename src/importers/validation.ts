import type { AbilityName, Character, CharacterAttack, CharacterResource, CharacterSpell } from "../domain/character";
import type { ImportIssue, ImportIssueSection, ImportValidationReport } from "./types";

const abilities: AbilityName[] = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const attackKinds = new Set(["melee", "ranged"]);
const recoveryKinds = new Set(["short-rest", "long-rest", "special"]);
const castingTimes = new Set(["action", "bonus-action", "reaction"]);
const spellTargets = new Set(["self", "single", "self-or-single", "area", "point"]);
const damageFormula = /^(?:\d+d\d+(?:\s*[+−-]\s*\d+)?|\d+)(?:\s+[a-z][a-z -]*)?$/i;

function issue(severity: ImportIssue["severity"], section: ImportIssueSection, code: string, message: string): ImportIssue {
  return { severity, section, code, message };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const normalize = (value: string) => value.trim().toLowerCase();

export function expectedProficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

export function validateCoreStatistics(character: Character): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!character.name?.trim()) issues.push(issue("error", "core", "missing-name", "Character name is required."));
  if (!character.className?.trim()) issues.push(issue("error", "core", "missing-class", "Class is required."));
  if (!Number.isInteger(character.level) || character.level < 1 || character.level > 20) issues.push(issue("error", "core", "invalid-level", "Level must be a whole number from 1 through 20."));
  if (!finite(character.armorClass) || character.armorClass < 1) issues.push(issue("error", "core", "invalid-armor-class", "Armor Class must be a positive number."));
  if (!finite(character.speedFeet) || character.speedFeet! < 0) issues.push(issue("error", "core", "invalid-speed", "Walking speed must be zero or greater."));
  else if (character.speedFeet! % 5 !== 0) issues.push(issue("warning", "core", "unusual-speed", `Walking speed ${character.speedFeet} is not a 5-foot increment; confirm the sheet value.`));
  if (!Number.isInteger(character.hitPoints?.maximum) || character.hitPoints.maximum < 1) issues.push(issue("error", "core", "invalid-maximum-hit-points", "Maximum Hit Points must be a positive whole number."));
  if (!Number.isInteger(character.hitPoints?.current) || character.hitPoints.current < 0 || character.hitPoints.current > character.hitPoints.maximum) issues.push(issue("error", "core", "invalid-current-hit-points", "Current Hit Points must be a whole number from zero through the maximum."));
  if (!Number.isInteger(character.proficiencyBonus) || character.proficiencyBonus < 0) issues.push(issue("error", "core", "invalid-proficiency-bonus", "Proficiency Bonus must be a nonnegative whole number."));
  else if (Number.isInteger(character.level) && character.level >= 1 && character.level <= 20 && character.proficiencyBonus !== expectedProficiencyBonus(character.level)) {
    issues.push(issue("warning", "core", "unexpected-proficiency-bonus", `Level ${character.level} normally uses a +${expectedProficiencyBonus(character.level)} Proficiency Bonus; the imported sheet shows +${character.proficiencyBonus}.`));
  }
  for (const ability of abilities) {
    const score = character.abilities?.[ability];
    if (!Number.isInteger(score) || score < 1 || score > 30) issues.push(issue("error", "core", `invalid-${ability}`, `${ability[0].toUpperCase()}${ability.slice(1)} must be a whole number from 1 through 30.`));
  }
  if (character.profile?.initiativeModifier !== undefined && !finite(character.profile.initiativeModifier)) {
    issues.push(issue("error", "core", "invalid-initiative-modifier", "Initiative modifier must be a number when supplied."));
  }
  for (const [ability, modifier] of Object.entries(character.savingThrowModifiers ?? {})) {
    if (!abilities.includes(ability as AbilityName) || !finite(modifier)) issues.push(issue("error", "core", "invalid-saving-throw-modifier", `${ability} saving throw modifier must be numeric.`));
  }
  for (const [skill, modifier] of Object.entries(character.profile?.skills ?? {})) {
    if (!finite(modifier)) issues.push(issue("error", "core", "invalid-skill-modifier", `${skill} skill modifier must be numeric.`));
  }
  return issues;
}

export function validateAttacks(attacks: CharacterAttack[] | undefined): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const ids = new Set<string>();
  for (const [index, attack] of (attacks ?? []).entries()) {
    const label = attack.name?.trim() || `Attack ${index + 1}`;
    if (!attack.id?.trim()) issues.push(issue("error", "attacks", "missing-attack-id", `${label} needs an attack ID.`));
    else if (ids.has(attack.id)) issues.push(issue("error", "attacks", "duplicate-attack-id", `${label} repeats attack ID “${attack.id}”.`));
    else ids.add(attack.id);
    if (!attack.name?.trim()) issues.push(issue("error", "attacks", "missing-attack-name", `Attack ${index + 1} needs a name.`));
    if (!attackKinds.has(attack.kind)) issues.push(issue("error", "attacks", "invalid-attack-kind", `${label} must be melee or ranged.`));
    if (!finite(attack.attackBonus)) issues.push(issue("error", "attacks", "invalid-attack-bonus", `${label} needs a numeric attack bonus.`));
    if (!attack.damage?.trim() || !damageFormula.test(attack.damage.trim())) issues.push(issue("error", "attacks", "invalid-attack-damage", `${label} has a damage formula ADaM cannot roll: “${attack.damage ?? "blank"}”.`));
    if (!finite(attack.normalRangeFeet) || attack.normalRangeFeet < 0) issues.push(issue("error", "attacks", "invalid-normal-range", `${label} needs a nonnegative normal range.`));
    if (attack.longRangeFeet !== undefined && (!finite(attack.longRangeFeet) || attack.longRangeFeet < attack.normalRangeFeet)) issues.push(issue("error", "attacks", "invalid-long-range", `${label} cannot have a long range shorter than its normal range.`));
  }
  return issues;
}

export function validateResources(resources: CharacterResource[] | undefined): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const ids = new Set<string>();
  for (const [index, resource] of (resources ?? []).entries()) {
    const label = resource.name?.trim() || `Resource ${index + 1}`;
    if (!resource.id?.trim()) issues.push(issue("error", "resources", "missing-resource-id", `${label} needs a resource ID.`));
    else if (ids.has(resource.id)) issues.push(issue("error", "resources", "duplicate-resource-id", `${label} repeats resource ID “${resource.id}”.`));
    else ids.add(resource.id);
    if (!resource.name?.trim()) issues.push(issue("error", "resources", "missing-resource-name", `Resource ${index + 1} needs a name.`));
    if (!Number.isInteger(resource.maximum) || resource.maximum < 0) issues.push(issue("error", "resources", "invalid-resource-maximum", `${label} needs a nonnegative whole-number maximum.`));
    if (!Number.isInteger(resource.current) || resource.current < 0 || resource.current > resource.maximum) issues.push(issue("error", "resources", "invalid-resource-current", `${label} must be between zero and its maximum.`));
    if (!recoveryKinds.has(resource.recovery)) issues.push(issue("error", "resources", "invalid-resource-recovery", `${label} needs a registered recovery schedule.`));
    if (resource.kind === "spell-slot" && (!Number.isInteger(resource.level) || resource.level! < 1 || resource.level! > 9)) issues.push(issue("error", "resources", "invalid-spell-slot-level", `${label} needs a spell-slot level from 1 through 9.`));
  }
  return issues;
}

export function validateSpells(spells: CharacterSpell[] | undefined): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const ids = new Set<string>();
  for (const [index, spell] of (spells ?? []).entries()) {
    const label = spell.name?.trim() || `Spell ${index + 1}`;
    if (!spell.id?.trim()) issues.push(issue("error", "spells", "missing-spell-id", `${label} needs a spell ID.`));
    else if (ids.has(spell.id)) issues.push(issue("error", "spells", "duplicate-spell-id", `${label} repeats spell ID “${spell.id}”.`));
    else ids.add(spell.id);
    if (!spell.name?.trim()) issues.push(issue("error", "spells", "missing-spell-name", `Spell ${index + 1} needs a name.`));
    if (!Number.isInteger(spell.level) || spell.level < 0 || spell.level > 9) issues.push(issue("error", "spells", "invalid-spell-level", `${label} needs a spell level from 0 through 9.`));
    if (!castingTimes.has(spell.castingTime)) issues.push(issue("error", "spells", "invalid-casting-time", `${label} needs a supported casting time.`));
    if (!spellTargets.has(spell.target)) issues.push(issue("error", "spells", "invalid-spell-target", `${label} needs a supported target mode.`));
    if (!finite(spell.rangeFeet) || spell.rangeFeet < 0) issues.push(issue("error", "spells", "invalid-spell-range", `${label} needs a nonnegative range.`));
    if (typeof spell.requiresLineOfSight !== "boolean") issues.push(issue("error", "spells", "missing-line-of-sight", `${label} must state whether it requires line of sight.`));
    if (spell.damage && !damageFormula.test(spell.damage.trim())) issues.push(issue("error", "spells", "invalid-spell-damage", `${label} has a damage formula ADaM cannot roll: “${spell.damage}”.`));
    if (spell.healing && !damageFormula.test(spell.healing.trim())) issues.push(issue("error", "spells", "invalid-spell-healing", `${label} has a healing formula ADaM cannot roll: “${spell.healing}”.`));
    if (!spell.provenance && !spell.unsupportedReason) issues.push(issue("warning", "spells", "unverified-spell-provenance", `${label} has no verified rules provenance; ADaM preserves it as user-provided content.`));
  }
  return issues;
}

export function validateEquipmentInventory(character: Character): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const names = new Set<string>();
  for (const [index, item] of (character.profile?.equipment ?? []).entries()) {
    const label = item.name?.trim() || `Equipment item ${index + 1}`;
    const name = normalize(item.name ?? "");
    if (!name) issues.push(issue("error", "equipment", "missing-equipment-name", `Equipment item ${index + 1} needs a name.`));
    else if (names.has(name)) issues.push(issue("error", "equipment", "duplicate-equipment-name", `${label} appears more than once; combine it into one quantity so equipment rules have one unambiguous match.`));
    else names.add(name);
    if (!Number.isInteger(item.quantity) || item.quantity < 0) issues.push(issue("error", "equipment", "invalid-equipment-quantity", `${label} needs a nonnegative whole-number quantity.`));
    if (item.weightPounds !== undefined && (!finite(item.weightPounds) || item.weightPounds < 0)) issues.push(issue("error", "equipment", "invalid-equipment-weight", `${label} needs a nonnegative numeric weight when supplied.`));
  }
  return issues;
}

export function validateEquipmentRuleLinks(character: Character): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const ids = new Set<string>();
  const equipmentNames = new Set((character.profile?.equipment ?? []).map((item) => normalize(item.name)));
  for (const [index, rule] of (character.equipmentRules ?? []).entries()) {
    const label = rule.name?.trim() || `Equipment rule ${index + 1}`;
    if (!rule.id?.trim()) issues.push(issue("error", "equipment", "missing-equipment-rule-id", `${label} needs an equipment rule ID.`));
    else if (ids.has(rule.id)) issues.push(issue("error", "equipment", "duplicate-equipment-rule-id", `${label} repeats equipment rule ID “${rule.id}”.`));
    else ids.add(rule.id);
    if (!rule.name?.trim()) issues.push(issue("error", "equipment", "missing-equipment-rule-name", `Equipment rule ${index + 1} needs a name.`));
    else if (!equipmentNames.has(normalize(rule.name))) issues.push(issue("error", "equipment", "missing-equipment-item", `${label} has an executable equipment rule but no matching imported inventory item.`));
  }
  return issues;
}

export function validateWeaponEquipmentLinks(character: Character): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const attackIds = new Set((character.attacks ?? []).map((attack) => attack.id));
  for (const rule of character.equipmentRules ?? []) {
    if (rule.resolution.type !== "weapon" && rule.resolution.type !== "ammunition") continue;
    if (!rule.resolution.attackIds.length) issues.push(issue("error", "equipment", "missing-equipment-attack-link", `${rule.name} must link to at least one imported attack.`));
    for (const attackId of rule.resolution.attackIds) {
      if (!attackIds.has(attackId)) issues.push(issue("error", "equipment", "unknown-equipment-attack", `${rule.name} links to unknown attack ID “${attackId}”.`));
    }
    for (const attackId of rule.resolution.expendOnAttackIds ?? []) {
      if (!rule.resolution.attackIds.includes(attackId)) issues.push(issue("error", "equipment", "invalid-expend-attack-link", `${rule.name} expends on attack ID “${attackId}” without governing that attack.`));
    }
    if (rule.resolution.type === "ammunition" && !(rule.resolution.expendOnAttackIds?.length)) {
      issues.push(issue("error", "equipment", "missing-ammunition-expenditure", `${rule.name} must identify which linked attacks expend one unit.`));
    }
  }
  return issues;
}

export function validateFeatureOwnershipLinks(character: Character): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const mechanics = [
    ["action", character.featureActions ?? []],
    ["passive", character.passiveFeatures ?? []],
    ["trigger", character.triggeredFeatures ?? []],
  ] as const;
  for (const [kind, entries] of mechanics) {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry.id?.trim()) issues.push(issue("error", "features", `missing-${kind}-feature-id`, `${entry.name || "Feature"} needs an executable ${kind} ID.`));
      else if (ids.has(entry.id)) issues.push(issue("error", "features", `duplicate-${kind}-feature-id`, `${entry.name} repeats executable ${kind} ID “${entry.id}”.`));
      else ids.add(entry.id);
    }
  }
  const actionIds = new Set((character.featureActions ?? []).map((entry) => entry.id));
  const passiveIds = new Set((character.passiveFeatures ?? []).map((entry) => entry.id));
  const triggerIds = new Set((character.triggeredFeatures ?? []).map((entry) => entry.id));
  const attackIds = new Set((character.attacks ?? []).map((entry) => entry.id));
  const linkedActions = new Set<string>();
  const linkedPassives = new Set<string>();
  const linkedTriggers = new Set<string>();
  for (const feature of character.profile?.features ?? []) {
    if (feature.executableActionId) {
      linkedActions.add(feature.executableActionId);
      if (!actionIds.has(feature.executableActionId)) issues.push(issue("error", "features", "unknown-feature-action-link", `${feature.name} links to unknown feature action ID “${feature.executableActionId}”.`));
    }
    if (feature.executablePassiveId) {
      linkedPassives.add(feature.executablePassiveId);
      if (!passiveIds.has(feature.executablePassiveId)) issues.push(issue("error", "features", "unknown-passive-feature-link", `${feature.name} links to unknown passive feature ID “${feature.executablePassiveId}”.`));
    }
    if (feature.executableTriggerId) {
      linkedTriggers.add(feature.executableTriggerId);
      if (!triggerIds.has(feature.executableTriggerId)) issues.push(issue("error", "features", "unknown-triggered-feature-link", `${feature.name} links to unknown triggered feature ID “${feature.executableTriggerId}”.`));
    }
    for (const attackId of feature.executableAttackIds ?? []) {
      if (!attackIds.has(attackId)) issues.push(issue("error", "features", "unknown-feature-attack-link", `${feature.name} links to unknown attack ID “${attackId}”.`));
    }
  }
  for (const feature of character.featureActions ?? []) if (!linkedActions.has(feature.id)) issues.push(issue("warning", "features", "unowned-feature-action", `${feature.name} is executable but is not linked from an imported source feature; confirm that the character owns it.`));
  for (const feature of character.passiveFeatures ?? []) if (!linkedPassives.has(feature.id)) issues.push(issue("warning", "features", "unowned-passive-feature", `${feature.name} is executable but is not linked from an imported source feature; confirm that the character owns it.`));
  for (const feature of character.triggeredFeatures ?? []) if (!linkedTriggers.has(feature.id)) issues.push(issue("warning", "features", "unowned-triggered-feature", `${feature.name} is executable but is not linked from an imported source feature; confirm that the character owns it.`));
  return issues;
}

export function validateFeatureDependencies(character: Character): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const resourceNames = new Set(character.resources.map((resource) => normalize(resource.name)));
  const spellIds = new Set((character.spells ?? []).map((spell) => spell.id));
  const requireResource = (featureName: string, resourceName: string | undefined) => {
    if (resourceName && !resourceNames.has(normalize(resourceName))) issues.push(issue("error", "features", "missing-feature-resource", `${featureName} uses resource “${resourceName}”, but that resource was not imported.`));
  };
  for (const feature of character.featureActions ?? []) requireResource(feature.name, feature.resourceName);
  for (const feature of character.triggeredFeatures ?? []) requireResource(feature.name, feature.resourceName);
  for (const feature of character.passiveFeatures ?? []) {
    if (feature.resolution.type === "ability-check-reroll") requireResource(feature.name, feature.resolution.resourceName);
    if (feature.resolution.type === "free-spell-cast") {
      requireResource(feature.name, feature.resolution.resourceName);
      if (!spellIds.has(feature.resolution.spellId)) issues.push(issue("error", "features", "missing-feature-spell", `${feature.name} links to unknown spell ID “${feature.resolution.spellId}”.`));
    }
  }
  return issues;
}

export function validateImportedCharacter(character: Character): ImportValidationReport {
  const issues = [
    ...validateCoreStatistics(character),
    ...validateAttacks(character.attacks),
    ...validateResources(character.resources),
    ...validateSpells(character.spells),
    ...validateEquipmentInventory(character),
    ...validateEquipmentRuleLinks(character),
    ...validateWeaponEquipmentLinks(character),
    ...validateFeatureOwnershipLinks(character),
    ...validateFeatureDependencies(character),
  ];
  for (const spell of character.spells ?? []) {
    if (spell.level === 0 || spell.unsupportedReason) continue;
    const hasSlot = character.resources.some((resource) => resource.kind === "spell-slot" && resource.level === spell.level);
    const hasFreeCast = Boolean(spell.freeCastResourceName && character.resources.some((resource) => resource.name.toLowerCase() === spell.freeCastResourceName!.toLowerCase()));
    if (!hasSlot && !hasFreeCast) issues.push(issue("warning", "resources", "missing-spell-casting-pool", `${spell.name} has no imported level ${spell.level} spell-slot pool or named free-cast resource, so it will remain unavailable in combat.`));
  }
  const errors = issues.filter((candidate) => candidate.severity === "error");
  const warnings = issues.filter((candidate) => candidate.severity === "warning");
  return { errors, warnings, ready: errors.length === 0 };
}
