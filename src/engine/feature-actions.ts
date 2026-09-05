import type { Character, CharacterFeatureAction } from "../domain/character";
import type { CombatAction, EncounterState } from "../domain/combat";
import { applyEffect, canOccupyCells, canRegainHitPoints, effectiveDamageAmount, effectiveSavingThrowModifier, effectiveSpeed, extendRage, isIncapacitated, removeCondition, removeEffect, savingThrowRollMode } from "./effects";
import { analyzeTarget, hasLineOfSightToPoint } from "./targeting";
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
  removePoisoned?: boolean;
  afflictionEffectIds?: string[];
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
  if (isIncapacitated(encounter, active.id)) return { legal: false, reason: "An incapacitated character cannot use this feature." };
  if (feature.cost === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (feature.cost === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  if (feature.cost === "reaction" && !encounter.turn.reaction) return { legal: false, reason: "Your Reaction is unavailable." };
  const resourceAmount = feature.resourceCost === "variable" ? options.resourceAmount : feature.resourceCost;
  if (resourceAmount === undefined) return { legal: false, reason: `Choose how many points to spend on ${feature.name}.` };
  const removingPoison = Boolean(options.removePoisoned && feature.resolution.type === "healing-pool" && feature.resolution.removesPoisoned);
  const afflictionEffectIds = feature.resolution.type === "healing-pool" ? [...new Set(options.afflictionEffectIds ?? [])] : [];
  const afflictionCost = afflictionEffectIds.length * 5;
  if (options.removePoisoned && !removingPoison) return { legal: false, reason: "This feature does not support Poisoned-condition removal." };
  if (!Number.isInteger(resourceAmount) || resourceAmount < (removingPoison || afflictionEffectIds.length ? 0 : 1)) return { legal: false, reason: `${feature.name} must spend a positive whole number of points, or 5 points for each recovery choice.` };
  const resource = validateNamedResource(encounter, active.id, feature.resourceName, resourceAmount + (removingPoison ? 5 : 0) + afflictionCost);
  if (!resource.legal) return resource;

  if (feature.resolution.type === "healing-pool") {
    const target = encounter.combatants.find((combatant) => combatant.id === (options.targetCombatantId ?? active.id));
    if (!target) return { legal: false, reason: "The healing target is no longer available." };
    if (feature.resolution.excludedCreatureTypes?.some((type) => type.toLowerCase() === target.creatureType?.toLowerCase())) return { legal: false, reason: `${feature.name} has no effect on ${target.creatureType} creatures in this edition.` };
    const distanceFeet = Math.max(Math.abs(active.position.x - target.position.x), Math.abs(active.position.y - target.position.y)) * 5;
    if (distanceFeet > feature.resolution.rangeFeet) return { legal: false, reason: `${target.name} is ${distanceFeet} feet away; ${feature.name} requires touch.` };
    if (!hasLineOfSightToPoint(encounter, active.id, target.position.x, target.position.y)) return { legal: false, reason: "A solid obstacle prevents touching that creature." };
    if (target.deathSaves.failures >= 3) return { legal: false, reason: `${target.name} has died and cannot regain Hit Points from ${feature.name}.` };
    if (removingPoison && !target.conditions.some((condition) => condition.toLowerCase() === "poisoned")) return { legal: false, reason: `${target.name} is not Poisoned.` };
    for (const effectId of afflictionEffectIds) {
      const affliction = encounter.effects.find((effect) => effect.id === effectId && effect.targetCombatantId === target.id && effect.afflictionKind);
      if (!affliction || !feature.resolution.removesAfflictions?.includes(affliction.afflictionKind!)) return { legal: false, reason: "Choose a registered disease or poison affecting the target." };
    }
    if (resourceAmount > 0 && !canRegainHitPoints(encounter, target.id)) return { legal: false, reason: `${target.name} cannot regain Hit Points right now.` };
    const missingHitPoints = target.hitPoints.maximum - target.hitPoints.current;
    if (missingHitPoints <= 0 && !removingPoison && !afflictionEffectIds.length) return { legal: false, reason: `${target.name} is already at maximum Hit Points.` };
    if (resourceAmount > missingHitPoints) return { legal: false, reason: `${target.name} can regain at most ${missingHitPoints} Hit Points.` };
  }
  if (feature.resolution.type === "area-saving-throw") {
    const targetId = options.targetCombatantId ?? encounter.selectedTargetId;
    if (!targetId) return { legal: false, reason: "Select a creature to set the area's direction." };
    return validateAreaAim(encounter, active.id, targetId, feature.resolution.area);
  }
  if (feature.resolution.type === "grant-roll-bonus") {
    const target = encounter.combatants.find((combatant) => combatant.id === options.targetCombatantId);
    if (!target) return { legal: false, reason: `Choose a creature to receive ${feature.name}.` };
    if (target.side !== active.side) return { legal: false, reason: `${feature.name} requires a friendly target.` };
    if (feature.resolution.excludesSelf && target.id === active.id) return { legal: false, reason: `${feature.name} must target another creature.` };
    const distanceFeet = Math.max(Math.abs(active.position.x - target.position.x), Math.abs(active.position.y - target.position.y)) * 5;
    if (distanceFeet > feature.resolution.rangeFeet) return { legal: false, reason: `${target.name} is outside ${feature.name}'s ${feature.resolution.rangeFeet}-foot range.` };
    if (feature.resolution.requiresHearing && target.conditions.some((condition) => condition.toLowerCase() === "deafened")) return { legal: false, reason: `${target.name} cannot hear ${feature.name}.` };
  }
  if (feature.resolution.type === "activate-large-form") {
    if (active.level < feature.resolution.minimumLevel) return { legal: false, reason: `${feature.name} requires level ${feature.resolution.minimumLevel}.` };
    if (active.size === "large" || encounter.effects.some((effect) => effect.sourceCombatantId === active.id && effect.modifiers.size === "large")) return { legal: false, reason: `${active.name} is already Large.` };
    if (feature.resolution.requiresLargeSpace && !canOccupyCells(encounter, active.id, active.position, true)) return { legal: false, reason: `${active.name} does not have an open 10-foot-by-10-foot space for Large Form.` };
  }
  const resolution = feature.resolution;
  if (resolution.type === "activate-effect" && encounter.effects.some((effect) =>
    effect.name === resolution.effect.name
    && effect.sourceCombatantId === active.id
    && effect.targetCombatantId === active.id)) {
    return { legal: false, reason: `${resolution.effect.name} is already active.` };
  }
  if (feature.id === "rage" && active.armorCategory === "heavy") return { legal: false, reason: "Rage cannot begin while wearing Heavy armor." };
  return { legal: true };
}

export function executeFeatureAction(encounter: EncounterState, feature: CharacterFeatureAction, options: FeatureActionOptions = {}): FeatureActionResolution {
  const validation = validateFeatureAction(encounter, feature, options);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That feature is not available.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const resourceAmount = feature.resourceCost === "variable" ? options.resourceAmount! : feature.resourceCost;
  const afflictionEffectIds = feature.resolution.type === "healing-pool" ? [...new Set(options.afflictionEffectIds ?? [])] : [];
  let next = spendNamedResource(encounter, active.id, feature.resourceName, resourceAmount + (options.removePoisoned ? 5 : 0) + afflictionEffectIds.length * 5);
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
    if (areaTargets(encounter, active.id, targetId, feature.resolution.area).some((target) => target.side !== active.side)) next = extendRage(next, active.id);
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
            deathSaves: resourceAmount > 0 && combatant.hitPoints.current === 0 ? { successes: 0, failures: 0 } : combatant.deathSaves,
            stabilized: resourceAmount > 0 ? false : combatant.stabilized,
          }
        : combatant),
    };
    if (options.removePoisoned) next = removeCondition(next, targetId, "poisoned");
    const removedAfflictions = afflictionEffectIds.map((effectId) => next.effects.find((effect) => effect.id === effectId)).filter(Boolean);
    for (const effectId of afflictionEffectIds) next = removeEffect(next, effectId, "Lay on Hands removed the affliction");
    const recoveryCopy = [options.removePoisoned ? "Poisoned" : "", ...removedAfflictions.map((effect) => effect!.name)].filter(Boolean);
    const summary = `${active.name} uses ${feature.name}; ${target.name} regains ${resourceAmount} Hit Point${resourceAmount === 1 ? "" : "s"}${recoveryCopy.length ? ` and loses ${recoveryCopy.join(" and ")}` : ""}.`;
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
      maximumExpiresAtRound: feature.id === "rage" ? encounter.round + 100 : undefined,
    });
    const summary = `${active.name} uses ${feature.name}; ${feature.resolution.effect.name} is active until the end of their next turn.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "grant-roll-bonus") {
    const targetId = options.targetCombatantId!;
    const target = next.combatants.find((combatant) => combatant.id === targetId)!;
    next = applyEffect({ ...next, turn }, {
      name: feature.name,
      description: feature.description,
      sourceCombatantId: active.id,
      targetCombatantId: targetId,
      durationRounds: feature.resolution.durationRounds,
      rollBonus: { die: feature.resolution.die, appliesTo: feature.resolution.appliesTo },
      consumeOnRollBonus: true,
      replaceExisting: true,
    });
    const summary = `${active.name} grants ${target.name} ${feature.name} (${feature.resolution.die}) for ${feature.resolution.durationRounds} rounds.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "activate-large-form") {
    next = applyEffect({ ...next, turn }, {
      name: feature.name,
      description: feature.description,
      sourceCombatantId: active.id,
      targetCombatantId: active.id,
      durationRounds: feature.resolution.durationRounds,
      modifiers: { size: "large", speedFeet: feature.resolution.speedBonusFeet, abilityCheckAdvantages: ["strength"] },
      replaceExisting: true,
    });
    const summary = `${active.name} uses ${feature.name}, becomes Large, gains advantage on Strength checks, and gains ${feature.resolution.speedBonusFeet} feet of Speed.`;
    return { legal: true, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }

  if (feature.resolution.type === "sense-creature-types") {
    const resolution = feature.resolution;
    const detectableTypes = new Set(feature.resolution.creatureTypes.map((creatureType) => creatureType.toLowerCase()));
    const detectedCreatures = next.combatants.filter((combatant) => {
      if (combatant.id === active.id || combatant.hitPoints.current <= 0 || !detectableTypes.has(combatant.creatureType?.toLowerCase() ?? "")) return false;
      const analysis = analyzeTarget(next, combatant.id);
      return Boolean(analysis && analysis.distanceFeet <= resolution.rangeFeet
        && (!resolution.blockedByTotalCover || analysis.lineOfSight));
    });
    const detectedAuras = next.map.terrain.filter((cell) => cell.divineAura
      && Math.max(Math.abs(active.position.x - cell.x), Math.abs(active.position.y - cell.y)) * 5 <= resolution.rangeFeet);
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

export function extendRageWithBonusAction(encounter: EncounterState, combatantId: string): FeatureActionResolution {
  if (encounter.pendingResponse || isIncapacitated(encounter, combatantId)) return { legal: false, reason: "Resolve pending responses first; incapacitated characters cannot extend Rage.", encounter };
  const actor = encounter.combatants.find((combatant) => combatant.id === combatantId);
  if (!actor || encounter.combatants[encounter.activeIndex]?.id !== combatantId || actor.side !== "player") return { legal: false, reason: "Rage can be extended only on the raging character's turn.", encounter };
  if (!encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn.", encounter };
  const next = extendRage(encounter, combatantId);
  if (next === encounter) return { legal: false, reason: "No active Rage can be extended right now.", encounter };
  const summary = `${actor.name} uses a Bonus Action to extend Rage.`;
  return { legal: true, summary, encounter: { ...next, turn: { ...next.turn, bonusAction: false }, log: [summary, ...next.log] } };
}
