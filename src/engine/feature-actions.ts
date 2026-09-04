import type { Character, CharacterFeatureAction } from "../domain/character";
import type { CombatAction, EncounterState } from "../domain/combat";
import { applyEffect, canRegainHitPoints, effectiveDamageAmount, effectiveSavingThrowModifier, effectiveSpeed, savingThrowRollMode } from "./effects";
import { analyzeTarget } from "./targeting";
import { spendNamedResource, validateNamedResource } from "./resources";
import { areaTargets, pushTargetAway, validateAreaAim } from "./areas";
import { rollD20, rollDamage } from "./dice";
import { applyDamageToCombatant } from "./combat-options";

export type FeatureActionResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState; roll?: ReturnType<typeof rollDamage> };

export type FeatureActionOptions = {
  resourceAmount?: number;
  targetCombatantId?: string;
  random?: () => number;
};

export function featureCombatActions(character: Character): CombatAction[] {
  return (character.featureActions ?? []).map((feature) => ({
    id: feature.id,
    name: feature.name,
    cost: feature.cost,
    description: feature.description,
    rulesets: [feature.provenance.rulesetId],
    resourceCost: { resourceName: feature.resourceName, amount: feature.resourceCost === "variable" ? 1 : feature.resourceCost },
  }));
}

export function validateFeatureAction(encounter: EncounterState, feature: CharacterFeatureAction, options: FeatureActionOptions = {}): { legal: boolean; reason?: string } {
  const active = encounter.combatants[encounter.activeIndex];
  if (encounter.pendingResponse) return { legal: false, reason: "Resolve the pending player response first." };
  if (!active || active.side !== "player") return { legal: false, reason: "Feature actions are available only on the player's turn." };
  if (active.hitPoints.current <= 0) return { legal: false, reason: "An unconscious character cannot use this feature." };
  if (feature.cost === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (feature.cost === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  if (feature.cost === "reaction" && !encounter.turn.reaction) return { legal: false, reason: "Your Reaction is unavailable." };
  const resourceAmount = feature.resourceCost === "variable" ? options.resourceAmount : feature.resourceCost;
  if (resourceAmount === undefined) return { legal: false, reason: `Choose how many points to spend on ${feature.name}.` };
  if (!Number.isInteger(resourceAmount) || resourceAmount < 1) return { legal: false, reason: `${feature.name} must spend a positive whole number of points.` };
  const resource = validateNamedResource(encounter, active.id, feature.resourceName, resourceAmount);
  if (!resource.legal) return resource;

  if (feature.resolution.type === "healing-pool") {
    const target = encounter.combatants.find((combatant) => combatant.id === (options.targetCombatantId ?? active.id));
    if (!target) return { legal: false, reason: "The healing target is no longer available." };
    if (target.side !== active.side) return { legal: false, reason: `${feature.name} can target only the acting creature or an ally.` };
    const distanceFeet = Math.max(Math.abs(active.position.x - target.position.x), Math.abs(active.position.y - target.position.y)) * 5;
    if (distanceFeet > feature.resolution.rangeFeet) return { legal: false, reason: `${target.name} is ${distanceFeet} feet away; ${feature.name} requires touch.` };
    if (target.deathSaves.failures >= 3) return { legal: false, reason: `${target.name} has died and cannot regain Hit Points from ${feature.name}.` };
    if (!canRegainHitPoints(encounter, target.id)) return { legal: false, reason: `${target.name} cannot regain Hit Points right now.` };
    const missingHitPoints = target.hitPoints.maximum - target.hitPoints.current;
    if (missingHitPoints <= 0) return { legal: false, reason: `${target.name} is already at maximum Hit Points.` };
    if (resourceAmount > missingHitPoints) return { legal: false, reason: `${target.name} can regain at most ${missingHitPoints} Hit Points.` };
  }
  if (feature.resolution.type === "area-saving-throw") {
    const targetId = options.targetCombatantId ?? encounter.selectedTargetId;
    if (!targetId) return { legal: false, reason: "Select a creature to set the area's direction." };
    return validateAreaAim(encounter, active.id, targetId, feature.resolution.area);
  }
  if (feature.resolution.type === "activate-effect" && encounter.effects.some((effect) =>
    effect.name === feature.resolution.effect.name
    && effect.sourceCombatantId === active.id
    && effect.targetCombatantId === active.id)) {
    return { legal: false, reason: `${feature.resolution.effect.name} is already active.` };
  }
  return { legal: true };
}

export function executeFeatureAction(encounter: EncounterState, feature: CharacterFeatureAction, options: FeatureActionOptions = {}): FeatureActionResolution {
  const validation = validateFeatureAction(encounter, feature, options);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That feature is not available.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const resourceAmount = feature.resourceCost === "variable" ? options.resourceAmount! : feature.resourceCost;
  let next = spendNamedResource(encounter, active.id, feature.resourceName, resourceAmount);
  const turn = {
    ...next.turn,
    action: feature.cost === "action" ? false : next.turn.action,
    bonusAction: feature.cost === "bonus-action" ? false : next.turn.bonusAction,
    reaction: feature.cost === "reaction" ? false : next.turn.reaction,
  };

  if (feature.resolution.type === "area-saving-throw") {
    const targetId = options.targetCombatantId ?? encounter.selectedTargetId!;
    const random = options.random ?? Math.random;
    const damageRoll = rollDamage(feature.resolution.damage, { random });
    if (!damageRoll) return { legal: false, reason: `ADaM could not read the damage formula “${feature.resolution.damage}”.`, encounter };
    next = { ...next, turn };
    const results: string[] = [];
    for (const target of areaTargets(next, active.id, targetId, feature.resolution.area)) {
      const saveMode = savingThrowRollMode(next, target.id, undefined, "normal", feature.resolution.save.ability);
      const saveRoll = rollD20({ mode: saveMode, modifier: effectiveSavingThrowModifier(next, target.id, feature.resolution.save.ability), random });
      const succeeded = saveRoll.total >= feature.resolution.save.dc;
      const damage = succeeded
        ? feature.resolution.save.damageOnSuccess === "half" ? Math.floor(damageRoll.total / 2) : 0
        : damageRoll.total;
      if (damage > 0) next = applyDamageToCombatant(next, target.id, damage, { damageType: damageRoll.formula.damageType, sourceCombatantId: active.id });
      if (!succeeded && feature.resolution.area.pushFeetOnFailedSave) next = pushTargetAway(next, active.id, target.id, feature.resolution.area.pushFeetOnFailedSave);
      results.push(`${target.name} ${succeeded ? "succeeds" : "fails"} (${saveRoll.total}) and takes ${effectiveDamageAmount(encounter, target.id, damage, damageRoll.formula.damageType)} damage`);
    }
    const summary = `${active.name} uses ${feature.name}; ${damageRoll.total} ${damageRoll.formula.damageType} rolled. ${results.join("; ")}.`;
    return { legal: true, roll: damageRoll, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "dash-and-temporary-hit-points") {
    const temporaryHitPoints = feature.resolution.temporaryHitPoints === "proficiency-bonus" ? active.proficiencyBonus : 0;
    const movementGained = effectiveSpeed(next, active.id);
    next = {
      ...next,
      turn: {
        ...turn,
        movementRemaining: turn.movementRemaining + movementGained,
      },
      combatants: next.combatants.map((combatant) => combatant.id === active.id
        ? temporaryHitPoints > combatant.temporaryHitPoints
          ? { ...combatant, temporaryHitPoints, temporaryHitPointsSourceEffectId: undefined }
          : combatant
        : combatant),
    };
    const summary = `${active.name} uses ${feature.name}, gains ${movementGained} feet of movement, and has ${Math.max(active.temporaryHitPoints, temporaryHitPoints)} temporary hit points.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "healing-pool") {
    const targetId = options.targetCombatantId ?? active.id;
    const target = next.combatants.find((combatant) => combatant.id === targetId)!;
    next = {
      ...next,
      turn,
      combatants: next.combatants.map((combatant) => combatant.id === targetId
        ? {
            ...combatant,
            hitPoints: { ...combatant.hitPoints, current: combatant.hitPoints.current + resourceAmount },
            deathSaves: combatant.hitPoints.current === 0 ? { successes: 0, failures: 0 } : combatant.deathSaves,
            stabilized: false,
          }
        : combatant),
    };
    const summary = `${active.name} uses ${feature.name}; ${target.name} regains ${resourceAmount} Hit Point${resourceAmount === 1 ? "" : "s"}.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "activate-effect") {
    next = applyEffect({ ...next, turn }, {
      name: feature.resolution.effect.name,
      description: feature.resolution.effect.description,
      sourceCombatantId: active.id,
      targetCombatantId: active.id,
      modifiers: feature.resolution.effect.modifiers,
      expiresAt: feature.resolution.effect.duration === "end-of-next-turn"
        ? { round: encounter.round + 1, combatantId: active.id, phase: "end" }
        : undefined,
    });
    const summary = `${active.name} uses ${feature.name}; ${feature.resolution.effect.name} is active until the end of their next turn.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "sense-creature-types") {
    const detectableTypes = new Set(feature.resolution.creatureTypes.map((creatureType) => creatureType.toLowerCase()));
    const detectedCreatures = next.combatants.filter((combatant) => {
      if (combatant.id === active.id || combatant.hitPoints.current <= 0 || !detectableTypes.has(combatant.creatureType?.toLowerCase() ?? "")) return false;
      const analysis = analyzeTarget(next, combatant.id);
      return Boolean(analysis && analysis.distanceFeet <= feature.resolution.rangeFeet
        && (!feature.resolution.blockedByTotalCover || analysis.lineOfSight));
    });
    const detectedAuras = next.map.terrain.filter((cell) => cell.divineAura
      && Math.max(Math.abs(active.position.x - cell.x), Math.abs(active.position.y - cell.y)) * 5 <= feature.resolution.rangeFeet);
    next = applyEffect({ ...next, turn }, {
      name: feature.name,
      description: feature.description,
      sourceCombatantId: active.id,
      targetCombatantId: active.id,
      sense: {
        creatureTypes: feature.resolution.creatureTypes,
        rangeFeet: feature.resolution.rangeFeet,
        blockedByTotalCover: feature.resolution.blockedByTotalCover,
      },
      expiresAt: { round: encounter.round + 1, combatantId: active.id, phase: "end" },
      replaceExisting: true,
    });
    const creatureCopy = detectedCreatures.length
      ? detectedCreatures.map((combatant) => `${combatant.creatureType} at ${combatant.position.x},${combatant.position.y}`).join(", ")
      : "no qualifying creatures";
    const auraCopy = detectedAuras.length
      ? [...new Set(detectedAuras.map((cell) => cell.divineAura))].join(" and ") + " presence"
      : "no consecrated or desecrated presence";
    const summary = `${active.name} uses ${feature.name} and senses ${creatureCopy}; ${auraCopy}.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  return { legal: false, reason: `${feature.name} does not have an executable resolution.`, encounter };
}
