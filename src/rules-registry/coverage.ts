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
  const hasUnresolvedRider = masteryPattern.test(attack.description ?? "") || unresolvedPattern.test(attack.description ?? "");
  return entry(
    character,
    "attack",
    attack.id,
    attack.name,
    hasUnresolvedRider ? "partial" : "supported",
    ["targeting", "range", "attack-roll", "damage-roll"],
    hasUnresolvedRider ? ["Weapon property or rider resolution"] : [],
    true,
  );
}

function spellComponents(spell: CharacterSpell): MechanicComponent[] {
  const components: MechanicComponent[] = ["targeting", "range"];
  if (spell.attackBonus !== undefined) components.push("attack-roll");
  if (spell.save) components.push("saving-throw");
  if (spell.damage) components.push("damage-roll");
  if (spell.healing) components.push("healing-roll");
  if (spell.level > 0) components.push("resource-spend");
  if (spell.durationRounds) components.push("duration");
  if (spell.concentration) components.push("concentration");
  if (spell.effect) components.push("reference");
  return components;
}

function spellEntry(character: Character, spell: CharacterSpell): RuleRegistryEntry {
  return entry(
    character,
    "spell",
    spell.id,
    spell.name,
    spell.unsupportedReason ? "partial" : "supported",
    spellComponents(spell),
    spell.unsupportedReason ? [spell.unsupportedReason] : [],
    !spell.unsupportedReason,
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
      const executable = executableAction ?? executableTrigger;
      const unresolved = unresolvedPattern.test(feature.description);
      const components: MechanicComponent[] = executableAction?.resolution.type === "dash-and-temporary-hit-points"
        ? ["action-economy", "movement", "resource-spend", "resource-recovery", "temporary-hit-points"]
        : executableAction?.resolution.type === "healing-pool"
          ? ["action-economy", "targeting", "range", "resource-spend", "resource-recovery", "hit-point-restoration"]
        : executableAction?.resolution.type === "activate-effect"
          ? ["action-economy", "resource-spend", "resource-recovery", "duration", "damage-resistance"]
        : executableTrigger?.resolution.type === "drop-to-one-hit-point"
          ? ["trigger", "replacement-effect", "resource-spend", "resource-recovery"]
          : executableTrigger?.resolution.type === "reduce-damage-by-roll"
            ? ["trigger", "reaction", "dice-roll", "damage-reduction", "resource-spend", "resource-recovery"]
        : ["reference"];
      return entry(
        character,
        "feature",
        feature.id ?? `feature-${index}-${slug(feature.name)}`,
        feature.name,
        executable ? (executable.missingCapabilities?.length ? "partial" : "supported") : unresolved ? "partial" : "reference-only",
        components,
        executable ? executable.missingCapabilities ?? [] : unresolved ? [feature.description] : ["No executable mechanic is registered yet"],
        Boolean(executable),
        feature.provenance ?? executable?.provenance,
      );
    }),
    ...(character.profile?.equipment ?? []).map((item, index) => {
      const attackReady = (character.attacks ?? []).some((attack) => slug(attack.name).includes(slug(item.name)) || slug(item.name).includes(slug(attack.name)));
      return entry(character, "equipment", `equipment-${index}-${slug(item.name)}`, item.name, attackReady ? "partial" : "reference-only", ["inventory"], attackReady ? ["Inventory use beyond its registered attack"] : ["No executable equipment action is registered yet"], false);
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
