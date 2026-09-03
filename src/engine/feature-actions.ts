import type { Character, CharacterFeatureAction } from "../domain/character";
import type { CombatAction, EncounterState } from "../domain/combat";
import { effectiveSpeed } from "./effects";
import { spendNamedResource, validateNamedResource } from "./resources";

export type FeatureActionResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState };

export function featureCombatActions(character: Character): CombatAction[] {
  return (character.featureActions ?? []).map((feature) => ({
    id: feature.id,
    name: feature.name,
    cost: feature.cost,
    description: feature.description,
    rulesets: [feature.provenance.rulesetId],
    resourceCost: { resourceName: feature.resourceName, amount: feature.resourceCost },
  }));
}

export function validateFeatureAction(encounter: EncounterState, feature: CharacterFeatureAction): { legal: boolean; reason?: string } {
  const active = encounter.combatants[encounter.activeIndex];
  if (encounter.pendingResponse) return { legal: false, reason: "Resolve the pending player response first." };
  if (!active || active.side !== "player") return { legal: false, reason: "Feature actions are available only on the player's turn." };
  if (active.hitPoints.current <= 0) return { legal: false, reason: "An unconscious character cannot use this feature." };
  if (feature.cost === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (feature.cost === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  if (feature.cost === "reaction" && !encounter.turn.reaction) return { legal: false, reason: "Your Reaction is unavailable." };
  return validateNamedResource(encounter, active.id, feature.resourceName, feature.resourceCost);
}

export function executeFeatureAction(encounter: EncounterState, feature: CharacterFeatureAction): FeatureActionResolution {
  const validation = validateFeatureAction(encounter, feature);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That feature is not available.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  let next = spendNamedResource(encounter, active.id, feature.resourceName, feature.resourceCost);

  if (feature.resolution.type === "dash-and-temporary-hit-points") {
    const temporaryHitPoints = feature.resolution.temporaryHitPoints === "proficiency-bonus" ? active.proficiencyBonus : 0;
    const movementGained = effectiveSpeed(next, active.id);
    next = {
      ...next,
      turn: {
        ...next.turn,
        action: feature.cost === "action" ? false : next.turn.action,
        bonusAction: feature.cost === "bonus-action" ? false : next.turn.bonusAction,
        reaction: feature.cost === "reaction" ? false : next.turn.reaction,
        movementRemaining: next.turn.movementRemaining + movementGained,
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

  return { legal: false, reason: `${feature.name} does not have an executable resolution.`, encounter };
}
