import type { Character } from "../domain/character";
import type { CombatInventoryItem, EncounterState } from "../domain/combat";

const normalize = (value: string) => value.trim().toLowerCase();

export function combatInventoryForCharacter(character: Character): CombatInventoryItem[] {
  const equipment = character.profile?.equipment ?? [];
  return (character.equipmentRules ?? []).flatMap((rule) => {
    if (!rule.equipped || rule.resolution.type !== "weapon") return [];
    const carried = equipment.find((item) => normalize(item.name) === normalize(rule.name));
    const maximum = Math.max(0, Math.floor(carried?.quantity ?? 0));
    return [{
      id: rule.id,
      name: rule.name,
      current: maximum,
      maximum,
      attackIds: [...rule.resolution.attackIds],
      expendOnAttackIds: [...(rule.resolution.expendOnAttackIds ?? [])],
    }];
  });
}

export function availableCharacterAttacks(character: Character, inventory: CombatInventoryItem[]) {
  const governedAttackIds = new Set((character.equipmentRules ?? []).flatMap((rule) =>
    rule.resolution.type === "weapon" ? rule.resolution.attackIds : []));
  const availableAttackIds = new Set(inventory.flatMap((item) => item.current > 0 ? item.attackIds : []));
  return (character.attacks ?? [])
    .filter((attack) => !governedAttackIds.has(attack.id) || availableAttackIds.has(attack.id))
    .map((attack) => ({ ...attack }));
}

export function attackInventoryAvailable(encounter: EncounterState, combatantId: string, attackId: string): boolean {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const governingItems = combatant?.inventory?.filter((item) => item.attackIds.includes(attackId)) ?? [];
  return governingItems.length === 0 || governingItems.some((item) => item.current > 0);
}

export function consumeAttackInventory(encounter: EncounterState, combatantId: string, attackId: string): EncounterState {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  const consumed = combatant?.inventory?.filter((item) => item.current > 0 && item.expendOnAttackIds.includes(attackId)) ?? [];
  if (!combatant || consumed.length === 0) return encounter;

  const consumedIds = new Set(consumed.map((item) => item.id));
  const inventory = combatant.inventory.map((item) => consumedIds.has(item.id)
    ? { ...item, current: Math.max(0, item.current - 1) }
    : item);
  const governedAttackIds = new Set(inventory.flatMap((item) => item.attackIds));
  const availableAttackIds = new Set(inventory.flatMap((item) => item.current > 0 ? item.attackIds : []));
  const attacks = combatant.attacks.filter((attack) => !governedAttackIds.has(attack.id) || availableAttackIds.has(attack.id));
  const log = consumed.map((item) => {
    const remaining = inventory.find((candidate) => candidate.id === item.id)?.current ?? 0;
    return `${combatant.name} throws ${item.name}; ${remaining} carried ${remaining === 1 ? "copy remains" : "copies remain"}.`;
  });
  return {
    ...encounter,
    combatants: encounter.combatants.map((candidate) => candidate.id === combatantId
      ? { ...candidate, inventory, attacks }
      : candidate),
    log: [...log, ...encounter.log],
  };
}
