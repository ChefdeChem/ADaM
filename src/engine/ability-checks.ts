import type { EncounterState } from "../domain/combat";
import { rollD20, type D20Result, type RollMode } from "./dice";
import type { DamageRoll } from "./dice";
import { abilityCheckRollMode } from "./effects";
import { spendNamedResource, validateNamedResource } from "./resources";
import { consumeRollBonus } from "./roll-bonuses";

export function abilityCheckModifier(encounter: EncounterState, combatantId: string, skill: string): number {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  return combatant?.skillModifiers[skill.toLowerCase()] ?? 0;
}

export type AbilityCheckResolution = {
  encounter: EncounterState;
  roll: D20Result;
  proficient: boolean;
  bonusRoll?: DamageRoll;
  reroll?: D20Result;
  total: number;
  succeeded?: boolean;
  summary: string;
};

export function resolveAbilityCheck(
  encounter: EncounterState,
  combatantId: string,
  skill: string,
  options: { dc?: number; rollBonusEffectId?: string; rerollFeatureId?: string; situationalMode?: RollMode; random?: () => number } = {},
): AbilityCheckResolution | null {
  const random = options.random ?? Math.random;
  const base = rollAbilityCheck(encounter, combatantId, skill, random, options.situationalMode ?? "normal");
  if (!base) return null;
  let next = encounter;
  let total = base.roll.total;
  let bonusRoll: DamageRoll | undefined;
  if (options.rollBonusEffectId) {
    const bonus = consumeRollBonus(next, combatantId, options.rollBonusEffectId, "ability-check", random);
    if (bonus.legal) {
      bonusRoll = bonus.roll;
      total += bonusRoll.total;
      next = bonus.encounter;
    }
  }

  let reroll: D20Result | undefined;
  const failed = options.dc !== undefined && total < options.dc;
  const combatant = next.combatants.find((candidate) => candidate.id === combatantId);
  const rerollFeature = options.rerollFeatureId
    ? combatant?.abilityCheckRerolls.find((feature) => feature.featureId === options.rerollFeatureId
      && feature.skills.some((candidate) => candidate.toLowerCase() === skill.toLowerCase()))
    : undefined;
  if (failed && rerollFeature && validateNamedResource(next, combatantId, rerollFeature.resourceName, 1).legal) {
    reroll = rollD20({
      mode: abilityCheckRollMode(next, combatantId, skill, options.situationalMode ?? "normal"),
      modifier: abilityCheckModifier(next, combatantId, skill),
      random,
    });
    if (reroll.total >= options.dc!) {
      total = reroll.total;
      next = spendNamedResource(next, combatantId, rerollFeature.resourceName, 1);
    }
  }
  const succeeded = options.dc === undefined ? undefined : total >= options.dc;
  const summary = `${combatant?.name ?? combatantId} rolled ${total} for ${skill}${options.dc === undefined ? "" : ` against DC ${options.dc}: ${succeeded ? "success" : "failure"}`}.`;
  return { encounter: { ...next, log: [summary, ...next.log] }, roll: base.roll, proficient: base.proficient, bonusRoll, reroll, total, succeeded, summary };
}

export function rollAbilityCheck(
  encounter: EncounterState,
  combatantId: string,
  skill: string,
  random = Math.random,
  situationalMode: RollMode = "normal",
): { roll: D20Result; proficient: boolean } | null {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant) return null;
  return {
    roll: rollD20({
      mode: abilityCheckRollMode(encounter, combatantId, skill, situationalMode),
      modifier: abilityCheckModifier(encounter, combatantId, skill),
      random,
    }),
    proficient: combatant.skillProficiencies.includes(skill.toLowerCase()),
  };
}
