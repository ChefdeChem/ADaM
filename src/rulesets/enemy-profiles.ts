import type { CharacterAttack } from "../domain/character";
import type { EnemySaveAbility } from "../domain/combat";

export type EnemyProfile = {
  id: string;
  name: string;
  armorClass: number;
  speedFeet: number;
  hitPoints: number;
  initiativeModifier: number;
  tacticId: "ranged-skirmisher" | "melee-brute" | "mobile-harrier";
  attacks: CharacterAttack[];
  abilities: EnemySaveAbility[];
};

export const enemyProfiles: EnemyProfile[] = [
  {
    id: "ashen-scout",
    name: "Ashen Scout",
    armorClass: 13,
    speedFeet: 30,
    hitPoints: 18,
    initiativeModifier: 3,
    tacticId: "ranged-skirmisher",
    attacks: [
      { id: "ashen-shortbow", name: "Shortbow", kind: "ranged", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 80, longRangeFeet: 320, description: "The scout favors clear firing lanes and cover." },
      { id: "ashen-scimitar", name: "Scimitar", kind: "melee", attackBonus: 4, damage: "1d6 + 2 slashing", normalRangeFeet: 5, description: "A close-range fallback attack." },
    ],
    abilities: [
      { id: "ashen-cinder-flask", name: "Cinder Flask", kind: "saving-throw", saveAbility: "dexterity", saveDc: 12, damage: "2d6 fire", damageOnSuccess: "half", rangeFeet: 60, requiresLineOfSight: true, uses: 1, description: "A bursting flask forces a Dexterity saving throw; success halves the fire damage." },
    ],
  },
  {
    id: "ruined-guardian",
    name: "Ruined Guardian",
    armorClass: 15,
    speedFeet: 30,
    hitPoints: 30,
    initiativeModifier: 0,
    tacticId: "melee-brute",
    attacks: [
      { id: "guardian-maul", name: "Stone Maul", kind: "melee", attackBonus: 5, damage: "1d8 + 3 bludgeoning", normalRangeFeet: 5, description: "The guardian closes directly and strikes the nearest foe." },
    ],
    abilities: [],
  },
  {
    id: "cinder-skirmisher",
    name: "Cinder Skirmisher",
    armorClass: 14,
    speedFeet: 30,
    hitPoints: 22,
    initiativeModifier: 2,
    tacticId: "mobile-harrier",
    attacks: [
      { id: "cinder-javelin", name: "Javelin", kind: "ranged", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 30, longRangeFeet: 120, description: "The skirmisher throws from range before closing." },
      { id: "cinder-spear", name: "Spear", kind: "melee", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 5, description: "A close-range fallback attack." },
    ],
    abilities: [
      { id: "cinder-shockwave", name: "Cinder Shockwave", kind: "saving-throw", saveAbility: "constitution", saveDc: 13, damage: "2d8 thunder", damageOnSuccess: "half", rangeFeet: 30, requiresLineOfSight: true, uses: 1, description: "A concussive burst forces a Constitution saving throw; success halves the thunder damage." },
    ],
  },
];

export function enemyProfile(profileId: string): EnemyProfile {
  const profile = enemyProfiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown enemy profile: ${profileId}`);
  return profile;
}
