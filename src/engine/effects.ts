import type { AbilityName } from "../domain/character";
import type { ActiveEffect, EffectModifiers, EncounterState } from "../domain/combat";
import type { RollMode } from "./dice";

export type EffectInput = {
  name: string;
  description: string;
  sourceCombatantId: string;
  targetCombatantId: string;
  durationRounds?: number;
  concentration?: boolean;
  modifiers?: EffectModifiers;
  temporaryHitPoints?: number;
  expiresAt?: ActiveEffect["expiresAt"];
  consumeOnAttackRoll?: boolean;
  attackTargetId?: string;
  startsAt?: ActiveEffect["startsAt"];
  turnStartTemporaryHitPoints?: number;
  turnStartDamage?: string;
  turnStartSave?: ActiveEffect["turnStartSave"];
  conditionGranted?: string;
  endsWhenSourceHarmsTarget?: boolean;
  sense?: ActiveEffect["sense"];
  replaceExisting?: boolean;
};

function cleanRemovedEffectState(encounter: EncounterState, effectIds: Set<string>): EncounterState {
  const removedEffects = encounter.effects.filter((effect) => effectIds.has(effect.id));
  const retainedEffects = encounter.effects.filter((effect) => !effectIds.has(effect.id));
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => {
      const removedConditions = new Set(removedEffects
        .filter((effect) => effect.targetCombatantId === combatant.id && effect.conditionGranted)
        .map((effect) => effect.conditionGranted!.toLowerCase()));
      const retainedConditions = new Set(retainedEffects
        .filter((effect) => effect.targetCombatantId === combatant.id && effect.conditionGranted)
        .map((effect) => effect.conditionGranted!.toLowerCase()));
      const withoutExpiredConditions = (combatant.conditions ?? []).filter((condition) =>
        !removedConditions.has(condition.toLowerCase()) || retainedConditions.has(condition.toLowerCase()));
      return effectIds.has(combatant.temporaryHitPointsSourceEffectId ?? "")
        ? { ...combatant, conditions: withoutExpiredConditions, temporaryHitPoints: 0, temporaryHitPointsSourceEffectId: undefined }
        : { ...combatant, conditions: withoutExpiredConditions };
    }),
  };
}

export function applyEffect(encounter: EncounterState, input: EffectInput): EncounterState {
  const concentrationIds = new Set(encounter.effects
    .filter((effect) => input.concentration && effect.concentration && effect.sourceCombatantId === input.sourceCombatantId)
    .map((effect) => effect.id));
  const replacementIds = new Set(encounter.effects
    .filter((effect) => input.replaceExisting
      && effect.name === input.name
      && effect.targetCombatantId === input.targetCombatantId)
    .map((effect) => effect.id));
  const removedIds = new Set([...concentrationIds, ...replacementIds]);
  let next = cleanRemovedEffectState(encounter, removedIds);
  const retainedEffects = next.effects.filter((effect) => !removedIds.has(effect.id));
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
    expiresAt: input.expiresAt ?? (input.durationRounds
      ? { round: encounter.round + input.durationRounds, combatantId: input.sourceCombatantId, phase: "start" }
      : undefined),
    temporaryHitPointsGranted: input.temporaryHitPoints,
    consumeOnAttackRoll: input.consumeOnAttackRoll,
    attackTargetId: input.attackTargetId,
    startsAt: input.startsAt,
    turnStartTemporaryHitPoints: input.turnStartTemporaryHitPoints,
    turnStartDamage: input.turnStartDamage,
    turnStartSave: input.turnStartSave,
    conditionGranted: input.conditionGranted,
    endsWhenSourceHarmsTarget: input.endsWhenSourceHarmsTarget,
    sense: input.sense,
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
  if (input.modifiers?.conditionImmunities?.length) {
    const immunities = new Set(input.modifiers.conditionImmunities.map((condition) => condition.toLowerCase()));
    next = {
      ...next,
      combatants: next.combatants.map((combatant) => combatant.id === input.targetCombatantId
        ? { ...combatant, conditions: combatant.conditions.filter((condition) => !immunities.has(condition.toLowerCase())) }
        : combatant),
    };
  }
  if (input.conditionGranted) {
    const normalizedCondition = input.conditionGranted.toLowerCase();
    const target = next.combatants.find((combatant) => combatant.id === input.targetCombatantId);
    const effectImmunities = effectsForCombatant(next, input.targetCombatantId)
      .flatMap((activeEffect) => activeEffect.modifiers.conditionImmunities ?? []);
    const isImmune = [...(target?.conditionImmunities ?? []), ...effectImmunities]
      .some((condition) => condition.toLowerCase() === normalizedCondition);
    if (!isImmune) {
      next = {
        ...next,
        combatants: next.combatants.map((combatant) => combatant.id === input.targetCombatantId
          && !(combatant.conditions ?? []).some((condition) => condition.toLowerCase() === normalizedCondition)
          ? { ...combatant, conditions: [...(combatant.conditions ?? []), input.conditionGranted!] }
          : combatant),
      };
    }
  }
  return next;
}

export function expireEffectsAtTurnStart(encounter: EncounterState, round: number, combatantId: string): EncounterState {
  const expired = encounter.effects.filter((effect) => effect.expiresAt && (
    effect.expiresAt.round < round
    || (effect.expiresAt.phase === "start" && effect.expiresAt.round === round && effect.expiresAt.combatantId === combatantId)
  ));
  if (!expired.length) return encounter;
  const expiredIds = new Set(expired.map((effect) => effect.id));
  const cleaned = cleanRemovedEffectState(encounter, expiredIds);
  return {
    ...cleaned,
    effects: cleaned.effects.filter((effect) => !expiredIds.has(effect.id)),
    log: [...expired.map((effect) => `${effect.name} expired.`), ...cleaned.log],
  };
}

export function expireEffectsAtTurnEnd(encounter: EncounterState, round: number, combatantId: string): EncounterState {
  const expired = encounter.effects.filter((effect) => effect.expiresAt?.phase === "end" && (
    effect.expiresAt.round < round
    || (effect.expiresAt.round === round && effect.expiresAt.combatantId === combatantId)
  ));
  if (!expired.length) return encounter;
  const expiredIds = new Set(expired.map((effect) => effect.id));
  const cleaned = cleanRemovedEffectState(encounter, expiredIds);
  return {
    ...cleaned,
    effects: cleaned.effects.filter((effect) => !expiredIds.has(effect.id)),
    log: [...expired.map((effect) => `${effect.name} expired.`), ...cleaned.log],
  };
}

export function effectsForCombatant(encounter: EncounterState, combatantId: string): ActiveEffect[] {
  return encounter.effects.filter((effect) => effect.targetCombatantId === combatantId);
}

export function effectHasStarted(encounter: EncounterState, effect: ActiveEffect): boolean {
  if (!effect.startsAt) return true;
  if (encounter.round > effect.startsAt.round) return true;
  if (encounter.round < effect.startsAt.round) return false;
  const active = encounter.combatants[encounter.activeIndex];
  return active?.id === effect.startsAt.combatantId;
}

export function nextTurnRound(encounter: EncounterState, combatantId: string): number {
  const combatantIndex = encounter.combatants.findIndex((combatant) => combatant.id === combatantId);
  return combatantIndex > encounter.activeIndex ? encounter.round : encounter.round + 1;
}

export function hasOutgoingAttackDisadvantage(encounter: EncounterState, combatantId: string): boolean {
  return outgoingAttackRollMode(encounter, combatantId) === "disadvantage";
}

export function outgoingAttackRollMode(encounter: EncounterState, combatantId: string, targetId?: string, situationalMode: RollMode = "normal"): RollMode {
  const modifiers = effectsForCombatant(encounter, combatantId)
    .filter((effect) => effectHasStarted(encounter, effect) && (!effect.attackTargetId || effect.attackTargetId === targetId))
    .map((effect) => effect.modifiers.outgoingAttacks)
    .filter((mode): mode is "advantage" | "disadvantage" => Boolean(mode));
  const hasAdvantage = situationalMode === "advantage" || modifiers.includes("advantage");
  const hasDisadvantage = situationalMode === "disadvantage" || modifiers.includes("disadvantage");
  if (hasAdvantage && hasDisadvantage) return "normal";
  if (hasAdvantage) return "advantage";
  if (hasDisadvantage) return "disadvantage";
  return "normal";
}

export function consumeAttackRollEffects(encounter: EncounterState, combatantId: string, targetId?: string): EncounterState {
  const consumed = encounter.effects.filter((effect) => effect.targetCombatantId === combatantId
    && effect.consumeOnAttackRoll
    && effectHasStarted(encounter, effect)
    && (!effect.attackTargetId || effect.attackTargetId === targetId));
  if (!consumed.length) return encounter;
  const consumedIds = new Set(consumed.map((effect) => effect.id));
  const cleaned = cleanRemovedEffectState(encounter, consumedIds);
  return {
    ...cleaned,
    effects: cleaned.effects.filter((effect) => !consumedIds.has(effect.id)),
    log: [...consumed.map((effect) => `${effect.name} was consumed by ${combatantId}'s attack roll.`), ...cleaned.log],
  };
}

export function removeEffect(encounter: EncounterState, effectId: string, reason?: string): EncounterState {
  const effect = encounter.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return encounter;
  const cleaned = cleanRemovedEffectState(encounter, new Set([effectId]));
  return {
    ...cleaned,
    effects: cleaned.effects.filter((candidate) => candidate.id !== effectId),
    log: reason ? [`${effect.name} ended: ${reason}.`, ...cleaned.log] : cleaned.log,
  };
}

export function canRegainHitPoints(encounter: EncounterState, combatantId: string): boolean {
  return !effectsForCombatant(encounter, combatantId)
    .some((effect) => effectHasStarted(encounter, effect) && effect.modifiers.healingPrevented);
}

export function canHarmTarget(encounter: EncounterState, sourceCombatantId: string, targetCombatantId: string): boolean {
  return !effectsForCombatant(encounter, sourceCombatantId).some((effect) =>
    effectHasStarted(encounter, effect)
    && effect.modifiers.preventsHarmingSource
    && effect.sourceCombatantId === targetCombatantId);
}

export function endEffectsBrokenByHarm(encounter: EncounterState, sourceCombatantId: string, targetCombatantId: string): EncounterState {
  const harmfulSource = encounter.combatants.find((combatant) => combatant.id === sourceCombatantId);
  const broken = encounter.effects.filter((effect) => {
    const effectSource = encounter.combatants.find((combatant) => combatant.id === effect.sourceCombatantId);
    return effect.endsWhenSourceHarmsTarget
      && effect.targetCombatantId === targetCombatantId
      && harmfulSource?.side === effectSource?.side;
  });
  return broken.reduce((next, effect) => removeEffect(next, effect.id, `${next.combatants.find((combatant) => combatant.id === sourceCombatantId)?.name ?? "the source"} harmed the target`), encounter);
}

export function savingThrowRollMode(encounter: EncounterState, combatantId: string, condition?: string, situationalMode: RollMode = "normal", ability?: AbilityName): RollMode {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const hasAdvantage = situationalMode === "advantage" || Boolean(condition && combatant?.savingThrowAdvantagesAgainstConditions
    .some((candidate) => candidate.toLowerCase() === condition.toLowerCase()));
  const hasDisadvantage = situationalMode === "disadvantage" || Boolean(ability && combatant?.savingThrowDisadvantages?.includes(ability));
  if (hasAdvantage && hasDisadvantage) return "normal";
  if (hasAdvantage) return "advantage";
  if (hasDisadvantage) return "disadvantage";
  return "normal";
}

export function abilityCheckRollMode(encounter: EncounterState, combatantId: string, check: string, situationalMode: RollMode = "normal"): RollMode {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const hasDisadvantage = situationalMode === "disadvantage" || Boolean(combatant?.abilityCheckDisadvantages?.some((candidate) => candidate.toLowerCase() === check.toLowerCase()));
  if (situationalMode === "advantage" && hasDisadvantage) return "normal";
  if (situationalMode === "advantage") return "advantage";
  if (hasDisadvantage) return "disadvantage";
  return "normal";
}

export function hasBonusActionDash(encounter: EncounterState, combatantId: string): boolean {
  return effectsForCombatant(encounter, combatantId)
    .some((effect) => effectHasStarted(encounter, effect) && effect.modifiers.bonusActionDash);
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

export function effectiveSavingThrowModifier(encounter: EncounterState, combatantId: string, ability: AbilityName): number {
  const combatant = encounter.combatants.find((item) => item.id === combatantId);
  if (!combatant) return 0;
  return combatant.savingThrowModifiers[ability] + effectsForCombatant(encounter, combatantId)
    .reduce((total, effect) => total + (effect.modifiers.savingThrows ?? 0), 0);
}

export function effectiveDamageAmount(encounter: EncounterState, combatantId: string, amount: number, damageType?: string): number {
  if (!damageType || amount <= 0) return amount;
  const normalizedType = damageType.trim().toLowerCase();
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const resisted = combatant?.damageResistances?.some((type) => type.toLowerCase() === normalizedType)
    || effectsForCombatant(encounter, combatantId).some((effect) =>
      effect.modifiers.damageResistances?.some((type) => type.toLowerCase() === normalizedType));
  return resisted ? Math.floor(amount / 2) : amount;
}

export function endConcentration(encounter: EncounterState, sourceCombatantId: string, reason: string): EncounterState {
  const ended = encounter.effects.filter((effect) => effect.concentration && effect.sourceCombatantId === sourceCombatantId);
  if (!ended.length) return encounter;
  const endedIds = new Set(ended.map((effect) => effect.id));
  const cleaned = cleanRemovedEffectState(encounter, endedIds);
  return {
    ...cleaned,
    effects: cleaned.effects.filter((effect) => !endedIds.has(effect.id)),
    log: [`Concentration ended: ${reason}.`, ...cleaned.log],
  };
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
