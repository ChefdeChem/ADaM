import type { Character } from "../domain/character";
import { createId } from "../shared/id";
import type { CharacterImporter, ImportResult } from "./types";
import { importKeyFor, sourceSnapshot } from "./source-identity";
import { validateImportedCharacter } from "./validation";

function requiredShape(parsed: Partial<Character>): string[] {
  const missing: string[] = [];
  if (!parsed.name) missing.push("name");
  if (!parsed.className) missing.push("className");
  if (parsed.level === undefined) missing.push("level");
  if (parsed.armorClass === undefined) missing.push("armorClass");
  if (!parsed.hitPoints) missing.push("hitPoints");
  if (parsed.proficiencyBonus === undefined) missing.push("proficiencyBonus");
  if (!parsed.abilities) missing.push("abilities");
  return missing;
}

export const jsonImporter: CharacterImporter = {
  supports: (file) => file.type === "application/json" || file.name.toLowerCase().endsWith(".json"),
  async import(file): Promise<ImportResult> {
    let parsed: Partial<Character>;
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The JSON root must be a character object.");
      parsed = value as Partial<Character>;
    } catch (error) {
      throw new Error(error instanceof SyntaxError ? "The JSON file is not valid JSON." : error instanceof Error ? error.message : "The JSON file could not be read.");
    }

    const missing = requiredShape(parsed);
    if (missing.length) throw new Error(`JSON is missing required ADaM character fields: ${missing.join(", ")}.`);
    const declaredSource = sourceSnapshot(parsed.source);
    const character: Character = {
      ...parsed,
      id: parsed.id ?? createId(),
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      attacks: Array.isArray(parsed.attacks) ? parsed.attacks : [],
      spells: Array.isArray(parsed.spells) ? parsed.spells : [],
      source: {
        format: "json",
        fileName: file.name,
        importedAt: new Date().toISOString(),
        importKey: parsed.source?.importKey ?? importKeyFor("json", file.name),
        declaredSource,
        editionAssessment: parsed.source?.editionAssessment,
      },
    } as Character;
    const validation = validateImportedCharacter(character);
    return {
      format: "json",
      character,
      validation,
      warnings: [],
      requiresReview: !validation.ready || validation.warnings.length > 0,
    };
  },
};
