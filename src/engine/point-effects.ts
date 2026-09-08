import type { CharacterSpell } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import { rollD20, rollDamage, type D20Result, type DamageRoll } from "./dice";
import { applyEffect, effectiveDamageAmount, effectiveSavingThrowModifier, occupiedCells, savingThrowRollMode } from "./effects";
import { applyDamageToCombatant, validateSpellAvailability } from "./combat-options";
import { spendSpellSlot } from "./resources";
import { hasLineOfSightToPoint } from "./targeting";
import { automaticallyFailsSave } from "./effects";
import { queueConcentrationCheck } from "./defensive-responses";

export type PointSpellResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState; damageRoll?: DamageRoll; saveRoll?: D20Result };

const distanceFeet = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;

function touchesHazardPoints(e: EncounterState, id: string, points?: { x: number; y: number }[]): boolean {
  return Boolean(points?.some(point => occupiedCells(e, id).some(cell => cell.x === point.x && cell.y === point.y)));
}

type UtilityChoice = NonNullable<CharacterSpell["utilityChoices"]>[number];

function validateUtilityPoint(encounter: EncounterState, choice: UtilityChoice, point: { x: number; y: number }): string | null {
  if (choice.resolution.type !== "flame") return null;
  const flame = encounter.map.terrain.find((cell) => cell.x === point.x && cell.y === point.y)?.flame;
  if (!flame) return "Choose a registered candle, torch, campfire, or other nonmagical flame.";
  if (choice.resolution.operation === "light" && flame.lit) return "That flame is already lit.";
  if ((choice.resolution.operation === "snuff" || choice.resolution.operation === "control") && !flame.lit) return "That flame is not currently lit.";
  return null;
}

function resolveUtilityChoice(
  encounter: EncounterState,
  spell: CharacterSpell,
  choice: UtilityChoice,
  point: { x: number; y: number },
): { encounter: EncounterState; summary: string } {
  const caster = encounter.combatants[encounter.activeIndex];
  const coordinate = `${String.fromCharCode(65 + point.x)}${point.y + 1}`;
  if (choice.resolution.type === "illusion") {
    const next = applyEffect(encounter, {
      magical: true,
      name: spell.name,
      description: `${choice.name} at ${coordinate}. ${choice.description}`,
      sourceCombatantId: caster.id,
      targetCombatantId: caster.id,
      durationRounds: spell.durationRounds,
      points: [point],
      pointEffect: {
        type: "illusion",
        mode: choice.resolution.mode,
        sizeFeet: choice.resolution.sizeFeet,
        investigationDc: caster.spellSaveDc ?? 10,
        discoveredBy: [],
      },
      replaceExisting: true,
    });
    return { encounter: next, summary: `${caster.name} casts ${spell.name}, creating a ${choice.resolution.mode} at ${coordinate}.` };
  }
  if (choice.resolution.type === "weather-sensor") {
    const next = applyEffect(encounter, {
      magical: true,
      name: `${spell.name}: Weather Sign`,
      description: `A tiny sign at ${coordinate} represents the local weather outlook for the next 24 hours.`,
      sourceCombatantId: caster.id,
      targetCombatantId: caster.id,
      durationRounds: choice.resolution.durationRounds,
      points: [point],
      pointEffect: { type: "utility-marker", kind: "weather-sensor", sizeFeet: 5 },
      replaceExisting: true,
    });
    return { encounter: next, summary: `${caster.name} casts ${spell.name}, creating a one-round weather sign at ${coordinate}.` };
  }
  if (choice.resolution.type === "bloom") {
    const next = applyEffect(encounter, {
      name: `${spell.name}: Bloom`,
      description: `A flower, seed pod, or leaf bud blooms at ${coordinate}.`,
      sourceCombatantId: caster.id,
      targetCombatantId: caster.id,
      points: [point],
      pointEffect: { type: "utility-marker", kind: "bloom", sizeFeet: 5 },
    });
    return { encounter: next, summary: `${caster.name} casts ${spell.name}, causing a plant to bloom at ${coordinate}.` };
  }
  if (choice.resolution.type === "sensory-effect") {
    return { encounter, summary: `${caster.name} casts ${spell.name}, creating a momentary harmless nature sensation in the 5-foot cube at ${coordinate}.` };
  }

  const operation = choice.resolution.operation;
  const terrain = encounter.map.terrain.map((cell) => {
    if (cell.x !== point.x || cell.y !== point.y || !cell.flame) return cell;
    const baseLabel = cell.label.replace(/ \((?:controlled|unlit)\)$/i, "");
    const lit = operation === "light" ? true : operation === "snuff" ? false : cell.flame.lit;
    const controlled = operation === "control";
    return {
      ...cell,
      label: `${baseLabel}${controlled ? " (controlled)" : lit ? "" : " (unlit)"}`,
      flame: { lit, controlled },
    };
  });
  const verb = operation === "light" ? "lights" : operation === "snuff" ? "snuffs" : "manipulates";
  return {
    encounter: { ...encounter, map: { ...encounter.map, terrain } },
    summary: `${caster.name} casts ${spell.name} and ${verb} the nonmagical flame at ${coordinate}.`,
  };
}

function resolveHazardAtPoint(encounter: EncounterState, effectId: string, combatantId: string, random: () => number): PointSpellResolution {
  const effect = encounter.effects.find((candidate) => candidate.id === effectId);
  const target = encounter.combatants.find((candidate) => candidate.id === combatantId);
  if (!effect || effect.pointEffect?.type !== "damaging-hazard" || !target || !touchesHazardPoints(encounter, target.id, effect.points)) {
    return { legal: false, reason: "No registered damaging point effect applies.", encounter };
  }
  const damageRoll = rollDamage(effect.pointEffect.damage, { random });
  if (!damageRoll) return { legal: false, reason: `ADaM could not read the damage formula “${effect.pointEffect.damage}”.`, encounter };
  const save = effect.pointEffect.save;
  const roll = rollD20({ mode: savingThrowRollMode(encounter, target.id, undefined, "normal", save.ability), modifier: effectiveSavingThrowModifier(encounter, target.id, save.ability), random });
  const succeeded = !automaticallyFailsSave(encounter, target.id, save.ability) && roll.total >= save.dc;
  const amount = succeeded ? save.damageOnSuccess === "half" ? Math.floor(damageRoll.total / 2) : 0 : damageRoll.total;
  const applied = effectiveDamageAmount(encounter, target.id, amount, damageRoll.formula.damageType);
  let next = amount > 0 ? applyDamageToCombatant(encounter, target.id, amount, { damageType: damageRoll.formula.damageType, sourceCombatantId: effect.sourceCombatantId }) : encounter;
  if (!next.pendingResponse) next = queueConcentrationCheck(next, target.id, applied);
  const summary = `${target.name} ${succeeded ? "succeeds" : "fails"} the DC ${save.dc} ${save.ability} save against ${effect.name} and takes ${applied} ${damageRoll.formula.damageType} damage.`;
  return { legal: true, summary, damageRoll, saveRoll: roll, encounter: { ...next, log: [summary, ...next.log] } };
}

export function executePointSpell(encounter: EncounterState, spell: CharacterSpell, points: Array<{ x: number; y: number }>, random = Math.random, utilityChoiceId?: string): PointSpellResolution {
  const availability = validateSpellAvailability(encounter, spell);
  if (!availability.legal) return { legal: false, reason: availability.reason ?? "That spell is not available.", encounter };
  const utilityChoice = spell.utilityChoices?.find((choice) => choice.id === utilityChoiceId);
  if (spell.utilityChoices?.length && !utilityChoice) return { legal: false, reason: `Choose an effect for ${spell.name} first.`, encounter };
  if (spell.target !== "point" || (!spell.pointEffect && !utilityChoice)) return { legal: false, reason: `${spell.name} is not a registered point spell.`, encounter };
  const caster = encounter.combatants[encounter.activeIndex];
  if (points.length < 1) return { legal: false, reason: `Choose at least one point for ${spell.name}.`, encounter };
  const maximumPoints = spell.pointEffect?.type === "lights" ? spell.pointEffect.maximumPoints : 1;
  if (points.length > maximumPoints) return { legal: false, reason: `${spell.name} supports at most ${maximumPoints} point${maximumPoints === 1 ? "" : "s"}.`, encounter };
  for (const point of points) {
    if (point.x < 0 || point.y < 0 || point.x >= encounter.map.width || point.y >= encounter.map.height) return { legal: false, reason: "A chosen point is outside the tactical map.", encounter };
    if (distanceFeet(caster.position, point) > spell.rangeFeet) return { legal: false, reason: `A chosen point is outside ${spell.name}'s ${spell.rangeFeet}-foot range.`, encounter };
    if (spell.requiresLineOfSight && !hasLineOfSightToPoint(encounter, caster.id, point.x, point.y)) return { legal: false, reason: "A chosen point is outside the caster's line of sight.", encounter };
  }
  if (utilityChoice) {
    const utilityError = validateUtilityPoint(encounter, utilityChoice, points[0]);
    if (utilityError) return { legal: false, reason: utilityError, encounter };
  }
  let next = spendSpellSlot(encounter, caster.id, spell.level);
  next = { ...next, turn: { ...next.turn, action: spell.castingTime === "action" ? false : next.turn.action, bonusAction: spell.castingTime === "bonus-action" ? false : next.turn.bonusAction } };
  if (utilityChoice) {
    const utility = resolveUtilityChoice(next, spell, utilityChoice, points[0]);
    return { legal: true, summary: utility.summary, encounter: { ...utility.encounter, log: [utility.summary, ...utility.encounter.log] } };
  }
  if (!spell.pointEffect) return { legal: false, reason: `${spell.name} is missing its point-effect definition.`, encounter };
  next = applyEffect(next, {
    name: spell.name,
    magical: true,
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
  const notes: string[] = [];
  if (spell.pointEffect.type === "damaging-hazard") {
    const effectId = next.effects.find(effect => effect.name === spell.name && effect.sourceCombatantId === caster.id)!.id;
    const entries = next.combatants.filter(target => touchesHazardPoints(next, target.id, points)).map(target => ({ effectId, combatantId: target.id }));
    next = resumePointHazards({ ...next, pendingPointHazards: [...(next.pendingPointHazards ?? []), ...entries] }, random);
    if (next.pendingResponse) notes.push("Resolve the pending response before the remaining hazards.");
  }
  const coordinateCopy = points.map((point) => `${String.fromCharCode(65 + point.x)}${point.y + 1}`).join(", ");
  const summary = `${caster.name} casts ${spell.name} at ${coordinateCopy}.${notes.length ? ` ${notes.join(" ")}` : ""}`;
  return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
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
  const target = encounter.combatants.find(c => c.id === combatantId);
  if (!target) return encounter;
  const entries = encounter.effects.filter(effect => effect.pointEffect?.type === "damaging-hazard"
    && touchesHazardPoints(encounter, target.id, effect.points))
    .map(effect => ({ effectId: effect.id, combatantId }));
  return resumePointHazards({ ...encounter, pendingPointHazards: [...(encounter.pendingPointHazards ?? []), ...entries] }, random);
}

export function resumePointHazards(encounter: EncounterState, random = Math.random): EncounterState {
  let next = encounter;
  while (!next.pendingResponse && next.pendingPointHazards?.length) {
    const [entry, ...rest] = next.pendingPointHazards;
    next = { ...next, pendingPointHazards: rest };
    const effect = next.effects.find(effect => effect.id === entry.effectId);
    const target = next.combatants.find(c => c.id === entry.combatantId);
    if (!effect || effect.pointEffect?.type !== "damaging-hazard" || !target || target.deathSaves.failures >= 3
      || !touchesHazardPoints(next, target.id, effect.points)) continue;
    if (target.side === "player") {
      next = { ...next, pendingResponse: { type: "point-hazard-save", effectId: entry.effectId, targetCombatantId: target.id, name: effect.name } };
      break;
    }
    const result = resolveHazardAtPoint(next, entry.effectId, target.id, random);
    if (result.legal) next = result.encounter;
  }
  return next;
}

export function resolvePointHazardResponse(encounter: EncounterState, random = Math.random) {
  const p = encounter.pendingResponse;
  if (p?.type !== "point-hazard-save") return { encounter, summary: "No point-hazard save is pending.", playerRoll: null };
  const cleared = { ...encounter, pendingResponse: null };
  const r = resolveHazardAtPoint(cleared, p.effectId, p.targetCombatantId, random);
  return { encounter: resumePointHazards(r.encounter, random), summary: r.legal ? r.summary : r.reason, playerRoll: r.legal ? r.saveRoll ?? null : null };
}

export type IllusionStudyResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState; roll: D20Result; discovered: boolean };

export function resolveIllusionStudy(encounter: EncounterState, effectId: string, combatantId: string, random = Math.random): IllusionStudyResolution {
  const effect = encounter.effects.find((candidate) => candidate.id === effectId);
  const investigator = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const active = encounter.combatants[encounter.activeIndex];
  if (!effect || effect.pointEffect?.type !== "illusion") return { legal: false, reason: "That illusion is no longer available to examine.", encounter };
  if (!investigator || active?.id !== combatantId) return { legal: false, reason: "The examining creature must be taking its turn.", encounter };
  if (!encounter.turn.action) return { legal: false, reason: "Examining the illusion requires an available Action.", encounter };
  const modifier = investigator.skillModifiers.investigation ?? investigator.abilityModifiers.intelligence;
  const roll = rollD20({ mode: "normal", modifier, random });
  const discovered = roll.total >= effect.pointEffect.investigationDc;
  const effects = encounter.effects.map((candidate) => candidate.id === effectId && candidate.pointEffect?.type === "illusion" && discovered
    ? { ...candidate, pointEffect: { ...candidate.pointEffect, discoveredBy: [...new Set([...candidate.pointEffect.discoveredBy, combatantId])] } }
    : candidate);
  const summary = `${investigator.name} examines ${effect.name}: ${roll.total} vs DC ${effect.pointEffect.investigationDc}, ${discovered ? "recognizing the illusion" : "not discerning it"}.`;
  return {
    legal: true,
    roll,
    discovered,
    summary,
    encounter: { ...encounter, effects, turn: { ...encounter.turn, action: false }, log: [summary, ...encounter.log] },
  };
}
