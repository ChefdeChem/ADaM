import type { Character } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import { canRegainHitPoints, endConcentration, removeEffect } from "./effects";
import { rollDamage } from "./dice";
import { recoverRestResources, type RestType } from "./resources";

/** Safe, uninterrupted post-encounter downtime. This is simulated time, not wall-clock waiting. */
export function completeSurinaRest(encounter: EncounterState, source: Character, type: RestType, spendHitDie = false, random = Math.random) {
  const actor = encounter.combatants.find((c) => c.id === source.id);
  const denied = (reason: string) => ({ legal: false as const, reason, encounter });
  if (source.id !== "surina-daardendrian" || source.className !== "Paladin" || source.level !== 1) return denied("Full rest recovery is currently verified for level-one Surina only.");
  if (!actor || actor.hitPoints.current < 1 || actor.deathSaves.failures >= 3) return denied("You must have at least 1 HP to begin a rest.");
  if (encounter.pendingResponse || encounter.combatants.some((c) => c.side === "enemy" && c.hitPoints.current > 0)) return denied("Finish combat and resolve pending choices before resting.");
  if (actor.conditions.some((c) => ["petrified", "paralyzed", "unconscious"].includes(c.toLowerCase()))) return denied("Resolve the preventing condition before choosing safe downtime.");
  const recovery = encounter.recoveryState ?? source.recoveryState ?? { hitDiceRemaining: 1, elapsedMinutes: 0 };
  if (spendHitDie && (type !== "short-rest" || recovery.hitDiceRemaining < 1)) return denied("No Hit Die is available for this Short Rest.");
  const waitMinutes = type === "long-rest" && recovery.lastLongRestEnd !== undefined ? Math.max(0, recovery.lastLongRestEnd + 960 - recovery.elapsedMinutes) : 0;
  const minutes = waitMinutes + (type === "long-rest" ? 480 : 60);
  let next = encounter;
  // Active recurring damage cannot be skipped by declaring safe rest.
  if (next.effects.some((e) => e.targetCombatantId === actor.id && (e.turnStartDamage || e.pointEffect?.type === "damaging-hazard"))) return denied("Resolve ongoing damage before resting.");
  if (type === "long-rest") next = endConcentration(next, actor.id, "sleep during Long Rest");
  for (const effect of next.effects) if (effect.expiresAt && effect.expiresAt.round <= encounter.round + minutes * 10) next = removeEffect(next, effect.id, "duration elapsed during downtime");
  if (!canRegainHitPoints(next, actor.id)) return denied("A remaining effect prevents healing; resolve it before rest recovery.");
  const recovered = recoverRestResources(next, actor.id, type);
  if (!recovered.legal) return denied(recovered.reason);
  next = recovered.encounter;
  const roll = spendHitDie ? rollDamage("1d10", { random }) : null;
  const healing = type === "long-rest" ? actor.hitPoints.maximum - actor.hitPoints.current : roll ? Math.max(1, roll.total + actor.abilityModifiers.constitution) : 0;
  const recoveryState = { ...recovery, elapsedMinutes: recovery.elapsedMinutes + minutes,
    hitDiceRemaining: type === "long-rest" ? 1 : recovery.hitDiceRemaining - (spendHitDie ? 1 : 0),
    lastLongRestEnd: type === "long-rest" ? recovery.elapsedMinutes + minutes : recovery.lastLongRestEnd };
  const summary = `${type === "long-rest" ? "Long" : "Short"} Rest completed after ${minutes} simulated minutes${waitMinutes ? ` (${waitMinutes} waiting before rest)` : ""}. Recovered ${Math.min(healing, actor.hitPoints.maximum - actor.hitPoints.current)} HP. ${recovered.summary}`;
  next = { ...next, round: encounter.round + minutes * 10, recoveryState, combatants: next.combatants.map((c) => c.id === actor.id ? { ...c, hitPoints: { ...c.hitPoints, current: Math.min(c.hitPoints.maximum, c.hitPoints.current + healing) }, temporaryHitPoints: type === "long-rest" ? 0 : c.temporaryHitPoints, temporaryHitPointsSourceEffectId: type === "long-rest" ? undefined : c.temporaryHitPointsSourceEffectId } : c), log: [summary, ...next.log] };
  return { legal: true as const, encounter: next, roll, summary };
}
