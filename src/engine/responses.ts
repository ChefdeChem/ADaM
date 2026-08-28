import type { EncounterState } from "../domain/combat";
import { applyDamageToCombatant, resolveAttackDamage, resolveReactionAttackRoll } from "./combat-options";
import { rollD20, rollDamage, type D20Result, type DamageRoll } from "./dice";
import { applyEffect, effectiveSavingThrowModifier, endConcentration } from "./effects";
import { queueConcentrationCheck } from "./defensive-responses";
import { spendSpellSlot, validateSpellSlot } from "./resources";
import { resumeMovementContinuation } from "./movement";

export { queueConcentrationCheck } from "./defensive-responses";

export type PlayerResponseResolution = {
  encounter: EncounterState;
  playerRoll: D20Result | null;
  damageRoll: DamageRoll | null;
  summary: string;
};

export function resolveSavingThrowResponse(encounter: EncounterState, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "saving-throw") return { encounter, playerRoll: null, damageRoll: null, summary: "No saving throw is pending." };
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId);
  if (!target || !source) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The saving throw can no longer be resolved." };
  const modifier = effectiveSavingThrowModifier(encounter, target.id, pending.ability.saveAbility);
  const playerRoll = rollD20({ mode: "normal", modifier, random });
  const succeeded = playerRoll.total >= pending.ability.saveDc;
  const damageRoll = rollDamage(pending.ability.damage, { random });
  if (!damageRoll) return { encounter: { ...encounter, pendingResponse: null }, playerRoll, damageRoll: null, summary: `ADaM could not read ${pending.ability.name}'s damage formula.` };
  const damage = succeeded
    ? pending.ability.damageOnSuccess === "half" ? Math.floor(damageRoll.total / 2) : 0
    : damageRoll.total;
  let next = applyDamageToCombatant({ ...encounter, pendingResponse: null }, target.id, damage);
  const saveSummary = `${target.name} rolls ${playerRoll.kept} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${playerRoll.total} vs DC ${pending.ability.saveDc} — ${succeeded ? "success" : "failure"}.`;
  const damageSummary = `${source.name}'s ${pending.ability.name} rolls ${damageRoll.rolls.join(" + ")}${damageRoll.modifier ? ` ${damageRoll.modifier > 0 ? "+" : "−"} ${Math.abs(damageRoll.modifier)}` : ""} = ${damageRoll.total}; ${damage} damage applied.`;
  next = { ...next, log: [damageSummary, saveSummary, ...next.log] };
  next = queueConcentrationCheck(next, target.id, damage);
  return { encounter: next, playerRoll, damageRoll, summary: `${saveSummary} ${damageSummary}` };
}

export function resolveAttackReaction(encounter: EncounterState, reactionId: string | null, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "attack-reaction") return { encounter, playerRoll: null, damageRoll: null, summary: "No attack reaction is pending." };
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  if (!target) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The reaction target is no longer available." };
  let next: EncounterState = { ...encounter, pendingResponse: null };
  let reactionSummary = `${target.name} takes no reaction.`;
  if (reactionId) {
    const option = target.reactionOptions.find((candidate) => candidate.id === reactionId && pending.availableReactionIds.includes(candidate.id));
    if (!option || !target.reactionAvailable) return { encounter, playerRoll: null, damageRoll: null, summary: "That reaction is unavailable." };
    if (option.spellLevel) {
      const slot = validateSpellSlot(next, target.id, option.spellLevel);
      if (!slot.legal) return { encounter, playerRoll: null, damageRoll: null, summary: slot.reason ?? "The required spell slot is unavailable." };
      next = spendSpellSlot(next, target.id, option.spellLevel);
    }
    next = applyEffect(next, {
      name: option.name,
      description: option.description,
      sourceCombatantId: target.id,
      targetCombatantId: target.id,
      durationRounds: 1,
      modifiers: { armorClass: option.armorClassBonus },
    });
    next = { ...next, combatants: next.combatants.map((combatant) => combatant.id === target.id ? { ...combatant, reactionAvailable: false } : combatant) };
    const defendedArmorClass = pending.targetArmorClass + option.armorClassBonus;
    const prevented = !pending.critical && pending.attackNatural !== 20 && pending.attackTotal < defendedArmorClass;
    reactionSummary = `${target.name} uses ${option.name}, raising AC to ${defendedArmorClass}${prevented ? " and turning the hit into a miss" : ", but the attack still hits"}.`;
    next = { ...next, log: [reactionSummary, ...next.log] };
    if (prevented) {
      const resumed = pending.continuation && target.hitPoints.current > 0 ? resumeMovementContinuation(next, pending.continuation, random) : null;
      return { encounter: resumed?.encounter ?? next, playerRoll: null, damageRoll: resumed?.damageRoll ?? null, summary: `${reactionSummary}${resumed ? ` ${resumed.reason}` : ""}` };
    }
  }
  const damageResult = resolveAttackDamage(next, pending.attack, target.id, pending.critical, random);
  if (!damageResult.legal) return { encounter: next, playerRoll: null, damageRoll: null, summary: damageResult.reason };
  const updatedTarget = damageResult.encounter.combatants.find((combatant) => combatant.id === target.id)!;
  const damageSummary = `${damageResult.summary} ${updatedTarget.name} has ${updatedTarget.hitPoints.current}/${updatedTarget.hitPoints.maximum} HP remaining.`;
  next = queueConcentrationCheck(damageResult.encounter, target.id, damageResult.damageApplied, updatedTarget.hitPoints.current > 0 ? pending.continuation : undefined);
  const resumed = pending.continuation && updatedTarget.hitPoints.current > 0 && next.pendingResponse?.type !== "concentration-check"
    ? resumeMovementContinuation(next, pending.continuation, random)
    : null;
  return { encounter: resumed?.encounter ?? next, playerRoll: null, damageRoll: resumed?.damageRoll ?? damageResult.roll, summary: `${reactionSummary} ${damageSummary}${resumed ? ` ${resumed.reason}` : next.pendingResponse?.type === "concentration-check" ? " Resolve concentration before movement continues." : ""}` };
}

export function chooseOpportunityAttack(encounter: EncounterState, attackId: string | null): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "opportunity-attack" || pending.phase !== "choice") return { encounter, playerRoll: null, damageRoll: null, summary: "No opportunity-attack choice is pending." };
  const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId);
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  if (!source || !target) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The opportunity attack can no longer be resolved." };
  if (!attackId) {
    let next = resumeMovementContinuation({ ...encounter, pendingResponse: null }, pending.continuation).encounter;
    const summary = `${source.name} saves their reaction. ${target.name} completes the move without an opportunity attack.`;
    next = { ...next, log: [summary, ...next.log] };
    return { encounter: next, playerRoll: null, damageRoll: null, summary };
  }
  const attack = source.attacks.find((candidate) => candidate.id === attackId && pending.availableAttackIds.includes(candidate.id));
  if (!attack) return { encounter, playerRoll: null, damageRoll: null, summary: "That melee attack is unavailable for this reaction." };
  const summary = `${source.name} will use their reaction to make an opportunity attack with ${attack.name}. Click to roll the attack.`;
  return { encounter: { ...encounter, pendingResponse: { ...pending, phase: "attack-roll", attackId }, log: [summary, ...encounter.log] }, playerRoll: null, damageRoll: null, summary };
}

export function rollOpportunityAttack(encounter: EncounterState, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "opportunity-attack" || pending.phase !== "attack-roll" || !pending.attackId) return { encounter, playerRoll: null, damageRoll: null, summary: "No opportunity attack roll is pending." };
  const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId);
  const attack = source?.attacks.find((candidate) => candidate.id === pending.attackId);
  if (!source || !attack) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The opportunity attack can no longer be resolved." };
  const result = resolveReactionAttackRoll({ ...encounter, pendingResponse: null }, source.id, pending.targetCombatantId, attack, random);
  if (!result.legal) return { encounter, playerRoll: null, damageRoll: null, summary: result.reason };
  if (!result.hit) {
    const moved = resumeMovementContinuation(result.encounter, pending.continuation, random);
    return { encounter: moved.encounter, playerRoll: result.roll, damageRoll: moved.damageRoll, summary: `${result.summary} The attack misses. ${moved.reason}` };
  }
  return {
    encounter: { ...result.encounter, pendingResponse: { ...pending, phase: "damage-roll", critical: result.critical } },
    playerRoll: result.roll,
    damageRoll: null,
    summary: `${result.summary} Click to roll ${attack.damage}${result.critical ? " with doubled damage dice" : ""}.`,
  };
}

export function rollOpportunityDamage(encounter: EncounterState, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "opportunity-attack" || pending.phase !== "damage-roll" || !pending.attackId) return { encounter, playerRoll: null, damageRoll: null, summary: "No opportunity damage roll is pending." };
  const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId);
  const attack = source?.attacks.find((candidate) => candidate.id === pending.attackId);
  if (!source || !attack) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The opportunity attack can no longer be resolved." };
  const result = resolveAttackDamage({ ...encounter, pendingResponse: null }, attack, pending.targetCombatantId, pending.critical, random);
  if (!result.legal) return { encounter, playerRoll: null, damageRoll: null, summary: result.reason };
  const target = result.encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
  const resumed = target.hitPoints.current > 0 ? resumeMovementContinuation(result.encounter, pending.continuation, random) : null;
  const next = resumed?.encounter ?? result.encounter;
  const summary = `${result.summary}${target.hitPoints.current > 0 ? ` ${target.name} survives. ${resumed?.reason ?? "Movement continues."}` : ` ${target.name} falls before leaving reach.`}`;
  return { encounter: { ...next, log: [summary, ...next.log] }, playerRoll: null, damageRoll: result.roll, summary };
}

export function resolveConcentrationResponse(encounter: EncounterState, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "concentration-check") return { encounter, playerRoll: null, damageRoll: null, summary: "No concentration check is pending." };
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  if (!target) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The concentration check can no longer be resolved." };
  const modifier = effectiveSavingThrowModifier(encounter, target.id, "constitution");
  const playerRoll = rollD20({ mode: "normal", modifier, random });
  const succeeded = playerRoll.total >= pending.dc;
  let next: EncounterState = { ...encounter, pendingResponse: null };
  if (!succeeded) next = endConcentration(next, target.id, `failed DC ${pending.dc} Constitution save`);
  const summary = `${target.name} rolls ${playerRoll.kept} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${playerRoll.total} vs concentration DC ${pending.dc} — concentration ${succeeded ? "maintained" : "lost"}.`;
  next = { ...next, log: [summary, ...next.log] };
  const resumed = pending.continuation && target.hitPoints.current > 0 ? resumeMovementContinuation(next, pending.continuation, random) : null;
  return { encounter: resumed?.encounter ?? next, playerRoll, damageRoll: resumed?.damageRoll ?? null, summary: `${summary}${resumed ? ` ${resumed.reason}` : ""}` };
}

export function rollDeathSave(encounter: EncounterState, targetCombatantId: string, random = Math.random): PlayerResponseResolution {
  const target = encounter.combatants.find((combatant) => combatant.id === targetCombatantId);
  if (!target || target.side !== "player" || target.hitPoints.current > 0 || target.stabilized || target.deathSaves.failures >= 3) {
    return { encounter, playerRoll: null, damageRoll: null, summary: "No death saving throw is currently required." };
  }
  const playerRoll = rollD20({ mode: "normal", modifier: 0, random });
  let summary = "";
  const combatants = encounter.combatants.map((combatant) => {
    if (combatant.id !== target.id) return combatant;
    if (playerRoll.natural === 20) {
      summary = `${target.name} rolls a natural 20, regains 1 HP, and becomes conscious.`;
      return { ...combatant, hitPoints: { ...combatant.hitPoints, current: 1 }, deathSaves: { successes: 0, failures: 0 }, stabilized: false };
    }
    const failures = Math.min(3, combatant.deathSaves.failures + (playerRoll.natural === 1 ? 2 : playerRoll.total < 10 ? 1 : 0));
    const successes = Math.min(3, combatant.deathSaves.successes + (playerRoll.total >= 10 ? 1 : 0));
    const stabilized = successes >= 3;
    summary = `${target.name} rolls ${playerRoll.natural}: ${playerRoll.natural === 1 ? "two failures" : playerRoll.total >= 10 ? "one success" : "one failure"}. Death saves: ${successes} successes, ${failures} failures.${stabilized ? " Stabilized." : failures >= 3 ? " Defeated." : ""}`;
    return { ...combatant, deathSaves: { successes, failures }, stabilized };
  });
  return { encounter: { ...encounter, combatants, turn: { ...encounter.turn, action: false, bonusAction: false, movementRemaining: 0 }, log: [summary, ...encounter.log] }, playerRoll, damageRoll: null, summary };
}
