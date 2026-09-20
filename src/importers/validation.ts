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

export function validateImportedCharacter(character: Character): ImportValidationReport {
  const issues = [
    ...validateCoreStatistics(character),
    ...validateAttacks(character.attacks),
    ...validateResources(character.resources),
    ...validateSpells(character.spells),
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
