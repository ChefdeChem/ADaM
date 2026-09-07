import type { Character, CharacterFeatureAction } from "../domain/character";
import type { RulesetId } from "./types";
import { createEncounter } from "../engine/encounter";
import type { Scenario } from "../scenarios/types";

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
  const featureActions = source.featureActions?.map((feature): CharacterFeatureAction => {
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
  return { assessment, notes, character: { ...source, featureActions } };
}

export function createPlayableEncounter(source: Character, scenario: Scenario) {
  const { character } = playableCharacter(source);
  const encounter = createEncounter(character, scenario);
  return { ...encounter, combatants: encounter.combatants.map((actor) => actor.side === "player" ? { ...actor, rulesetId: DEFAULT_COMBAT_RULESET } : actor) };
}
