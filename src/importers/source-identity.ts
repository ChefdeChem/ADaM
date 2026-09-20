import type { CharacterSourceSnapshot } from "../domain/character";
import type { ImportFormat } from "./types";

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function importKeyFor(format: ImportFormat, fileName: string): string {
  return `import-${fnv1a(`${format}|${fileName.trim().toLowerCase()}`)}`;
}

export function sourceSnapshot(value: unknown): CharacterSourceSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<CharacterSourceSnapshot>;
  if (!source.format || !["json", "fillable-pdf", "flattened-pdf", "sample"].includes(source.format)) return undefined;
  if (typeof source.importedAt !== "string") return undefined;
  return {
    format: source.format,
    importedAt: source.importedAt,
    ...(typeof source.fileName === "string" ? { fileName: source.fileName } : {}),
    ...(source.editionAssessment ? { editionAssessment: source.editionAssessment } : {}),
  };
}
