import type { ActiveEffect, EffectModifiers, EncounterState } from "../domain/combat";

export type EffectInput = {
  name: string;
  description: string;
  sourceCombatantId: string;
  targetCombatantId: string;
  durationRounds?: number;
  concentration?: boolean;
  modifiers?: EffectModifiers;
  temporaryHitPoints?: number;
};

function cleanExpiredTemporaryHitPoints(encounter: EncounterState, effectIds: Set<string>): EncounterState {
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => effectIds.has(combatant.temporaryHitPointsSourceEffectId ?? "")
      ? { ...combatant, temporaryHitPoints: 0, temporaryHitPointsSourceEffectId: undefined }
      : combatant),
  };
}

export function applyEffect(encounter: EncounterState, input: EffectInput): EncounterState {
  const concentrationIds = new Set(encounter.effects
    .filter((effect) => input.concentration && effect.concentration && effect.sourceCombatantId === input.sourceCombatantId)
    .map((effect) => effect.id));
  let next = cleanExpiredTemporaryHitPoints(encounter, concentrationIds);
  const retainedEffects = next.effects.filter((effect) => !concentrationIds.has(effect.id));
  const safeId = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const id = `${safeId}-${encounter.round}-${input.sourceCombatantId}-${retainedEffects.length + 1}`;
  const effect: ActiveEffect = {
    id,
    name: input.name,
    description: input.description,
    sourceCombatantId: input.sourceCombatantId,
    targetCombatantId: input.targetCombatantId,
    concentration: input.concentration ?? false,
    modifiers: input.modifiers ?? {},
    expiresAt: input.durationRounds
      ? { round: encounter.round + input.durationRounds, combatantId: input.sourceCombatantId, phase: "start" }
      : undefined,
    temporaryHitPointsGranted: input.temporaryHitPoints,
  };

  next = {
    ...next,
    effects: [...retainedEffects, effect],
    log: [
      `${input.name} applied${input.durationRounds ? ` for ${input.durationRounds} round${input.durationRounds === 1 ? "" : "s"}` : ""}.`,
      ...(concentrationIds.size ? ["Previous concentration ended."] : []),
      ...next.log,
    ],
  };

  if (input.temporaryHitPoints) {
    next = {
      ...next,
      combatants: next.combatants.map((combatant) => combatant.id === input.targetCombatantId && input.temporaryHitPoints! > combatant.temporaryHitPoints
        ? { ...combatant, temporaryHitPoints: input.temporaryHitPoints!, temporaryHitPointsSourceEffectId: id }
        : combatant),
    };
  }
  return next;
}

export function expireEffectsAtTurnStart(encounter: EncounterState, round: number, combatantId: string): EncounterState {
  const expired = encounter.effects.filter((effect) => effect.expiresAt && (
    effect.expiresAt.round < round
    || (effect.expiresAt.round === round && effect.expiresAt.combatantId === combatantId)
  ));
  if (!expired.length) return encounter;
  const expiredIds = new Set(expired.map((effect) => effect.id));
  const cleaned = cleanExpiredTemporaryHitPoints(encounter, expiredIds);
  return {
    ...cleaned,
    effects: cleaned.effects.filter((effect) => !expiredIds.has(effect.id)),
    log: [...expired.map((effect) => `${effect.name} expired.`), ...cleaned.log],
  };
}

export function effectsForCombatant(encounter: EncounterState, combatantId: string): ActiveEffect[] {
  return encounter.effects.filter((effect) => effect.targetCombatantId === combatantId);
}

export function effectiveArmorClass(encounter: EncounterState, combatantId: string): number {
  const combatant = encounter.combatants.find((item) => item.id === combatantId);
  if (!combatant) return 0;
  return combatant.baseArmorClass + effectsForCombatant(encounter, combatantId)
    .reduce((total, effect) => total + (effect.modifiers.armorClass ?? 0), 0);
}

export function effectiveAttackModifier(encounter: EncounterState, combatantId: string): number {
  return effectsForCombatant(encounter, combatantId)
    .reduce((total, effect) => total + (effect.modifiers.attackRolls ?? 0), 0);
}

export function effectiveSpeed(encounter: EncounterState, combatantId: string): number {
  const combatant = encounter.combatants.find((item) => item.id === combatantId);
  if (!combatant) return 0;
  return Math.max(0, combatant.baseSpeedFeet + effectsForCombatant(encounter, combatantId)
    .reduce((total, effect) => total + (effect.modifiers.speedFeet ?? 0), 0));
}

export function remainingEffectRounds(encounter: EncounterState, effect: ActiveEffect): number | null {
  return effect.expiresAt ? Math.max(0, effect.expiresAt.round - encounter.round) : null;
}

export const minutesToRounds = (minutes: number) => Math.ceil(minutes * 10);
