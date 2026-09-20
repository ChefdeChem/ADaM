import type { Character } from "../domain/character";

export type ImportFormat = "json" | "fillable-pdf" | "flattened-pdf";
export type ImportIssueSection = "core" | "attacks" | "resources" | "spells" | "equipment" | "features" | "source";
export type ImportIssue = {
  severity: "error" | "warning";
  section: ImportIssueSection;
  code: string;
  message: string;
};
export type ImportValidationReport = {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  ready: boolean;
};
export type ImportResult = {
  character: Character;
  format: ImportFormat;
  warnings: string[];
  validation: ImportValidationReport;
  requiresReview?: boolean;
};
export interface CharacterImporter {
  supports(file: File): boolean;
  import(file: File): Promise<ImportResult>;
}
