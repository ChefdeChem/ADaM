import type { Character, CharacterFeatureAction } from "../domain/character";
import type { CombatAction, EncounterState } from "../domain/combat";
import { effectiveSpeed } from "./effects";
import { spendNamedResource, validateNamedResource } from "./resources";

export type FeatureActionResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState };

export type FeatureActionOptions = {
  resourceAmount?: number;
  targetCombatantId?: string;
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
    const missingHitPoints = target.hitPoints.maximum - target.hitPoints.current;
    if (missingHitPoints <= 0) return { legal: false, reason: `${target.name} is already at maximum Hit Points.` };
    if (resourceAmount > missingHitPoints) return { legal: false, reason: `${target.name} can regain at most ${missingHitPoints} Hit Points.` };
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

  return { legal: false, reason: `${feature.name} does not have an executable resolution.`, encounter };
}
