import type { Character, CharacterAttack, CharacterSpell, MechanicProvenance } from "../domain/character";
import type { RulesetId } from "../rulesets/types";
import type { CharacterMechanicCoverage, MechanicComponent, MechanicSupportStatus, RuleEntityKind, RuleRegistryEntry, RuleSourceId } from "./types";

const masteryPattern = /\b(graze|nick|push|sap|slow|topple|vex)\b/i;
const unresolvedPattern = /not implemented|isn't implemented|is not implemented|requires adjudication/i;

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rulesetFor(character: Character): RulesetId {
  return character.rulesetId ?? "dnd-2024";
}

function sourceFor(character: Character): RuleSourceId {
  return character.source.format === "sample" ? "adam-original" : "user-imported";
}

export function canonicalRuleId(rulesetId: RulesetId, kind: RuleEntityKind, name: string): string {
  return `${rulesetId}.${kind}.${slug(name)}`;
}

function entry(
  character: Character,
  kind: RuleEntityKind,
  entityId: string,
  name: string,
  status: MechanicSupportStatus,
  components: MechanicComponent[],
  missingCapabilities: string[] = [],
  executable = status === "supported",
  provenance?: MechanicProvenance,
): RuleRegistryEntry {
  const rulesetId = provenance?.rulesetId ?? rulesetFor(character);
  const evidenceSourceId = sourceFor(character);
  return {
    id: canonicalRuleId(rulesetId, kind, name),
    name,
    entityId,
    kind,
    rulesetId,
    sourceId: provenance?.sourceId ?? evidenceSourceId,
    sourceReference: provenance?.sourceReference ?? character.source.fileName ?? "Built-in ADaM sample",
    evidenceSourceId,
    evidenceReference: character.source.fileName ?? "Built-in ADaM sample",
    status,
    executable,
    components,
    missingCapabilities,
  };
}

function attackEntry(character: Character, attack: CharacterAttack): RuleRegistryEntry {
  const hasUnresolvedRider = (masteryPattern.test(attack.description ?? "") && !attack.mastery) || unresolvedPattern.test(attack.description ?? "");
  const components: MechanicComponent[] = ["targeting", "range", "attack-roll", "damage-roll"];
  if (attack.mastery === "sap") components.push("trigger", "duration");
  if (attack.mastery === "slow") components.push("trigger", "movement", "duration");
  return entry(
    character,
    "attack",
    attack.id,
    attack.name,
    hasUnresolvedRider ? "partial" : "supported",
    components,
    hasUnresolvedRider ? ["Weapon property or rider resolution"] : [],
    true,
  );
}

function spellComponents(spell: CharacterSpell): MechanicComponent[] {
  const components: MechanicComponent[] = ["targeting", "range"];
  if (spell.area) components.push("targeting");
  if (spell.attackBonus !== undefined) components.push("attack-roll");
  if (spell.save) components.push("saving-throw");
  if (spell.targetCreatureTypes?.length) components.push("creature-type");
  if (spell.hostileSaveAdvantage) components.push("advantage");
  if (spell.damage) components.push("damage-roll");
  if (spell.healing) components.push("healing-roll");
  if (spell.level > 0) components.push("resource-spend");
  if (spell.durationRounds) components.push("duration");
  if (spell.concentration) components.push("concentration");
  if (spell.effect?.modifiers?.outgoingAttacks) components.push("trigger", "attack-roll", "duration");
  if (spell.onHitEffect?.preventsHealing) components.push("trigger", "healing-prevention", "duration");
  if (spell.onHitEffect?.undeadTargetDisadvantageAgainstCaster) components.push("trigger", "attack-roll", "duration");
  if (spell.effect?.modifiers?.bonusActionDash) components.push("action-economy", "movement", "duration");
  if (spell.effect?.modifiers?.conditionImmunities) components.push("condition-immunity", "duration");
  if (spell.effect?.conditionGranted) components.push("condition", "duration");
  if (spell.effect?.endsWhenSourceHarmsTarget) components.push("trigger", "duration");
  if (spell.effect?.turnStartTemporaryHitPoints) components.push("trigger", "recurring-effect", "temporary-hit-points");
  if (spell.effect?.turnStartDamage) components.push("trigger", "recurring-effect", "damage-roll");
  if (spell.effect?.turnStartSave) components.push("saving-throw", "duration");
  if (spell.effect?.senseMagic) components.push("detection", "range", "duration");
  if (spell.effect?.rollBonus) components.push("ability-check", "dice-roll", "trigger", "duration");
  if (spell.pointEffect?.type === "lights") components.push("light", "movement", "duration");
  if (spell.pointEffect?.type === "damaging-hazard") components.push("targeting", "saving-throw", "damage-roll", "recurring-effect", "duration");
  if (spell.freeCastResourceName) components.push("resource-spend", "resource-recovery");
  if (spell.trigger) components.push("trigger", "action-economy");
  if (spell.triggeredDamage) components.push("damage-roll");
  const executableEffect = spell.effect && (
    spell.effect.modifiers?.outgoingAttacks
    || spell.effect.modifiers?.bonusActionDash
    || spell.effect.modifiers?.conditionImmunities
    || spell.effect.conditionGranted
    || spell.effect.modifiers?.preventsHarmingSource
    || spell.effect.temporaryHitPoints
    || spell.effect.turnStartTemporaryHitPoints
    || spell.effect.turnStartDamage
    || spell.effect.turnStartSave
    || spell.effect.senseMagic
    || spell.effect.rollBonus
  );
  if (spell.effect && !executableEffect) components.push("reference");
  return [...new Set(components)];
}

function spellEntry(character: Character, spell: CharacterSpell): RuleRegistryEntry {
  const blocked = Boolean(spell.unsupportedReason);
  const partial = Boolean(spell.missingCapabilities?.length);
  return entry(
    character,
    "spell",
    spell.id,
    spell.name,
    blocked || partial ? "partial" : "supported",
    spellComponents(spell),
    spell.unsupportedReason ? [spell.unsupportedReason] : spell.missingCapabilities ?? [],
    !blocked,
    spell.provenance,
  );
}

export function buildCharacterMechanicCoverage(character: Character): CharacterMechanicCoverage {
  const entries: RuleRegistryEntry[] = [
    ...(character.attacks ?? []).map((attack) => attackEntry(character, attack)),
    ...(character.spells ?? []).map((spell) => spellEntry(character, spell)),
    ...(character.resources ?? []).map((resource) => {
      const specialRecoveryMissing = resource.recovery === "special" && resource.shortRestRecovery === undefined && resource.longRestRecovery === undefined;
      return entry(
        character,
        "resource",
        resource.id,
        resource.name,
        specialRecoveryMissing ? "partial" : "supported",
        ["resource-spend", "resource-recovery"],
        specialRecoveryMissing ? ["Special recovery rule is not registered yet"] : [],
        true,
      );
    }),
    ...(character.profile?.features ?? []).map((feature, index) => {
      const executableAction = (character.featureActions ?? []).find((action) => action.id === feature.executableActionId);
      const executableTrigger = (character.triggeredFeatures ?? []).find((trigger) => trigger.id === feature.executableTriggerId);
      const executablePassive = (character.passiveFeatures ?? []).find((passive) => passive.id === feature.executablePassiveId);
      const executableAttacks = (feature.executableAttackIds ?? []).map((attackId) =>
        (character.attacks ?? []).find((attack) => attack.id === attackId)).filter((attack): attack is CharacterAttack => Boolean(attack));
      const attackMechanicExecutable = Boolean(feature.executableAttackIds?.length)
        && executableAttacks.length === feature.executableAttackIds?.length
        && executableAttacks.every((attack) => Boolean(attack.mastery));
      const executable = executableAction ?? executableTrigger ?? executablePassive;
      const unresolved = unresolvedPattern.test(feature.description);
      const components: MechanicComponent[] = executableAction?.resolution.type === "dash-and-temporary-hit-points"
        ? ["action-economy", "movement", "resource-spend", "resource-recovery", "temporary-hit-points"]
        : executableAction?.resolution.type === "healing-pool"
          ? ["action-economy", "targeting", "range", "resource-spend", "resource-recovery", "hit-point-restoration"]
        : executableAction?.resolution.type === "activate-effect"
          ? ["action-economy", "resource-spend", "resource-recovery", "duration", "damage-resistance"]
        : executableAction?.resolution.type === "sense-creature-types"
          ? ["action-economy", "resource-spend", "resource-recovery", "range", "duration", "creature-type", "detection"]
        : executableAction?.resolution.type === "area-saving-throw"
          ? ["action-economy", "targeting", "range", "saving-throw", "damage-roll", "resource-spend", "resource-recovery", ...(executableAction.resolution.area.pushFeetOnFailedSave ? ["movement" as const] : [])]
        : executableAction?.resolution.type === "grant-roll-bonus"
          ? ["action-economy", "targeting", "range", "dice-roll", "trigger", "duration", "resource-spend", "resource-recovery"]
        : executableAction?.resolution.type === "activate-large-form"
          ? ["action-economy", "size", "advantage", "movement", "duration", "resource-spend", "resource-recovery"]
        : executableTrigger?.resolution.type === "drop-to-one-hit-point"
          ? ["trigger", "replacement-effect", "resource-spend", "resource-recovery"]
          : executableTrigger?.resolution.type === "reduce-damage-by-roll"
            ? ["trigger", "reaction", "dice-roll", "damage-reduction", "resource-spend", "resource-recovery"]
          : executableTrigger?.resolution.type === "gain-temporary-hit-points"
            ? ["trigger", "temporary-hit-points"]
          : executablePassive?.resolution.type === "damage-resistance"
            ? ["damage-resistance"]
          : executablePassive?.resolution.type === "ancestry-defense"
            ? ["saving-throw", "advantage", "condition-immunity"]
          : executablePassive?.resolution.type === "unarmored-defense"
            ? ["armor-calculation"]
          : executablePassive?.resolution.type === "skill-proficiency"
            ? ["ability-check", "proficiency"]
          : executablePassive?.resolution.type === "free-spell-cast"
            ? ["resource-spend", "resource-recovery"]
          : executablePassive?.resolution.type === "rest-alternative"
            ? ["rest-alternative"]
          : executablePassive?.resolution.type === "weapon-damage-reroll"
            ? ["trigger", "damage-roll", "dice-roll"]
          : executablePassive?.resolution.type === "ability-check-reroll"
            ? ["ability-check", "trigger", "dice-roll", "resource-spend", "resource-recovery"]
          : attackMechanicExecutable && executableAttacks.some((attack) => attack.mastery === "slow")
            ? ["trigger", "damage-roll", "movement", "duration"]
          : attackMechanicExecutable && executableAttacks.some((attack) => attack.mastery === "sap")
            ? ["trigger", "attack-roll", "duration"]
        : ["reference"];
      const missingCapabilities = executable?.missingCapabilities ?? [];
      const isExecutable = Boolean(executable) || attackMechanicExecutable;
      return entry(
        character,
        "feature",
        feature.id ?? `feature-${index}-${slug(feature.name)}`,
        feature.name,
        isExecutable ? (missingCapabilities.length ? "partial" : "supported") : unresolved ? "partial" : "reference-only",
        components,
        isExecutable ? missingCapabilities : unresolved ? [feature.description] : ["No executable mechanic is registered yet"],
        isExecutable,
        feature.provenance ?? executable?.provenance,
      );
    }),
    ...(character.profile?.equipment ?? []).map((item, index) => {
      const equipmentRule = (character.equipmentRules ?? []).find((rule) => slug(rule.name) === slug(item.name));
      const attackReady = (character.attacks ?? []).some((attack) => slug(attack.name).includes(slug(item.name)) || slug(item.name).includes(slug(attack.name)));
      const equipmentComponents: MechanicComponent[] = equipmentRule?.resolution.type === "armor"
        ? ["inventory", "armor-calculation", "proficiency", ...(equipmentRule.resolution.strengthRequirement ? ["movement" as const] : []), ...(equipmentRule.resolution.stealthDisadvantage ? ["ability-check" as const] : [])]
        : equipmentRule?.resolution.type === "shield"
          ? ["inventory", "armor-calculation", "proficiency"]
          : equipmentRule?.resolution.type === "weapon" || equipmentRule?.resolution.type === "ammunition"
            ? ["inventory", "targeting", "range", "attack-roll", "damage-roll", ...(equipmentRule.resolution.expendOnAttackIds?.length ? ["resource-spend" as const] : [])]
          : equipmentRule?.resolution.type === "spellcasting-focus"
            ? ["inventory", "reference"]
          : equipmentRule?.resolution.type === "light-source"
            ? ["inventory", "action-economy", "light", "duration"]
          : ["inventory"];
      return entry(
        character,
        "equipment",
        `equipment-${index}-${slug(item.name)}`,
        item.name,
        equipmentRule ? "supported" : attackReady ? "partial" : "reference-only",
        equipmentComponents,
        equipmentRule ? [] : attackReady ? ["Inventory use beyond its registered attack"] : ["No executable equipment action is registered yet"],
        Boolean(equipmentRule),
        equipmentRule?.provenance,
      );
    }),
  ];
  const counts = { supported: 0, partial: 0, "reference-only": 0, "needs-review": 0 } satisfies CharacterMechanicCoverage["counts"];
  for (const mechanic of entries) counts[mechanic.status] += 1;
  return {
    characterId: character.id,
    rulesetId: rulesetFor(character),
    sourceId: sourceFor(character),
    counts,
    total: entries.length,
    executable: entries.filter((mechanic) => mechanic.executable).length,
    entries,
  };
}
