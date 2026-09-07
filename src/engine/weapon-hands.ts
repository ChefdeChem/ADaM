import type { CharacterAttack } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import { isIncapacitated } from "./effects";

export function validateWeaponHands(e: EncounterState, id: string, attack: CharacterAttack, mayDraw: boolean) {
  const actor = e.combatants.find(c => c.id === id);
  if (!actor || actor.heldWeaponIds === undefined) return { legal: true };
  const item = actor.inventory.find(item => item.attackIds.includes(attack.id));
  // Unarmed Strikes can be kicks; they do not require an empty hand.
  if (!item) return { legal: true };
  const held = actor.heldWeaponIds.includes(item.id);
  if (!held && !mayDraw) return { legal: false, reason: "Opportunity attacks require a weapon already in hand. Draw it on your turn first." };
  const needed = actor.heldWeaponIds.length + (held ? 0 : 1) + (attack.requiresTwoHands ? 1 : 0) + (actor.hasEquippedShield ? 1 : 0);
  if (needed > 2) return { legal: false, reason: "Not enough free hands. Stow a held weapon first; this attack cannot silently switch equipment." };
  return { legal: true };
}

export function drawWeaponForAttack(e: EncounterState, id: string, attack: CharacterAttack): EncounterState {
  const actor = e.combatants.find(c => c.id === id);
  const item = actor?.inventory?.find(item => item.attackIds.includes(attack.id));
  if (!actor || actor.heldWeaponIds === undefined || !item || actor.heldWeaponIds.includes(item.id)) return e;
  return { ...e, combatants: e.combatants.map(c => c.id === id ? { ...c, heldWeaponIds: [...actor.heldWeaponIds!, item.id] } : c),
    log: [`${actor.name} draws ${item.name} as part of the Attack action.`, ...e.log] };
}

export function handleWeapon(e: EncounterState, id: string, itemId: string) {
  const actor = e.combatants.find(c => c.id === id);
  const item = actor?.inventory.find(item => item.id === itemId && item.attackIds.length && item.current > 0);
  const deny = (reason: string) => ({ legal: false as const, encounter: e, reason });
  if (!actor || actor.heldWeaponIds === undefined || !item) return deny("Choose an available carried weapon.");
  if (e.pendingResponse || isIncapacitated(e, id)) return deny("Resolve pending choices; you must be able to act.");
  const setup = !e.combatants.some(c => c.initiativeRolled);
  if (!setup && e.combatants[e.activeIndex].id !== id) return deny("Change held weapons on your turn.");
  const held = actor.heldWeaponIds.includes(itemId);
  if (!held && actor.heldWeaponIds.length + (actor.hasEquippedShield ? 1 : 0) >= 2) return deny("Both hands are occupied. Stow a weapon first.");
  const usesAttackChange = !setup && Boolean(e.turn.attackEquipmentChangeAvailable);
  const usesAction = !setup && !usesAttackChange && Boolean(e.turn.objectInteractionUsed);
  if (usesAction && !e.turn.action) return deny("Your free interaction and Action have already been used.");
  const summary = `${actor.name} ${held ? "stows" : "draws"} ${item.name}${setup ? " before initiative" : usesAttackChange ? " using the Attack action's equipment change" : usesAction ? " using the Utilize Action" : " using the free object interaction"}.`;
  return { legal: true as const, summary, encounter: { ...e,
    combatants: e.combatants.map(c => c.id === id ? { ...c, heldWeaponIds: held ? actor.heldWeaponIds!.filter(weapon => weapon !== itemId) : [...actor.heldWeaponIds!, itemId] } : c),
    turn: setup ? e.turn : { ...e.turn, attackEquipmentChangeAvailable: usesAttackChange ? false : e.turn.attackEquipmentChangeAvailable, objectInteractionUsed: usesAttackChange ? e.turn.objectInteractionUsed : true, action: usesAction ? false : e.turn.action }, log: [summary, ...e.log] } };
}
