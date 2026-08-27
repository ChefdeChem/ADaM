import type { CharacterAttack, CharacterSpell } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import { rollD20, type D20Result, type RollMode } from "./dice";
import { applyEffect, effectiveAttackModifier } from "./effects";
import { spendSpellSlot, validateSpellSlot } from "./resources";
import { analyzeTarget } from "./targeting";

export type OptionValidation = {
  legal: boolean;
  reason?: string;
  rollMode?: RollMode;
  distanceFeet?: number;
};

export type OptionResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; encounter: EncounterState; roll: D20Result | null; summary: string };

export function validateAttackChoice(encounter: EncounterState, attack: CharacterAttack): OptionValidation {
  if (!encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (!encounter.selectedTargetId) return { legal: false, reason: "Select a target on the tactical map first." };
  const analysis = analyzeTarget(encounter, encounter.selectedTargetId);
  if (!analysis) return { legal: false, reason: "The selected target is no longer available." };
  if (!analysis.lineOfSight) return { legal: false, reason: `${analysis.target.name} is outside your line of sight.` };
  const maximumRange = attack.longRangeFeet ?? attack.normalRangeFeet;
  if (analysis.distanceFeet > maximumRange) return { legal: false, reason: `${analysis.target.name} is ${analysis.distanceFeet} feet away; ${attack.name} reaches ${maximumRange} feet.` };
  const longRange = attack.kind === "ranged" && analysis.distanceFeet > attack.normalRangeFeet;
  return { legal: true, rollMode: longRange ? "disadvantage" : "normal", distanceFeet: analysis.distanceFeet };
}

export function executeAttackChoice(encounter: EncounterState, attack: CharacterAttack, random = Math.random): OptionResolution {
  const validation = validateAttackChoice(encounter, attack);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That attack is not legal.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const target = analyzeTarget(encounter, encounter.selectedTargetId!)!;
  const roll = rollD20({ mode: validation.rollMode ?? "normal", modifier: attack.attackBonus + effectiveAttackModifier(encounter, active.id), random });
  const rangeNote = validation.rollMode === "disadvantage" ? " at long range with disadvantage" : "";
  const summary = `${attack.name} against ${target.target.name}${rangeNote}: ${roll.total} (${roll.kept} + ${roll.modifier}).`;
  return {
    legal: true,
    roll,
    summary,
    encounter: {
      ...encounter,
      turn: { ...encounter.turn, action: false },
      log: [`${active.name}: ${summary}`, ...encounter.log],
    },
  };
}

export function validateSpellChoice(encounter: EncounterState, spell: CharacterSpell): OptionValidation {
  const active = encounter.combatants[encounter.activeIndex];
  if (spell.castingTime === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (spell.castingTime === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  if (spell.castingTime === "reaction" && !encounter.turn.reaction) return { legal: false, reason: "Your Reaction is unavailable." };
  const slot = validateSpellSlot(encounter, active.id, spell.level);
  if (!slot.legal) return slot;
  if (spell.target === "single") {
    if (!encounter.selectedTargetId) return { legal: false, reason: "Select a target on the tactical map first." };
    const analysis = analyzeTarget(encounter, encounter.selectedTargetId);
    if (!analysis) return { legal: false, reason: "The selected target is no longer available." };
    if (spell.requiresLineOfSight && !analysis.lineOfSight) return { legal: false, reason: `${analysis.target.name} is outside your line of sight.` };
    if (analysis.distanceFeet > spell.rangeFeet) return { legal: false, reason: `${analysis.target.name} is ${analysis.distanceFeet} feet away; ${spell.name} reaches ${spell.rangeFeet} feet.` };
    return { legal: true, rollMode: "normal", distanceFeet: analysis.distanceFeet };
  }
  return { legal: true, rollMode: "normal", distanceFeet: 0 };
}

export function executeSpellChoice(encounter: EncounterState, spell: CharacterSpell, random = Math.random): OptionResolution {
  const validation = validateSpellChoice(encounter, spell);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That spell is not legal.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const targetId = spell.target === "self" ? active.id : encounter.selectedTargetId!;
  const targetName = encounter.combatants.find((combatant) => combatant.id === targetId)?.name ?? "target";
  let next = spendSpellSlot(encounter, active.id, spell.level);
  next = {
    ...next,
    turn: {
      ...next.turn,
      action: spell.castingTime === "action" ? false : next.turn.action,
      bonusAction: spell.castingTime === "bonus-action" ? false : next.turn.bonusAction,
      reaction: spell.castingTime === "reaction" ? false : next.turn.reaction,
    },
  };
  if (spell.effect) {
    next = applyEffect(next, {
      ...spell.effect,
      sourceCombatantId: active.id,
      targetCombatantId: targetId,
      durationRounds: spell.durationRounds,
      concentration: spell.concentration,
    });
  }
  const roll = spell.attackBonus === undefined
    ? null
    : rollD20({ mode: "normal", modifier: spell.attackBonus + effectiveAttackModifier(next, active.id), random });
  const slotCopy = spell.level === 0 ? "cantrip" : `level ${spell.level} slot`;
  const rollCopy = roll ? ` Attack roll: ${roll.total} (${roll.kept} + ${roll.modifier}).` : "";
  const summary = `${spell.name} cast on ${targetName} using ${slotCopy}.${rollCopy}`;
  return { legal: true, roll, summary, encounter: { ...next, log: [`${active.name}: ${summary}`, ...next.log] } };
}
