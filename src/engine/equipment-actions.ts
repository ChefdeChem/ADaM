import type { EncounterState } from "../domain/combat";

export function hasSpellcastingFocus(encounter: EncounterState, combatantId: string, spellcastingClass: string): boolean {
  return Boolean(encounter.combatants.find((combatant) => combatant.id === combatantId)?.inventory.some((item) =>
    item.current > 0 && item.spellcastingFocusFor?.toLowerCase() === spellcastingClass.toLowerCase()));
}

export function setLightSourceMode(encounter: EncounterState, combatantId: string, itemId: string, mode: "off" | "bright" | "hooded"):
  { legal: boolean; reason: string; encounter: EncounterState } {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const item = combatant?.inventory.find((candidate) => candidate.id === itemId);
  if (!combatant || !item?.lightSource) return { legal: false, reason: "That light source is not available.", encounter };
  const cost = item.lightSource.adjustmentCost;
  if (cost === "action" && !encounter.turn.action) return { legal: false, reason: "Changing the hooded lantern requires an available Action.", encounter };
  if (cost === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Changing the hooded lantern requires an available Bonus Action.", encounter };
  if (mode !== "off" && item.lightSource.fuelMinutesRemaining <= 0) return { legal: false, reason: `${item.name} has no fuel remaining.`, encounter };
  const next = {
    ...encounter,
    turn: { ...encounter.turn, action: cost === "action" ? false : encounter.turn.action, bonusAction: cost === "bonus-action" ? false : encounter.turn.bonusAction },
    combatants: encounter.combatants.map((candidate) => candidate.id === combatantId ? {
      ...candidate,
      inventory: candidate.inventory.map((inventoryItem) => inventoryItem.id === itemId && inventoryItem.lightSource
        ? { ...inventoryItem, lightSource: { ...inventoryItem.lightSource, mode } }
        : inventoryItem),
    } : candidate),
  };
  const illumination = mode === "bright"
    ? `${item.lightSource.brightLightFeet} feet of bright light plus ${item.lightSource.dimLightFeet} additional feet of dim light`
    : mode === "hooded" ? `${item.lightSource.hoodedDimLightFeet} feet of dim light` : "no light";
  const reason = `${combatant.name} sets ${item.name} to ${mode}; it now casts ${illumination}.`;
  return { legal: true, reason, encounter: { ...next, log: [reason, ...next.log] } };
}

export function elapseLightFuel(encounter: EncounterState, minutes: number): EncounterState {
  if (minutes <= 0) return encounter;
  return {
    ...encounter,
    combatants: encounter.combatants.map((combatant) => ({
      ...combatant,
      inventory: combatant.inventory.map((item) => item.lightSource && item.lightSource.mode !== "off"
        ? { ...item, lightSource: { ...item.lightSource, fuelMinutesRemaining: Math.max(0, item.lightSource.fuelMinutesRemaining - minutes), mode: item.lightSource.fuelMinutesRemaining <= minutes ? "off" : item.lightSource.mode } }
        : item),
    })),
  };
}
