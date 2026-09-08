import type { EncounterState } from "../domain/combat";
import { rollD20, type RollMode } from "./dice";
import { abilityCheckRollMode, applyEffect, automaticallyFailsSave, canHarmTarget, effectiveSavingThrowModifier, effectiveSize, effectsForCombatant, extendRage, isIncapacitated, occupiedCells, reconcileConcentration, removeEffect, savingThrowRollMode } from "./effects";
import { resolveAbilityCheck } from "./ability-checks";
import { analyzeTarget, hasLineOfSightToPoint } from "./targeting";
import { crossesSolidCorner } from "./grid-movement";
import { grappledHandCount } from "./weapon-hands";

type SaveAbility = "strength" | "dexterity";
export type EscapeAbility = "athletics" | "acrobatics";
const sizes = ["small", "medium", "large"];

export function grappleEffectsFrom(e: EncounterState, sourceId: string) {
  return e.effects.filter(effect => effect.sourceCombatantId === sourceId && effect.grapple);
}
export function grappleEffectsOn(e: EncounterState, targetId: string) {
  return e.effects.filter(effect => effect.targetCombatantId === targetId && effect.grapple);
}

function saveDetails(e: EncounterState, id: string, ability: SaveAbility) {
  const cover = ability === "dexterity" && analyzeTarget(e, id)?.cover === "half" ? 2 : 0;
  return { ability, modifier: effectiveSavingThrowModifier(e, id, ability) + cover,
    mode: savingThrowRollMode(e, id, "Grappled", "normal", ability),
    autoFail: automaticallyFailsSave(e, id, ability) };
}
function chance(dc: number, modifier: number, mode: RollMode, autoFail: boolean) {
  if (autoFail) return 0;
  const p = Math.max(0, Math.min(1, (21 + modifier - dc) / 20));
  return mode === "advantage" ? 1 - (1 - p) ** 2 : mode === "disadvantage" ? p ** 2 : p;
}

export function validateGrapple(e: EncounterState, targetId: string) {
  const actor = e.combatants[e.activeIndex], target = e.combatants.find(c => c.id === targetId);
  const deny = (reason: string) => ({ legal: false as const, reason });
  if (!actor || actor.side !== "player" || actor.hitPoints.current <= 0 || isIncapacitated(e, actor.id) || e.pendingResponse) return deny("Grapple requires your conscious turn with no pending response.");
  if (!e.combatants.every(c => c.initiativeRolled)) return deny("Roll initiative first.");
  if (!e.turn.action) return deny("Your Action has already been used.");
  if (!target || target.id === actor.id || target.side !== "enemy" || target.hitPoints.current <= 0) return deny("Choose a living enemy to grapple.");
  if (!canHarmTarget(e, actor.id, target.id)) return deny("A charm prevents attacking this creature.");
  if (grappleEffectsOn(e, targetId).some(effect => effect.sourceCombatantId === actor.id)) return deny("You are already grappling this target.");
  if ((actor.heldWeaponIds?.length ?? 0) + grappledHandCount(e, actor.id) + (actor.hasEquippedShield ? 1 : 0) >= 2) return deny("Grapple requires a free hand. Stow a weapon or release another grapple first.");
  if (sizes.indexOf(effectiveSize(e, target.id)) > sizes.indexOf(effectiveSize(e, actor.id)) + 1) return deny("The target is more than one size larger than you.");
  const reachable = occupiedCells(e, actor.id).some(from => occupiedCells(e, target.id).some(to => {
    const distance = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
    const context = { ...e, combatants: e.combatants.map(c => c.id === actor.id ? { ...c, position: from } : c) };
    return distance <= 1 && hasLineOfSightToPoint(context, actor.id, to.x, to.y);
  }));
  if (!reachable) return deny("Grapple reaches 5 feet and cannot pass through Total Cover.");
  if (e.effects.some(effect => effect.targetCombatantId === target.id && effect.hidden)) return deny("Find the hidden enemy before grappling it.");
  return { legal: true as const };
}

export function resolveGrapple(e: EncounterState, targetId: string, random = Math.random) {
  const validation = validateGrapple(e, targetId);
  if (!validation.legal) return { legal: false as const, encounter: e, reason: validation.reason };
  const actor = e.combatants[e.activeIndex], target = e.combatants.find(c => c.id === targetId)!;
  const dc = 8 + actor.abilityModifiers.strength + actor.proficiencyBonus;
  const strength = saveDetails(e, targetId, "strength"), dexterity = saveDetails(e, targetId, "dexterity");
  const save = chance(dc, dexterity.modifier, dexterity.mode, dexterity.autoFail) > chance(dc, strength.modifier, strength.mode, strength.autoFail) ? dexterity : strength;
  const roll = save.autoFail ? null : rollD20({ mode: save.mode, modifier: save.modifier, random });
  const saved = !save.autoFail && roll!.total >= dc;
  let next: EncounterState = { ...e, turn: { ...e.turn, action: false, attackEquipmentChangeAvailable: true } };
  next = extendRage(next, actor.id);
  const immune = [...target.conditionImmunities, ...effectsForCombatant(next, targetId).flatMap(effect => effect.modifiers.conditionImmunities ?? [])].some(c => c.toLowerCase() === "grappled");
  if (!saved && !immune) next = applyEffect(next, { name: `Grappled by ${actor.name}`, description: `Speed 0; attacks against creatures other than ${actor.name} have Disadvantage. Escape DC ${dc}.`, sourceCombatantId: actor.id, targetCombatantId: target.id, conditionGranted: "Grappled", grapple: { escapeDc: dc, rangeFeet: 5 } });
  const outcome = saved ? "avoids Grappled" : immune ? "is immune to Grappled" : "gains Grappled";
  const summary = `${actor.name} attempts a Grapple, DC ${dc}. ${target.name} ${save.autoFail ? "automatically fails" : `chooses ${save.ability} and rolls ${roll!.total} (${save.mode})`} and ${outcome}. No damage or weapon on-hit effect applies.`;
  return { legal: true as const, encounter: { ...next, log: [summary, ...next.log] }, roll, saved, saveAbility: save.ability, dc, summary };
}

export function validateGrappleEscape(e: EncounterState, effectId: string) {
  const actor = e.combatants[e.activeIndex], effect = e.effects.find(candidate => candidate.id === effectId && candidate.grapple);
  if (!actor || !effect || effect.targetCombatantId !== actor.id) return { legal: false as const, reason: "Choose a grapple currently affecting the active creature." };
  if (actor.hitPoints.current <= 0 || isIncapacitated(e, actor.id) || e.pendingResponse || !e.turn.action) return { legal: false as const, reason: "Escape requires your Action while conscious and able to act." };
  return { legal: true as const };
}

export function resolveGrappleEscape(e: EncounterState, effectId: string, ability: EscapeAbility, random = Math.random) {
  const validation = validateGrappleEscape(e, effectId);
  if (!validation.legal) return { legal: false as const, encounter: e, reason: validation.reason };
  const effect = e.effects.find(candidate => candidate.id === effectId)!;
  const actor = e.combatants[e.activeIndex], grappler = e.combatants.find(c => c.id === effect.sourceCombatantId);
  const checked = resolveAbilityCheck({ ...e, turn: { ...e.turn, action: false } }, actor.id, ability, { dc: effect.grapple!.escapeDc, random })!;
  const next = checked.succeeded ? removeEffect(checked.encounter, effect.id, `${actor.name} escaped`) : checked.encounter;
  const summary = `${actor.name} uses the Action to escape ${grappler?.name ?? "the grapple"}: ${ability} ${checked.total} vs DC ${effect.grapple!.escapeDc}, ${checked.succeeded ? "success" : "failure"}.`;
  return { legal: true as const, encounter: { ...next, log: [summary, ...next.log] }, roll: checked.roll, succeeded: checked.succeeded, summary };
}

export function releaseGrapple(e: EncounterState, effectId: string, sourceId: string) {
  const effect = e.effects.find(candidate => candidate.id === effectId && candidate.grapple && candidate.sourceCombatantId === sourceId);
  if (!effect) return { legal: false as const, encounter: e, reason: "That grapple is no longer held by this creature." };
  const source = e.combatants.find(c => c.id === sourceId), target = e.combatants.find(c => c.id === effect.targetCombatantId);
  const summary = `${source?.name ?? "The grappler"} releases ${target?.name ?? "the target"}. No Action required.`;
  const released = removeEffect(e, effect.id, "released voluntarily");
  return { legal: true as const, summary, encounter: { ...released, log: [summary, ...released.log] } };
}

export function resolveEnemyGrappleEscape(e: EncounterState, random = Math.random) {
  const actor = e.combatants[e.activeIndex], effect = actor ? grappleEffectsOn(e, actor.id)[0] : undefined;
  if (!actor || actor.side !== "enemy" || !effect || !e.turn.action || isIncapacitated(e, actor.id)) return null;
  const athletics = actor.skillModifiers.athletics ?? actor.abilityModifiers.strength;
  const acrobatics = actor.skillModifiers.acrobatics ?? actor.abilityModifiers.dexterity;
  const athleticsMode = abilityCheckRollMode(e, actor.id, "athletics"), acrobaticsMode = abilityCheckRollMode(e, actor.id, "acrobatics");
  const ability = chance(effect.grapple!.escapeDc, acrobatics, acrobaticsMode, false) > chance(effect.grapple!.escapeDc, athletics, athleticsMode, false) ? "acrobatics" : "athletics";
  return resolveGrappleEscape(e, effect.id, ability, random);
}

type Point = { x: number; y: number };
export function planGrappledStep(e: EncounterState, sourceId: string, to: Point, baseCost: number): { cost: number; dragged: Array<{ id: string; position: Point }> } | null {
  const source = e.combatants.find(c => c.id === sourceId);
  if (!source) return null;
  const grapples = grappleEffectsFrom(e, sourceId);
  if (!grapples.length) return { cost: baseCost, dragged: [] };
  const targets = grapples.map(effect => e.combatants.find(c => c.id === effect.targetCombatantId)).filter(Boolean) as EncounterState["combatants"];
  let simulated: EncounterState = { ...e, combatants: e.combatants.map(c => c.id === sourceId ? { ...c, position: to } : targets.some(t => t.id === c.id) ? { ...c, position: { x: -20, y: -20 } } : c) };
  const sourceCells = occupiedCells(simulated, sourceId);
  if (!sourceCells.every(cell => cell.x >= 0 && cell.y >= 0 && cell.x < e.map.width && cell.y < e.map.height
    && e.map.terrain.every(t => t.kind !== "wall" || t.x !== cell.x || t.y !== cell.y)
    && simulated.combatants.every(other => other.id === sourceId || !occupiedCells(simulated, other.id).some(o => o.x === cell.x && o.y === cell.y)))) return null;
  const dragged: Array<{ id: string; position: Point }> = [];
  for (const target of targets) {
    const candidates = [{ ...target.position }, { ...source.position }];
    for (const sourceCell of occupiedCells(simulated, sourceId)) for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) candidates.push({ x: sourceCell.x + dx, y: sourceCell.y + dy });
    const position = candidates.find((candidate, index) => candidates.findIndex(p => p.x === candidate.x && p.y === candidate.y) === index
      && Math.max(Math.abs(candidate.x - target.position.x), Math.abs(candidate.y - target.position.y)) <= 1
      && !crossesSolidCorner(e, target.id, target.position, candidate)
      && (() => { const context = { ...simulated, combatants: simulated.combatants.map(c => c.id === target.id ? { ...c, position: candidate } : c) }; return occupiedCells(context, target.id).every(cell => cell.x >= 0 && cell.y >= 0 && cell.x < e.map.width && cell.y < e.map.height && e.map.terrain.every(t => t.kind !== "wall" || t.x !== cell.x || t.y !== cell.y) && context.combatants.every(other => other.id === target.id || !occupiedCells(context, other.id).some(o => o.x === cell.x && o.y === cell.y))) && occupiedCells(context, sourceId).some(from => occupiedCells(context, target.id).some(targetCell => Math.max(Math.abs(from.x - targetCell.x), Math.abs(from.y - targetCell.y)) <= 1)); })());
    if (!position) return null;
    dragged.push({ id: target.id, position });
    simulated = { ...simulated, combatants: simulated.combatants.map(c => c.id === target.id ? { ...c, position } : c) };
  }
  const costsExtra = dragged.some(item => {
    const target = targets.find(candidate => candidate.id === item.id)!;
    const moved = item.position.x !== target.position.x || item.position.y !== target.position.y;
    return moved && sizes.indexOf(effectiveSize(e, sourceId)) - sizes.indexOf(effectiveSize(e, target.id)) < 2;
  });
  const cost = baseCost + (costsExtra ? 5 : 0);
  return { cost, dragged };
}

export function applyGrappledStep(e: EncounterState, sourceId: string, to: Point, baseCost: number) {
  const plan = planGrappledStep(e, sourceId, to, baseCost);
  if (!plan) return null;
  return { plan, encounter: reconcileConcentration({ ...e, combatants: e.combatants.map(c => {
    if (c.id === sourceId) return { ...c, position: to };
    const dragged = plan.dragged.find(item => item.id === c.id);
    return dragged ? { ...c, position: dragged.position } : c;
  }) }) };
}
