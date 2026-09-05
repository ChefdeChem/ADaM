import type { EncounterState } from "../domain/combat";
import { applyDamageToCombatant } from "./combat-options";
import { rollD20, rollDamage } from "./dice";
import { effectHasStarted, effectiveDamageAmount, effectiveSavingThrowModifier, removeEffect, savingThrowRollMode } from "./effects";
import { queueConcentrationCheck } from "./defensive-responses";

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
      const updatedTarget = next.combatants.find((combatant) => combatant.id === combatantId);
      if (!updatedTarget || updatedTarget.hitPoints.current <= 0 || next.pendingResponse) continue;
    }

    if (effect.turnStartSave) {
      const modifier = effectiveSavingThrowModifier(next, combatantId, effect.turnStartSave.ability);
      const save = rollD20({ mode: savingThrowRollMode(next, combatantId, undefined, "normal", effect.turnStartSave.ability), modifier, random });
      const succeeded = save.total >= effect.turnStartSave.dc;
      next = {
        ...next,
        log: [`${target.name} rolls ${save.total} against ${effect.name}'s DC ${effect.turnStartSave.dc} ${effect.turnStartSave.ability} save and ${succeeded ? "succeeds" : "fails"}.`, ...next.log],
      };
      if (succeeded && effect.turnStartSave.endsOnSuccess) next = removeEffect(next, effect.id, "the saving throw succeeded");
    }
    if (damageApplied > 0 && !next.pendingResponse) next = queueConcentrationCheck(next, combatantId, damageApplied);
  }
  return next;
}
