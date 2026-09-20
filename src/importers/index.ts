import { jsonImporter } from "./json";
import { pdfImporter } from "./pdf";
import type { CharacterImporter, ImportResult } from "./types";

const importers: CharacterImporter[] = [jsonImporter, pdfImporter];

export async function importCharacterFile(file: File): Promise<ImportResult> {
  const importer = importers.find((candidate) => candidate.supports(file));
  if (!importer) throw new Error("Unsupported file. Choose a fillable PDF or ADaM JSON file.");
  return importer.import(file);
}

export { validateImportedCharacter } from "./validation";
export { importPlayabilityChecks } from "./playability";
export type { ImportPlayabilityCheck } from "./playability";
export type { ImportFormat, ImportIssue, ImportValidationReport, ImportResult } from "./types";
