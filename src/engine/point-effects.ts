import type { CharacterSpell } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import { rollD20, rollDamage, type DamageRoll } from "./dice";
import { applyEffect, effectiveDamageAmount, effectiveSavingThrowModifier, savingThrowRollMode } from "./effects";
import { applyDamageToCombatant, validateSpellAvailability } from "./combat-options";
import { spendSpellSlot } from "./resources";
import { hasLineOfSightToPoint } from "./targeting";

export type PointSpellResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState; damageRoll?: DamageRoll };

const distanceFeet = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;

function resolveHazardAtPoint(encounter: EncounterState, effectId: string, combatantId: string, random: () => number): PointSpellResolution {
  const effect = encounter.effects.find((candidate) => candidate.id === effectId);
  const target = encounter.combatants.find((candidate) => candidate.id === combatantId);
  if (!effect || effect.pointEffect?.type !== "damaging-hazard" || !target || !effect.points?.some((point) => point.x === target.position.x && point.y === target.position.y)) {
    return { legal: false, reason: "No registered damaging point effect applies.", encounter };
  }
  const damageRoll = rollDamage(effect.pointEffect.damage, { random });
  if (!damageRoll) return { legal: false, reason: `ADaM could not read the damage formula “${effect.pointEffect.damage}”.`, encounter };
  const save = effect.pointEffect.save;
  const roll = rollD20({ mode: savingThrowRollMode(encounter, target.id, undefined, "normal", save.ability), modifier: effectiveSavingThrowModifier(encounter, target.id, save.ability), random });
  const succeeded = roll.total >= save.dc;
  const amount = succeeded ? save.damageOnSuccess === "half" ? Math.floor(damageRoll.total / 2) : 0 : damageRoll.total;
  const applied = effectiveDamageAmount(encounter, target.id, amount, damageRoll.formula.damageType);
  const next = amount > 0 ? applyDamageToCombatant(encounter, target.id, amount, { damageType: damageRoll.formula.damageType, sourceCombatantId: effect.sourceCombatantId }) : encounter;
  const summary = `${target.name} ${succeeded ? "succeeds" : "fails"} the DC ${save.dc} ${save.ability} save against ${effect.name} and takes ${applied} ${damageRoll.formula.damageType} damage.`;
  return { legal: true, summary, damageRoll, encounter: { ...next, log: [summary, ...next.log] } };
}

export function executePointSpell(encounter: EncounterState, spell: CharacterSpell, points: Array<{ x: number; y: number }>, random = Math.random): PointSpellResolution {
  const availability = validateSpellAvailability(encounter, spell);
  if (!availability.legal) return { legal: false, reason: availability.reason ?? "That spell is not available.", encounter };
  if (spell.target !== "point" || !spell.pointEffect) return { legal: false, reason: `${spell.name} is not a registered point spell.`, encounter };
  const caster = encounter.combatants[encounter.activeIndex];
  if (points.length < 1) return { legal: false, reason: `Choose at least one point for ${spell.name}.`, encounter };
  const maximumPoints = spell.pointEffect.type === "lights" ? spell.pointEffect.maximumPoints : 1;
  if (points.length > maximumPoints) return { legal: false, reason: `${spell.name} supports at most ${maximumPoints} point${maximumPoints === 1 ? "" : "s"}.`, encounter };
  for (const point of points) {
    if (point.x < 0 || point.y < 0 || point.x >= encounter.map.width || point.y >= encounter.map.height) return { legal: false, reason: "A chosen point is outside the tactical map.", encounter };
    if (distanceFeet(caster.position, point) > spell.rangeFeet) return { legal: false, reason: `A chosen point is outside ${spell.name}'s ${spell.rangeFeet}-foot range.`, encounter };
    if (spell.requiresLineOfSight && !hasLineOfSightToPoint(encounter, caster.id, point.x, point.y)) return { legal: false, reason: "A chosen point is outside the caster's line of sight.", encounter };
  }
  let next = spendSpellSlot(encounter, caster.id, spell.level);
  next = { ...next, turn: { ...next.turn, action: spell.castingTime === "action" ? false : next.turn.action, bonusAction: spell.castingTime === "bonus-action" ? false : next.turn.bonusAction } };
  next = applyEffect(next, {
    name: spell.name,
    description: spell.description ?? spell.name,
    sourceCombatantId: caster.id,
    targetCombatantId: caster.id,
    concentration: spell.concentration,
    durationRounds: spell.durationRounds,
    points,
    pointEffect: spell.pointEffect.type === "lights"
      ? { type: "lights", dimLightFeet: spell.pointEffect.dimLightFeet, movementFeet: spell.pointEffect.movementFeet }
      : spell.pointEffect,
    replaceExisting: true,
  });
  let damageRoll: DamageRoll | undefined;
  const notes: string[] = [];
  if (spell.pointEffect.type === "damaging-hazard") {
    for (const target of next.combatants.filter((combatant) => points.some((point) => point.x === combatant.position.x && point.y === combatant.position.y))) {
      const result = resolveHazardAtPoint(next, next.effects.find((effect) => effect.name === spell.name && effect.sourceCombatantId === caster.id)!.id, target.id, random);
      if (result.legal) { next = result.encounter; damageRoll = result.damageRoll; notes.push(result.summary); }
    }
  }
  const coordinateCopy = points.map((point) => `${String.fromCharCode(65 + point.x)}${point.y + 1}`).join(", ");
  const summary = `${caster.name} casts ${spell.name} at ${coordinateCopy}.${notes.length ? ` ${notes.join(" ")}` : ""}`;
  return { legal: true, summary, damageRoll, encounter: { ...next, log: [summary, ...next.log] } };
}

export function moveLightPoint(encounter: EncounterState, effectId: string, pointIndex: number, point: { x: number; y: number }): PointSpellResolution {
  const effect = encounter.effects.find((candidate) => candidate.id === effectId);
  const caster = effect ? encounter.combatants.find((combatant) => combatant.id === effect.sourceCombatantId) : undefined;
  if (!effect || effect.pointEffect?.type !== "lights" || !caster || !effect.points?.[pointIndex]) return { legal: false, reason: "That movable light is no longer available.", encounter };
  if (!encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn.", encounter };
  if (distanceFeet(effect.points[pointIndex], point) > effect.pointEffect.movementFeet) return { legal: false, reason: `The light can move at most ${effect.pointEffect.movementFeet} feet.`, encounter };
  if (distanceFeet(caster.position, point) > 120) return { legal: false, reason: "The light must remain within the spell's range.", encounter };
  const points = effect.points.map((candidate, index) => index === pointIndex ? point : candidate);
  if (points.length > 1 && !points.some((candidate, index) => index !== pointIndex && distanceFeet(candidate, point) <= 20)) {
    return { legal: false, reason: "A Dancing Lights light must remain within 20 feet of another light from the spell.", encounter };
  }
  const next = { ...encounter, turn: { ...encounter.turn, bonusAction: false }, effects: encounter.effects.map((candidate) => candidate.id === effectId ? { ...candidate, points } : candidate) };
  const summary = `${caster.name} moves a ${effect.name} light to ${String.fromCharCode(65 + point.x)}${point.y + 1}.`;
  return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
}

export function resolvePointHazardsForCombatant(encounter: EncounterState, combatantId: string, random = Math.random): EncounterState {
  return encounter.effects.filter((effect) => effect.pointEffect?.type === "damaging-hazard")
    .reduce((next, effect) => {
      const result = resolveHazardAtPoint(next, effect.id, combatantId, random);
      return result.legal ? result.encounter : next;
    }, encounter);
}
