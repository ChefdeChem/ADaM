import type { EncounterState } from "../domain/combat";
import { applyEffect, canHarmTarget, canSeeCombatant, isIncapacitated, removeEffect } from "./effects";
import { hasLineOfSightToPoint, gridDistanceFeet } from "./targeting";
import { resolveAbilityCheck } from "./ability-checks";
import { resolveAttackRoll, resolveAttackDamage, validateAttackChoice } from "./combat-options";

const actorOf = (e: EncounterState) => e.combatants[e.activeIndex];
const expires = (e: EncounterState) => ({ round: e.round + 1, combatantId: actorOf(e).id, phase: "start" as const });
export function nearbyDoors(e: EncounterState) {
  const actor = actorOf(e);
  return e.map.terrain.filter(c => c.door && Math.max(Math.abs(c.x - actor.position.x), Math.abs(c.y - actor.position.y)) <= 1);
}
export function validateInteraction(e: EncounterState, action: string): { legal: boolean; reason?: string } {
  const actor = actorOf(e);
  if (!actor || actor.side !== "player" || actor.hitPoints.current <= 0 || isIncapacitated(e, actor.id) || e.pendingResponse) return { legal: false, reason: "Resolve pending responses; you must be conscious and able to act on your turn." };
  if (action === "hide") {
    const enemies = e.combatants.filter(c => c.side !== actor.side && c.hitPoints.current > 0);
    // Current maps model Total Cover with solid walls. Half cover is not enough.
    if (!enemies.length || enemies.some(c => hasLineOfSightToPoint(e, c.id, actor.position.x, actor.position.y))) return { legal: false, reason: "Hide currently requires Total Cover from every enemy. Half cover does not qualify." };
  }
  if (action === "help" && !e.combatants.some(c => c.side === actor.side && c.id !== actor.id && c.deathSaves.failures < 3)) return { legal: false, reason: "Help requires another ally. This encounter has no eligible ally." };
  if (["utilize", "use-object"].includes(action) && !nearbyDoors(e).length) return { legal: false, reason: "Move within 5 feet of a modeled door to interact. Other objects need their own supported definition." };
  if (action === "ready" && !actor.attacks.length) return { legal: false, reason: "Choose a carried weapon for the supported readied attack." };
  return { legal: true };
}
function spendAction(e: EncounterState) { return { ...e, turn: { ...e.turn, action: false } }; }
export function endHiding(e: EncounterState, id: string, reason: string): EncounterState {
  let next = e;
  for (const effect of e.effects.filter(x => x.targetCombatantId === id && x.hidden)) next = removeEffect(next, effect.id, reason);
  return next;
}
export function hide(e: EncounterState, random = Math.random) {
  const validation = validateInteraction(e, "hide");
  if (!validation.legal || !e.turn.action) return { legal: false as const, encounter: e, reason: validation.reason ?? "Your Action is unavailable." };
  const actor = actorOf(e), result = resolveAbilityCheck(spendAction(e), actor.id, "stealth", { dc: 15, random })!;
  let next = endHiding(result.encounter, actor.id, "new Hide attempt");
  if (result.succeeded) next = applyEffect(next, { name: "Hidden", description: "Invisible while hidden; ends after an attack roll, loud noise, verbal spell, or being found.", sourceCombatantId: actor.id, targetCombatantId: actor.id, conditionGranted: "Invisible", consumeOnAttackRoll: true, hidden: { dc: result.total, lastKnownPosition: { ...actor.position } } });
  return { legal: true as const, encounter: next, roll: result.roll, summary: `${result.summary} ${result.succeeded ? `Hidden; finding you requires Perception DC ${result.total}.` : "You remain detectable."}` };
}
export function help(e: EncounterState, mode: "attack" | "stabilize", targetId: string, random = Math.random) {
  const actor = actorOf(e), target = e.combatants.find(c => c.id === targetId);
  const denied = (reason: string) => ({ legal: false as const, encounter: e, reason });
  const valid = validateInteraction(e, "help");
  if (!valid.legal || !e.turn.action) return denied(valid.reason ?? "Your Action is unavailable.");
  if (!target || target.id === actor.id || gridDistanceFeet(actor, target) > 5 || !hasLineOfSightToPoint(e, actor.id, target.position.x, target.position.y)) return denied("Choose a reachable creature within 5 feet.");
  if (mode === "attack") {
    if (target.side === actor.side || target.hitPoints.current <= 0 || !canHarmTarget(e, actor.id, target.id)) return denied("Choose a living enemy to distract for an ally.");
    const next = applyEffect(spendAction(e), { name: "Help attack", description: "The next ally attack against this enemy has Advantage before the helper's next turn.", sourceCombatantId: actor.id, targetCombatantId: target.id, helpAttack: true, expiresAt: expires(e), replaceExisting: true });
    return { legal: true as const, encounter: next, summary: `${actor.name} distracts ${target.name}. The next ally attack against this enemy has Advantage.` };
  }
  if (target.side !== actor.side || target.hitPoints.current !== 0 || target.deathSaves.failures >= 3 || target.stabilized) return denied("Choose an unstable ally at 0 HP who has not died.");
  const r = resolveAbilityCheck(spendAction(e), actor.id, "medicine", { dc: 10, random })!;
  const next = r.succeeded ? { ...r.encounter, combatants: r.encounter.combatants.map(c => c.id === targetId ? { ...c, stabilized: true, deathSaves: { successes: 0, failures: 0 } } : c) } : r.encounter;
  return { legal: true as const, encounter: next, roll: r.roll, summary: `${r.summary} ${target.name} ${r.succeeded ? "is stable at 0 HP and remains unconscious" : "remains unstable"}.` };
}
export function interactWithDoor(e: EncounterState, x: number, y: number) {
  const valid = validateInteraction(e, "utilize"), actor = actorOf(e);
  const denied = (reason: string) => ({ legal: false as const, encounter: e, reason });
  if (!valid.legal) return denied(valid.reason!);
  const door = nearbyDoors(e).find(c => c.x === x && c.y === y);
  if (!door || door.door?.locked) return denied("The door is unavailable or locked. No unlocking result is assumed.");
  if (e.combatants.some(c => c.position.x === x && c.position.y === y)) return denied("A creature occupies the doorway.");
  const usesAction = Boolean(e.turn.objectInteractionUsed);
  if (usesAction && !e.turn.action) return denied("Your free object interaction and Action have already been used.");
  const kind = door.kind === "wall" ? "open-door" as const : "wall" as const;
  const summary = `${actor.name} ${kind === "wall" ? "closes" : "opens"} ${door.label}, using ${usesAction ? "the Utilize Action" : "the turn's free object interaction"}.`;
  let next: EncounterState = { ...e, turn: { ...e.turn, action: usesAction ? false : e.turn.action, objectInteractionUsed: true }, map: { ...e.map, terrain: e.map.terrain.map(c => c === door ? { ...c, kind } : c) }, log: [summary, ...e.log] };
  if (door.door?.noisy) next = endHiding(next, actor.id, "audible door interaction");
  return { legal: true as const, encounter: next, summary };
}
export function readyAttack(e: EncounterState, attackId: string, targetId: string) {
  const actor = actorOf(e), target = e.combatants.find(c => c.id === targetId);
  const valid = validateInteraction(e, "ready");
  if (!valid.legal || !e.turn.action || !actor.attacks.some(a => a.id === attackId) || !target || target.side === actor.side || target.hitPoints.current <= 0) return { legal: false as const, encounter: e, reason: valid.reason ?? "Choose a carried weapon and living enemy while your Action is available." };
  const summary = `Ready: after ${target.name} finishes moving, you may use a Reaction to attack with the selected weapon if the target is visible and in range. Expires at your next turn.`;
  const next = applyEffect(spendAction(e), { name: "Readied attack", description: summary, sourceCombatantId: actor.id, targetCombatantId: actor.id, expiresAt: expires(e), modifiers: { endsOnIncapacitated: true }, readiedAttack: { attackId, targetId }, replaceExisting: true });
  return { legal: true as const, encounter: next, summary };
}
export function queueReadiedAttack(e: EncounterState, movingId: string): EncounterState {
  if (e.pendingResponse) return e;
  const mover = e.combatants.find(c => c.id === movingId);
  const key = `${e.round}:${movingId}:${mover?.position.x},${mover?.position.y}:${e.turn.movementRemaining}`;
  const effect = e.effects.find(x => x.readiedAttack?.targetId === movingId && x.readiedAttack.eventKey !== key);
  if (!effect?.readiedAttack) return e;
  const owner = e.combatants.find(c => c.id === effect.sourceCombatantId);
  let next = { ...e, effects: e.effects.map(x => x.id === effect.id ? { ...x, readiedAttack: { ...effect.readiedAttack!, eventKey: key } } : x) };
  if (!owner?.reactionAvailable || isIncapacitated(e, owner.id) || !canSeeCombatant(e, owner.id, movingId)) return next;
  const attack = owner.attacks.find(a => a.id === effect.readiedAttack!.attackId);
  const context = { ...next, activeIndex: next.combatants.findIndex(c => c.id === owner.id), selectedTargetId: movingId, turn: { ...next.turn, action: true } };
  if (!attack || !validateAttackChoice(context, attack).legal) return next;
  next = { ...next, pendingResponse: { type: "readied-attack", phase: "choice", effectId: effect.id, sourceCombatantId: owner.id, targetCombatantId: movingId, attackId: attack.id } };
  return next;
}
export function resolveReadiedAttack(e: EncounterState, choice: "accept" | "decline" | "roll", random = Math.random) {
  const p = e.pendingResponse;
  if (p?.type !== "readied-attack") return { encounter: e, summary: "No readied attack is pending." };
  const owner = e.combatants.find(c => c.id === p.sourceCombatantId), attack = owner?.attacks.find(a => a.id === p.attackId);
  if (choice === "decline" || !owner || !attack) return { encounter: { ...e, pendingResponse: null }, summary: "Trigger ignored; Reaction preserved." };
  if (p.phase === "choice") return { encounter: { ...removeEffect(e, p.effectId, "Ready released"), pendingResponse: { ...p, phase: "attack-roll" as const } }, summary: "Roll the readied weapon attack." };
  const context = { ...e, pendingResponse: null, activeIndex: e.combatants.findIndex(c => c.id === owner.id), selectedTargetId: p.targetCombatantId, turn: { ...e.turn, action: true } };
  if (p.phase === "attack-roll") {
    if (!owner.reactionAvailable || !canSeeCombatant(e, owner.id, p.targetCombatantId)) return { encounter: { ...e, pendingResponse: null }, summary: "Reaction or visible target is no longer available." };
    const r = resolveAttackRoll(context, attack, random);
    if (!r.legal) return { encounter: { ...e, pendingResponse: null }, summary: r.reason };
    return { encounter: { ...r.encounter, activeIndex: e.activeIndex, selectedTargetId: e.selectedTargetId, turn: e.turn, combatants: r.encounter.combatants.map(c => c.id === owner.id ? { ...c, reactionAvailable: false } : c), pendingResponse: r.hit ? { ...p, phase: "damage-roll" as const, critical: r.critical } : null }, roll: r.roll, summary: r.summary };
  }
  const r = resolveAttackDamage(context, attack, p.targetCombatantId, p.critical, random, owner.id);
  return { encounter: { ...r.encounter, activeIndex: e.activeIndex, selectedTargetId: e.selectedTargetId, turn: e.turn }, roll: r.legal ? r.roll : undefined, summary: r.legal ? r.summary : r.reason };
}

export function helpAbility(e: EncounterState, targetId: string, skill: string, assistanceConfirmed: boolean) {
  const actor = actorOf(e), target = e.combatants.find(c => c.id === targetId);
  const valid = validateInteraction(e, "help");
  const denied = (reason: string) => ({ legal: false as const, encounter: e, reason });
  if (!valid.legal || !e.turn.action) return denied(valid.reason ?? "Your Action is unavailable.");
  if (!assistanceConfirmed) return denied("Confirm that the ally can understand and use your assistance in this situation.");
  if (!target || target.id === actor.id || target.side !== actor.side || target.hitPoints.current <= 0 || gridDistanceFeet(actor, target) > 5 || !hasLineOfSightToPoint(e, actor.id, target.position.x, target.position.y)) return denied("This assistance surface requires a conscious adjacent ally.");
  if (!actor.skillProficiencies.includes(skill)) return denied("The helper must have the selected skill proficiency.");
  const summary = `${actor.name} assists ${target.name}'s next ${skill} check before the helper's next turn. Assistance feasibility is player-confirmed.`;
  return { legal: true as const, summary, encounter: applyEffect(spendAction(e), { name: "Help skill", description: summary, sourceCombatantId: actor.id, targetCombatantId: target.id, helpCheck: skill, modifiers: { abilityCheckAdvantages: [skill] }, expiresAt: expires(e), replaceExisting: true }) };
}
