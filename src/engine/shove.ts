import type { EncounterState } from "../domain/combat";
import { rollD20, type RollMode } from "./dice";
import { applyEffect, automaticallyFailsSave, canHarmTarget, effectiveSavingThrowModifier, effectiveSize, effectsForCombatant, extendRage, isIncapacitated, occupiedCells, savingThrowRollMode } from "./effects";
import { analyzeTarget, hasLineOfSightToPoint } from "./targeting";
import { pushTargetAway } from "./areas";
import { resolvePointHazardsForCombatant } from "./point-effects";

export type ShoveMode = "prone" | "push";
type SaveAbility = "strength" | "dexterity";
const sizes = ["small", "medium", "large"];

/** SRD 5.2.1 p. 190. Own-turn Attack action, not a weapon hit or attack roll.
 * NPC saves are chosen by the trainer. Player-target saves need a choice UI.
 */
export function validateShove(e: EncounterState, targetId: string) {
  const actor = e.combatants[e.activeIndex], target = e.combatants.find(c => c.id === targetId);
  const deny = (reason: string) => ({ legal: false as const, reason });
  if (!actor || actor.side !== "player" || actor.hitPoints.current <= 0 || isIncapacitated(e, actor.id) || e.pendingResponse) return deny("Shove requires your conscious turn with no pending response.");
  if (!e.combatants.every(c => c.initiativeRolled)) return deny("Roll initiative first.");
  if (!e.turn.action) return deny("Your Action has already been used.");
  if (!target || target.id === actor.id || target.side !== "enemy" || target.hitPoints.current <= 0) return deny("This Shove surface supports a living enemy target.");
  if (!canHarmTarget(e, actor.id, target.id)) return deny("A charm prevents attacking this creature.");
  if (sizes.indexOf(effectiveSize(e, target.id)) > sizes.indexOf(effectiveSize(e, actor.id)) + 1) return deny("The target is more than one size larger than you.");
  const reachable = occupiedCells(e, actor.id).some(from => occupiedCells(e, target.id).some(to => {
    const distance = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
    const context = { ...e, combatants: e.combatants.map(c => c.id === actor.id ? { ...c, position: from } : c) };
    return distance <= 1 && hasLineOfSightToPoint(context, actor.id, to.x, to.y);
  }));
  if (!reachable) return deny("Shove reaches 5 feet and cannot pass through Total Cover; a Glaive does not extend it.");
  if (e.effects.some(effect => effect.targetCombatantId === target.id && effect.hidden)) return deny("Find the hidden enemy before using this targeted Shove surface.");
  return { legal: true as const };
}

function saveDetails(e: EncounterState, id: string, ability: SaveAbility, mode: ShoveMode) {
  const cover = ability === "dexterity" && analyzeTarget(e, id)?.cover === "half" ? 2 : 0;
  return { ability, modifier: effectiveSavingThrowModifier(e, id, ability) + cover,
    mode: savingThrowRollMode(e, id, mode === "prone" ? "Prone" : undefined, "normal", ability),
    autoFail: automaticallyFailsSave(e, id, ability) };
}
function chance(dc: number, modifier: number, mode: RollMode, autoFail: boolean) {
  if (autoFail) return 0;
  const p = Math.max(0, Math.min(1, (21 + modifier - dc) / 20));
  return mode === "advantage" ? 1 - (1 - p) ** 2 : mode === "disadvantage" ? p ** 2 : p;
}

export function resolveShove(e: EncounterState, targetId: string, mode: ShoveMode, random = Math.random) {
  const validation = validateShove(e, targetId);
  if (!validation.legal) return { legal: false as const, encounter: e, reason: validation.reason };
  if (mode !== "prone" && mode !== "push") return { legal: false as const, encounter: e, reason: "Choose knock Prone or push 5 feet." };
  const actor = e.combatants[e.activeIndex], target = e.combatants.find(c => c.id === targetId)!;
  const dc = 8 + actor.abilityModifiers.strength + actor.proficiencyBonus;
  const strength = saveDetails(e, targetId, "strength", mode), dexterity = saveDetails(e, targetId, "dexterity", mode);
  // Choose before rolling, including Dodge and other save modifiers.
  const save = chance(dc, dexterity.modifier, dexterity.mode, dexterity.autoFail) > chance(dc, strength.modifier, strength.mode, strength.autoFail) ? dexterity : strength;
  const roll = save.autoFail ? null : rollD20({ mode: save.mode, modifier: save.modifier, random });
  const saved = !save.autoFail && roll!.total >= dc;
  let next: EncounterState = { ...e, turn: { ...e.turn, action: false, attackEquipmentChangeAvailable: true } };
  next = extendRage(next, actor.id);
  let outcome = "resists the shove";
  if (!saved && mode === "prone") {
    const immune = [...target.conditionImmunities, ...effectsForCombatant(next, targetId).flatMap(effect => effect.modifiers.conditionImmunities ?? [])].some(c => c.toLowerCase() === "prone");
    if (!immune) next = applyEffect(next, { name: "Shove: Prone", description: "Knocked Prone by a 2024 Unarmed Strike. Stand using half your Speed.", sourceCombatantId: actor.id, targetCombatantId: targetId, conditionGranted: "Prone", replaceExisting: true });
    outcome = immune ? "is immune to Prone" : "is knocked Prone";
  } else if (!saved) {
    next = pushTargetAway(next, actor.id, targetId, 5);
    const position = next.combatants.find(c => c.id === targetId)!.position;
    const moved = position.x !== target.position.x || position.y !== target.position.y;
    outcome = moved ? "is pushed 5 feet without provoking an Opportunity Attack" : "cannot be pushed into the blocked space";
    if (moved) next = resolvePointHazardsForCombatant(next, targetId, random);
  }
  const summary = `${actor.name} uses Shove (${mode === "prone" ? "knock Prone" : "push"}), DC ${dc}. ${target.name} ${save.autoFail ? "automatically fails" : `chooses ${save.ability} and rolls ${roll!.total} (${save.mode})`}, and ${outcome}. No weapon damage or on-hit effects apply.`;
  return { legal: true as const, encounter: { ...next, log: [summary, ...next.log] }, roll, saved, saveAbility: save.ability, dc, summary };
}
