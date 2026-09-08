import type { EncounterState } from "../domain/combat";
import { applyDamageToCombatant } from "./combat-options";
import { rollD20, rollDamage } from "./dice";
import { effectHasStarted, effectiveDamageAmount, effectiveSavingThrowModifier, removeEffect, savingThrowRollMode } from "./effects";
import { queueConcentrationCheck } from "./defensive-responses";
import type { TurnStartEffectContinuation } from "../domain/combat";

export function resumeTurnStartEffect(encounter: EncounterState, continuation: TurnStartEffectContinuation, random = Math.random): EncounterState {
  const effect = encounter.effects.find((candidate) => candidate.id === continuation.effectId);
  const target = encounter.combatants.find((combatant) => combatant.id === continuation.combatantId);
  let next: EncounterState = { ...encounter, pendingResponse: null };
  if (!effect || !target) return next;
  if (effect.turnStartSave) {
    const modifier = effectiveSavingThrowModifier(next, target.id, effect.turnStartSave.ability);
    const save = rollD20({ mode: savingThrowRollMode(next, target.id, undefined, "normal", effect.turnStartSave.ability), modifier, random });
    const succeeded = save.total >= effect.turnStartSave.dc;
    next = { ...next, log: [`${target.name} rolls ${save.total} against ${effect.name}'s DC ${effect.turnStartSave.dc} ${effect.turnStartSave.ability} save and ${succeeded ? "succeeds" : "fails"}.`, ...next.log] };
    if (succeeded && effect.turnStartSave.endsOnSuccess) next = removeEffect(next, effect.id, "the saving throw succeeded");
  }
  return continuation.damageTaken > 0 ? queueConcentrationCheck(next, target.id, continuation.damageTaken) : next;
}

export function resolveTurnStartEffects(encounter: EncounterState, combatantId: string, random = Math.random): EncounterState {
  const target = encounter.combatants.find((combatant) => combatant.id === combatantId);
  if (!target) return encounter;
  let next = encounter;
  const effects = encounter.effects.filter((effect) => effect.targetCombatantId === combatantId && effectHasStarted(encounter, effect));

  for (const effect of effects) {
    let damageApplied = 0;
    if (effect.turnStartTemporaryHitPoints) {
      const amount = effect.turnStartTemporaryHitPoints;
      const current = next.combatants.find((combatant) => combatant.id === combatantId)?.temporaryHitPoints ?? 0;
      next = {
        ...next,
        combatants: next.combatants.map((combatant) => combatant.id === combatantId && amount > combatant.temporaryHitPoints
          ? { ...combatant, temporaryHitPoints: amount, temporaryHitPointsSourceEffectId: undefined }
          : combatant),
        log: [`${effect.name} gives ${target.name} ${Math.max(current, amount)} temporary hit points.`, ...next.log],
      };
    }

    if (effect.turnStartDamage) {
      const damageRoll = rollDamage(effect.turnStartDamage, { random });
      if (!damageRoll) continue;
      const applied = effectiveDamageAmount(next, combatantId, damageRoll.total, damageRoll.formula.damageType);
      damageApplied = applied;
      next = applyDamageToCombatant(next, combatantId, damageRoll.total, {
        damageType: damageRoll.formula.damageType,
        sourceCombatantId: effect.sourceCombatantId,
      });
      next = { ...next, log: [`${effect.name} deals ${applied} ${damageRoll.formula.damageType} damage to ${target.name}.`, ...next.log] };
      if (next.pendingResponse?.type === "damage-reduction-reaction" || next.pendingResponse?.type === "zero-hit-point-replacement") {
        const turnStartContinuation = { effectId: effect.id, combatantId, damageTaken: applied };
        return { ...next, pendingResponse: { ...next.pendingResponse, turnStartContinuation } };
      }
    }

    if (effect.turnStartSave || damageApplied > 0) next = resumeTurnStartEffect(next, { effectId: effect.id, combatantId, damageTaken: damageApplied }, random);
  }
  return next;
}
