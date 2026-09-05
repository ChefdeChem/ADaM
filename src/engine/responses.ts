import type { EncounterState } from "../domain/combat";
import { applyDamageToCombatant, resolveAttackDamage, resolveReactionAttackRoll } from "./combat-options";
import { rollD20, rollDamage, type D20Result, type DamageRoll } from "./dice";
import { applyEffect, effectiveDamageAmount, effectiveSavingThrowModifier, effectiveSpeed, endConcentration } from "./effects";
import { queueConcentrationCheck } from "./defensive-responses";
import { spendNamedResource, spendSpellSlot, validateNamedResource, validateSpellSlot } from "./resources";
import { resumeMovementContinuation } from "./movement";
import { canCastSpells, isIncapacitated, reconcileConcentration, savingThrowRollMode } from "./effects";

export { queueConcentrationCheck } from "./defensive-responses";

export type PlayerResponseResolution = {
  encounter: EncounterState;
  playerRoll: D20Result | null;
  damageRoll: DamageRoll | null;
  summary: string;
};

export function resolvePostHitSpellChoice(encounter: EncounterState, castSpell: boolean, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "post-hit-spell-choice") return { encounter, playerRoll: null, damageRoll: null, summary: "No post-hit spell choice is pending." };
  const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId);
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  const spell = source?.spells.find((candidate) => candidate.id === pending.spellId && candidate.trigger === "after-melee-hit");
  if (!source || !target || !spell) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The post-hit spell choice can no longer be resolved." };
  if (!castSpell) {
    const summary = `${source.name} declines ${spell.name} after the ${pending.attackName} hit.`;
    return { encounter: { ...encounter, pendingResponse: null, log: [summary, ...encounter.log] }, playerRoll: null, damageRoll: null, summary };
  }
  if (!encounter.turn.bonusAction) return { encounter, playerRoll: null, damageRoll: null, summary: `${source.name}'s Bonus Action is unavailable.` };
  if (!canCastSpells(encounter, source.id)) return { encounter, playerRoll: null, damageRoll: null, summary: `${source.name} cannot cast spells right now.` };
  const slot = validateSpellSlot(encounter, source.id, spell.level);
  if (!slot.legal) return { encounter, playerRoll: null, damageRoll: null, summary: slot.reason ?? `${spell.name} is unavailable.` };
  const damageRoll = spell.triggeredDamage ? rollDamage(spell.triggeredDamage, { critical: pending.critical, random }) : null;
  if (!damageRoll) return { encounter, playerRoll: null, damageRoll: null, summary: `ADaM could not read ${spell.name}'s damage formula.` };
  let next = spendSpellSlot({ ...encounter, pendingResponse: null }, source.id, spell.level);
  next = { ...next, turn: { ...next.turn, bonusAction: false } };
  const damageApplied = effectiveDamageAmount(next, target.id, damageRoll.total, damageRoll.formula.damageType);
  next = applyDamageToCombatant(next, target.id, damageRoll.total, { damageType: damageRoll.formula.damageType, sourceCombatantId: source.id });
  const updatedTarget = next.combatants.find((combatant) => combatant.id === target.id);
  if (spell.effect && (updatedTarget?.hitPoints.current ?? 0) > 0 && !next.pendingResponse) {
    next = applyEffect(next, {
      ...spell.effect,
      sourceCombatantId: source.id,
      targetCombatantId: target.id,
      durationRounds: spell.durationRounds,
      concentration: spell.concentration,
      replaceExisting: true,
    });
  }
  const summary = `${source.name} casts ${spell.name} after the ${pending.attackName} hit, dealing ${damageApplied} ${damageRoll.formula.damageType} damage${pending.critical ? " with doubled damage dice" : ""}.`;
  next = { ...next, log: [summary, ...next.log] };
  return { encounter: next, playerRoll: null, damageRoll, summary };
}

export function resolveDamageReductionReaction(encounter: EncounterState, useFeature: boolean, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "damage-reduction-reaction") return { encounter, playerRoll: null, damageRoll: null, summary: "No damage-reduction reaction is pending." };
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  const feature = target?.triggeredFeatures.find((candidate) => candidate.id === pending.featureId && candidate.resolution.type === "reduce-damage-by-roll");
  if (!target || !feature || feature.resolution.type !== "reduce-damage-by-roll") return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The damage-reduction reaction can no longer be resolved." };

  let next: EncounterState = { ...encounter, pendingResponse: null };
  let reductionRoll: DamageRoll | null = null;
  let damageAfterReduction = pending.damageTaken;
  let damageApplied = effectiveDamageAmount(next, target.id, damageAfterReduction, pending.damageType);
  let summary = `${target.name} saves their reaction and takes ${damageApplied} damage.`;
  if (useFeature) {
    if (!feature.resourceName || feature.resourceCost === undefined) return { encounter, playerRoll: null, damageRoll: null, summary: `${feature.name} is missing its resource rule.` };
    const resource = validateNamedResource(next, target.id, feature.resourceName, feature.resourceCost);
    if (!target.reactionAvailable || !resource.legal) return { encounter, playerRoll: null, damageRoll: null, summary: !target.reactionAvailable ? `${target.name}'s Reaction is unavailable.` : resource.reason ?? `${feature.name} is unavailable.` };
    reductionRoll = rollDamage(`${feature.resolution.die} + ${feature.resolution.modifier}`, { random });
    if (!reductionRoll) return { encounter, playerRoll: null, damageRoll: null, summary: `ADaM could not roll ${feature.name}.` };
    damageAfterReduction = Math.max(0, pending.damageTaken - reductionRoll.total);
    next = spendNamedResource(next, target.id, feature.resourceName, feature.resourceCost);
    next = { ...next, combatants: next.combatants.map((combatant) => combatant.id === target.id ? { ...combatant, reactionAvailable: false } : combatant) };
    damageApplied = effectiveDamageAmount(next, target.id, damageAfterReduction, pending.damageType);
    const resistanceCopy = damageApplied < damageAfterReduction ? ` ${target.name}'s resistance further reduces it to ${damageApplied}.` : "";
    summary = `${target.name} uses ${feature.name}, rolls ${reductionRoll.rolls[0]} + ${feature.resolution.modifier} = ${reductionRoll.total}, and reduces ${pending.damageTaken} damage to ${damageAfterReduction}.${resistanceCopy}`;
  }

  next = applyDamageToCombatant(next, target.id, damageAfterReduction, { critical: pending.critical, allowDamageReduction: false, damageType: pending.damageType, sourceCombatantId: pending.sourceCombatantId });
  if (next.pendingResponse?.type === "zero-hit-point-replacement" && pending.continuation) {
    next = { ...next, pendingResponse: { ...next.pendingResponse, continuation: pending.continuation } };
  }
  next = { ...next, log: [summary, ...next.log] };
  if (!next.pendingResponse) next = queueConcentrationCheck(next, target.id, damageApplied, pending.continuation);
  const updatedTarget = next.combatants.find((combatant) => combatant.id === target.id);
  if (!next.pendingResponse && pending.continuation && (updatedTarget?.hitPoints.current ?? 0) > 0) {
    const resumed = resumeMovementContinuation(next, pending.continuation, random);
    return { encounter: resumed.encounter, playerRoll: null, damageRoll: reductionRoll ?? resumed.damageRoll, summary: `${summary} ${resumed.reason}` };
  }
  const followUp = next.pendingResponse?.type === "concentration-check"
    ? " Resolve concentration before continuing."
    : next.pendingResponse?.type === "zero-hit-point-replacement"
      ? ` Decide whether to use ${target.name}'s zero-HP replacement feature.`
      : "";
  return { encounter: next, playerRoll: null, damageRoll: reductionRoll, summary: `${summary}${followUp}` };
}

export function resolveZeroHitPointReplacement(encounter: EncounterState, useFeature: boolean, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "zero-hit-point-replacement") return { encounter, playerRoll: null, damageRoll: null, summary: "No zero-hit-point replacement is pending." };
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  const feature = target?.triggeredFeatures.find((candidate) => candidate.id === pending.featureId);
  if (!target || !feature) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The zero-hit-point replacement can no longer be resolved." };

  let next: EncounterState = { ...encounter, pendingResponse: null };
  let summary: string;
  if (useFeature) {
    if (!feature.resourceName || feature.resourceCost === undefined) return { encounter, playerRoll: null, damageRoll: null, summary: `${feature.name} is missing its resource rule.` };
    const resource = validateNamedResource(next, target.id, feature.resourceName, feature.resourceCost);
    if (!resource.legal) return { encounter, playerRoll: null, damageRoll: null, summary: resource.reason ?? `${feature.name} is unavailable.` };
    next = spendNamedResource(next, target.id, feature.resourceName, feature.resourceCost);
    next = {
      ...next,
      combatants: next.combatants.map((combatant) => combatant.id === target.id ? {
        ...combatant,
        hitPoints: { ...combatant.hitPoints, current: 1 },
        deathSaves: { successes: 0, failures: 0 },
        stabilized: false,
      } : combatant),
    };
    summary = `${target.name} uses ${feature.name}, spends one use, and drops to 1 HP instead of 0.`;
    next = { ...next, log: [summary, ...next.log] };
    next = queueConcentrationCheck(next, target.id, pending.damageTaken, pending.continuation);
    if (!next.pendingResponse && pending.continuation) {
      const resumed = resumeMovementContinuation(next, pending.continuation, random);
      return { encounter: resumed.encounter, playerRoll: null, damageRoll: resumed.damageRoll, summary: `${summary} ${resumed.reason}` };
    }
    return { encounter: next, playerRoll: null, damageRoll: null, summary: `${summary}${next.pendingResponse?.type === "concentration-check" ? " Now resolve the concentration check caused by the damage." : ""}` };
  }

  summary = `${target.name} declines ${feature.name} and falls unconscious at 0 HP.`;
  next = { ...next, log: [summary, ...next.log] };
  next = queueConcentrationCheck(next, target.id, pending.damageTaken);
  return { encounter: next, playerRoll: null, damageRoll: null, summary };
}

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
  const damageApplied = effectiveDamageAmount(encounter, target.id, damage, damageRoll.formula.damageType);
  let next = applyDamageToCombatant({ ...encounter, pendingResponse: null }, target.id, damage, { damageType: damageRoll.formula.damageType, sourceCombatantId: source.id });
  const saveSummary = `${target.name} rolls ${playerRoll.kept} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${playerRoll.total} vs DC ${pending.ability.saveDc} — ${succeeded ? "success" : "failure"}.`;
  const damageSummary = `${source.name}'s ${pending.ability.name} rolls ${damageRoll.rolls.join(" + ")}${damageRoll.modifier ? ` ${damageRoll.modifier > 0 ? "+" : "−"} ${Math.abs(damageRoll.modifier)}` : ""} = ${damageRoll.total}; ${damageApplied} damage applied${damageApplied < damage ? " after resistance" : ""}.`;
  next = { ...next, log: [damageSummary, saveSummary, ...next.log] };
  next = queueConcentrationCheck(next, target.id, damageApplied);
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
      if (!canCastSpells(next, target.id)) return { encounter, playerRoll: null, damageRoll: null, summary: `${target.name} cannot cast a reaction spell right now.` };
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
  const damageEncounter = (damageResult.encounter.pendingResponse?.type === "zero-hit-point-replacement" || damageResult.encounter.pendingResponse?.type === "damage-reduction-reaction") && pending.continuation
    ? { ...damageResult.encounter, pendingResponse: { ...damageResult.encounter.pendingResponse, continuation: pending.continuation } }
    : damageResult.encounter;
  const updatedTarget = damageEncounter.combatants.find((combatant) => combatant.id === target.id)!;
  const damageSummary = damageEncounter.pendingResponse?.type === "damage-reduction-reaction"
    ? `${damageResult.summary} ${updatedTarget.name} can react before the damage is applied.`
    : `${damageResult.summary} ${updatedTarget.name} has ${updatedTarget.hitPoints.current}/${updatedTarget.hitPoints.maximum} HP remaining.`;
  next = queueConcentrationCheck(damageEncounter, target.id, damageResult.damageApplied, updatedTarget.hitPoints.current > 0 ? pending.continuation : undefined);
  const resumed = pending.continuation && updatedTarget.hitPoints.current > 0 && !next.pendingResponse
    ? resumeMovementContinuation(next, pending.continuation, random)
    : null;
  return { encounter: resumed?.encounter ?? next, playerRoll: null, damageRoll: resumed?.damageRoll ?? damageResult.roll, summary: `${reactionSummary} ${damageSummary}${resumed ? ` ${resumed.reason}` : next.pendingResponse?.type === "concentration-check" ? " Resolve concentration before movement continues." : next.pendingResponse?.type === "zero-hit-point-replacement" ? ` Decide whether to use ${target.name}'s zero-HP replacement feature.` : next.pendingResponse?.type === "damage-reduction-reaction" ? ` Decide whether to use ${target.name}'s damage-reduction reaction.` : ""}` };
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
  const result = resolveAttackDamage({ ...encounter, pendingResponse: null }, attack, pending.targetCombatantId, pending.critical, random, source.id);
  if (!result.legal) return { encounter, playerRoll: null, damageRoll: null, summary: result.reason };
  if (result.encounter.pendingResponse?.type === "weapon-mastery-choice") {
    const next = { ...result.encounter, pendingResponse: { ...result.encounter.pendingResponse, continuation: pending.continuation } };
    return { encounter: next, playerRoll: null, damageRoll: result.roll, summary: `${result.summary} Decide whether to apply Slow before movement continues.` };
  }
  const target = result.encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
  const resumed = target.hitPoints.current > 0 ? resumeMovementContinuation(result.encounter, pending.continuation, random) : null;
  const next = resumed?.encounter ?? result.encounter;
  const summary = `${result.summary}${target.hitPoints.current > 0 ? ` ${target.name} survives. ${resumed?.reason ?? "Movement continues."}` : ` ${target.name} falls before leaving reach.`}`;
  return { encounter: { ...next, log: [summary, ...next.log] }, playerRoll: null, damageRoll: result.roll, summary };
}

export function resolveWeaponMasteryChoice(encounter: EncounterState, useMastery: boolean, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "weapon-mastery-choice") return { encounter, playerRoll: null, damageRoll: null, summary: "No weapon-mastery choice is pending." };
  const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId);
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  if (!source || !target) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The weapon-mastery choice can no longer be resolved." };

  let next: EncounterState = { ...encounter, pendingResponse: null };
  let summary = `${source.name} declines Slow; ${target.name}'s Speed is unchanged.`;
  if (useMastery) {
    next = applyEffect(next, {
      name: "Slow",
      description: "Speed is reduced by 10 feet until the start of the attacker's next turn.",
      sourceCombatantId: source.id,
      targetCombatantId: target.id,
      modifiers: { speedFeet: -10 },
      expiresAt: pending.expiresAt,
      replaceExisting: true,
    });
    if (encounter.combatants[encounter.activeIndex]?.id === target.id) {
      next = { ...next, turn: { ...next.turn, movementRemaining: Math.min(next.turn.movementRemaining, effectiveSpeed(next, target.id)) } };
    }
    summary = `${source.name} applies Slow with ${pending.attackName}; ${target.name}'s Speed is reduced by 10 feet.`;
  }
  next = { ...next, log: [summary, ...next.log] };

  if (pending.continuation) {
    if (pending.continuation.cost > next.turn.movementRemaining) {
      const stopped = `${target.name} no longer has enough movement to complete the interrupted move.`;
      return { encounter: { ...next, log: [stopped, ...next.log] }, playerRoll: null, damageRoll: null, summary: `${summary} ${stopped}` };
    }
    const resumed = resumeMovementContinuation(next, pending.continuation, random);
    return { encounter: resumed.encounter, playerRoll: null, damageRoll: resumed.damageRoll, summary: `${summary} ${resumed.reason}` };
  }
  return { encounter: next, playerRoll: null, damageRoll: null, summary };
}

export function resolveConcentrationResponse(encounter: EncounterState, random = Math.random): PlayerResponseResolution {
  const pending = encounter.pendingResponse;
  if (!pending || pending.type !== "concentration-check") return { encounter, playerRoll: null, damageRoll: null, summary: "No concentration check is pending." };
  const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId);
  if (!target) return { encounter: { ...encounter, pendingResponse: null }, playerRoll: null, damageRoll: null, summary: "The concentration check can no longer be resolved." };
  encounter = reconcileConcentration(encounter);
  if (!encounter.effects.some((effect) => effect.concentration && effect.sourceCombatantId === target.id)) {
    const next = { ...encounter, pendingResponse: null };
    const resumed = pending.continuation && !isIncapacitated(next, target.id) ? resumeMovementContinuation(next, pending.continuation, random) : null;
    return { encounter: resumed?.encounter ?? next, playerRoll: null, damageRoll: resumed?.damageRoll ?? null, summary: "Concentration has already ended; no saving throw is needed." };
  }
  const modifier = effectiveSavingThrowModifier(encounter, target.id, "constitution");
  const playerRoll = rollD20({ mode: savingThrowRollMode(encounter, target.id, undefined, "normal", "constitution"), modifier, random });
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
