import type { EncounterState } from "../domain/combat";
import { rollDamage, type DamageRoll } from "./dice";
import { effectHasStarted, removeEffect } from "./effects";

export type RollBonusKind = "ability-check" | "attack-roll" | "saving-throw";

export function availableRollBonusEffects(encounter: EncounterState, combatantId: string, kind: RollBonusKind) {
  return encounter.effects.filter((effect) => effect.targetCombatantId === combatantId
    && effect.rollBonus?.appliesTo.includes(kind)
    && effectHasStarted(encounter, effect));
}

export function consumeRollBonus(encounter: EncounterState, combatantId: string, effectId: string, kind: RollBonusKind, random = Math.random):
  { legal: true; encounter: EncounterState; roll: DamageRoll } | { legal: false; encounter: EncounterState; reason: string } {
  const effect = availableRollBonusEffects(encounter, combatantId, kind).find((candidate) => candidate.id === effectId);
  if (!effect?.rollBonus) return { legal: false, encounter, reason: "That roll bonus is not available for this roll." };
  const roll = rollDamage(effect.rollBonus.die, { random });
  if (!roll) return { legal: false, encounter, reason: `ADaM could not read ${effect.rollBonus.die}.` };
  const next = effect.consumeOnRollBonus ? removeEffect(encounter, effect.id, "its roll bonus was used") : encounter;
  return { legal: true, encounter: next, roll };
}
