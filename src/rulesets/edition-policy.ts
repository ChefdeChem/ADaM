import type { Character, CharacterFeatureAction } from "../domain/character";
import type { RulesetId } from "./types";
import { createEncounter } from "../engine/encounter";
import type { Scenario } from "../scenarios/types";
import type { EncounterState } from "../domain/combat";

export const DEFAULT_COMBAT_RULESET: RulesetId = "dnd-2024";
export type EditionAssessment = {
  edition: RulesetId | "uncertain" | "mixed";
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

/** Examine build evidence, not a weapon property or the generic label '5e'. */
export function detectCharacterEdition(character: Character): EditionAssessment {
  const clues: Array<{ edition: RulesetId; reason: string }> = [];
  if (character.rulesetId) clues.push({ edition: character.rulesetId, reason: `Declared character edition: ${character.rulesetId === "dnd-2014" ? "2014" : "2024"}.` });
  const features = character.featureActions ?? [];
  const descriptions = [...features, ...(character.profile?.features ?? [])];
  for (const feature of descriptions) {
    if (/^divine sense$/i.test(feature.name) && /paladin/i.test(character.className) && character.level === 1) {
      clues.push({ edition: "dnd-2014", reason: "A level-one Paladin has Divine Sense." });
    }
    if (/^lay on hands$/i.test(feature.name)) {
      if (/as an action|cure.*disease|neutralize.*poison/i.test(feature.description)) clues.push({ edition: "dnd-2014", reason: "Lay on Hands has legacy Action or disease-removal wording." });
      if (/bonus action/i.test(feature.description)) clues.push({ edition: "dnd-2024", reason: "Lay on Hands specifies a Bonus Action." });
    }
  }
  const evidence = [...new Set(clues.map((clue) => clue.reason))];
  const editions = new Set(clues.map((clue) => clue.edition));
  return {
    edition: editions.size > 1 ? "mixed" : clues[0]?.edition ?? "uncertain",
    confidence: editions.size !== 1 ? "low" : character.rulesetId || evidence.length > 1 ? "high" : "medium",
    evidence,
  };
}

export function editionLabel(edition: EditionAssessment["edition"]): string {
  return edition === "dnd-2014" ? "2014" : edition === "dnd-2024" ? "2024" : edition === "mixed" ? "Mixed evidence" : "Not determined";
}

const sourceReference = "Official SRD 5.2.1, Paladin, pp. 54-55";
/** Resolution overrides are ephemeral. Feature grants and resource pools stay with the source build. */
export function playableCharacter(source: Character): { character: Character; assessment: EditionAssessment; notes: string[] } {
  const assessment = detectCharacterEdition(source);
  const notes: string[] = [];
  if (assessment.edition !== "dnd-2024") notes.push("Character features and resources follow the imported build. Combat defaults to 2024; edition differences can affect play. No character conversion is performed.");
  if (assessment.edition === "uncertain" || assessment.edition === "mixed") notes.push("The source edition cannot be established confidently. Existing features are retained; missing features and player choices are not invented.");
  const unownedMasteryLabels = (source.attacks ?? []).filter((attack) => attack.masteryOwnership === "not-granted" && /\b(graze|nick|push|sap|slow|topple|vex)\b/i.test(attack.description ?? ""));
  if (unownedMasteryLabels.length) notes.push(`Weapon Mastery: ${unownedMasteryLabels.map((attack) => attack.name).join(", ")} ${unownedMasteryLabels.length === 1 ? "shows" : "show"} a printed mastery property, but the verified character build does not grant mastery for ${unownedMasteryLabels.length === 1 ? "that weapon" : "those weapons"}. No mastery rider is applied.`);
  const featureActions = source.featureActions?.map((feature): CharacterFeatureAction => {
    if (source.id === "surina-daardendrian" && source.level === 1 && feature.id === "breath-weapon-gold" && feature.resolution.type === "area-saving-throw") {
      notes.push("Breath Weapon: the source build retains its one-use Short Rest pool. Current resolution uses 1d10 fire damage and a choice of 15-foot Cone or 30-foot Line. At level one it replaces your sole attack, using your Action. No Extra Attack or additional resource uses are granted.");
      return { ...feature, description: "Choose a 15-foot Cone or 30-foot Line, then roll 1d10 fire damage. Dexterity DC 11, half on success. Replaces your one attack this turn.", resolution: { ...feature.resolution, damage: "1d10 fire" }, provenance: { rulesetId: "dnd-2024", sourceId: "srd-5.2.1", sourceReference: "SRD 5.2.1, Dragonborn, p. 84" } };
    }
    if (feature.provenance.rulesetId !== "dnd-2014") return feature;
    if (/^lay on hands$/i.test(feature.name) && feature.resolution.type === "healing-pool") {
      notes.push("Lay on Hands: 2014 uses an Action, excludes Undead and Constructs, and removes individual diseases or poisons. Applied 2024 resolution uses a Bonus Action, permits those creature types, and spends 5 pool points to remove Poisoned instead. Your healing pool is unchanged.");
      return { ...feature, cost: "bonus-action", description: "2024 resolution: touch healing or spend 5 pool points to remove Poisoned. Source healing pool retained.", resolution: { type: "healing-pool", rangeFeet: 5, removesPoisoned: true }, provenance: { rulesetId: "dnd-2024", sourceId: "srd-5.2.1", sourceReference } };
    }
    if (/^divine sense$/i.test(feature.name) && feature.resolution.type === "sense-creature-types") {
      notes.push("Divine Sense: your 2014 build retains this feature and its original uses. Applied 2024 resolution changes Action to Bonus Action, next-turn expiry to 10 minutes, removes the total-cover restriction, and ends the sense when Incapacitated. This compatibility policy does not grant Channel Divinity or change your level.");
      return { ...feature, cost: "bonus-action", description: "Sense Celestials, Fiends, Undead, and divine auras within 60 feet for 10 minutes, ending when Incapacitated. Source uses retained.", resolution: { ...feature.resolution, duration: "ten-minutes", blockedByTotalCover: false }, provenance: { rulesetId: "dnd-2024", sourceId: "srd-5.2.1", sourceReference } };
    }
    return feature;
  });
  // Add a mode of an existing verified weapon, never a feature or mastery grant.
  const longsword = source.attacks?.find((attack) => attack.id === "longsword" && attack.kind === "melee" && /^1d8\b/.test(attack.damage));
  const swordRule = source.equipmentRules?.find((rule) => rule.id === "longsword" && rule.resolution.type === "weapon" && rule.resolution.attackIds.includes("longsword"));
  const addVersatile = Boolean(longsword && swordRule && !source.attacks?.some((attack) => attack.id === "longsword-two-handed"));
  const sourceAttacks = source.attacks?.map(attack => source.id === "surina-daardendrian" && attack.id === "glaive" ? {
    ...attack,
    requiresTwoHands: true,
    description: "Martial Heavy Reach Two-Handed weapon. The imported mastery label is not an owned character feature, so no mastery rider applies.",
  } : attack);
  const attacks = addVersatile ? [...(sourceAttacks ?? []), {
    ...longsword!, id: "longsword-two-handed", name: "Longsword (two hands)",
    damage: longsword!.damage.replace(/^1d8\b/, "1d10"), requiresTwoHands: true,
    description: "Versatile: use 1d10 weapon damage with two hands. This does not grant Weapon Mastery. SRD 5.2.1, pp. 89-91.",
  }] : sourceAttacks;
  const equipmentRules = addVersatile ? source.equipmentRules?.map((rule) => rule === swordRule && rule.resolution.type === "weapon"
    ? { ...rule, resolution: { ...rule.resolution, attackIds: [...rule.resolution.attackIds, "longsword-two-handed"] } } : rule) : source.equipmentRules;
  if (source.id === "surina-daardendrian") notes.push("Surina's bounded trainer loop is ready for player testing. It includes explicit Breath Weapon aiming, live Divine Sense, touch-targeted Lay on Hands, visible Fire Resistance, all three Unarmed Strike options, held weapons, movement, reactions, conditions, combat recovery, and a second encounter. Narrative outcomes, custom Ready triggers, undefined objects, and unmodeled lighting still require adjudication.");
  notes.push("Approved trainer Hide ruling: entering an enemy's unobstructed view ends hiding automatically. Concealed detection uses Perception. Magical invisibility is separate. Current maps assume visible lighting and do not simulate special senses.");
  if (source.id === "surina-daardendrian") notes.push("Choose held weapons before initiative. Drawing or stowing on your turn shares the free object interaction with doors; further interactions use an Action. An Attack can draw one weapon if your hands allow it. Opportunity attacks require an already-held weapon. Glaive and two-handed Longsword attacks require both hands.");
  return { assessment, notes, character: { ...source, actions: source.id === "surina-daardendrian" ? ["Attack", "Dash", "Disengage", "Dodge", "Help", "Hide", "Ready", "Search", "Study", "Influence", "Utilize"] : source.actions, featureActions, attacks, equipmentRules } };
}

export function createPlayableEncounter(source: Character, scenario: Scenario): EncounterState {
  const { character } = playableCharacter(source);
  const encounter = createEncounter(character, scenario);
  for (const actor of encounter.combatants) {
    if (actor.id === "surina-daardendrian") actor.heldWeaponIds = [];
  }
  return { ...encounter, recoveryState: source.recoveryState ? { ...source.recoveryState } : undefined, combatants: encounter.combatants.map((actor) => actor.side === "player" ? { ...actor, rulesetId: DEFAULT_COMBAT_RULESET, skillProficiencies: source.id === "surina-daardendrian" ? [...new Set([...actor.skillProficiencies, ...["athletics", "history", "persuasion", "religion"].filter(skill => actor.skillModifiers[skill] === actor.abilityModifiers[skill === "athletics" ? "strength" : skill === "persuasion" ? "charisma" : "intelligence"] + actor.proficiencyBonus)])] : actor.skillProficiencies } : actor) };
}
