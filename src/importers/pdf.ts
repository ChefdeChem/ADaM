import { PDFDocument, PDFField, PDFTextField } from "pdf-lib";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { Character } from "../domain/character";
import { parseDndBeyondTokens } from "./dnd-beyond";
import type { CharacterImporter, ImportResult } from "./types";

const aliases: Record<string, string[]> = {
  name: ["CharacterName", "Character Name"],
  classLevel: ["CLASS LEVEL", "ClassLevel"],
  armorClass: ["AC", "Armor Class"],
  hp: ["CURRENT HIT POINTS", "CurrentHitPoints", "HP"],
  hpMax: ["MAX HIT POINTS", "MaxHitPoints", "HP Max"],
  proficiency: ["PROFICIENCY BONUS", "ProfBonus"],
  strength: ["STR", "Strength"],
  dexterity: ["DEX", "Dexterity"],
  constitution: ["CON", "Constitution"],
  intelligence: ["INT", "Intelligence"],
  wisdom: ["WIS", "Wisdom"],
  charisma: ["CHA", "Charisma"],
};

const numberValue = (value: string | undefined, fallback: number) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const value = (fields: Map<string, string>, names: string[]) => names
  .map((name) => fields.get(name.toLowerCase()))
  .find(Boolean);

const fieldValue = (field: PDFField) => field instanceof PDFTextField ? field.getText() ?? "" : "";

function glyphText(args: unknown): string {
  const output: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "string") output.push(value);
    else if (value && typeof value === "object" && "unicode" in value && typeof value.unicode === "string") output.push(value.unicode);
  };
  visit(args);
  return output.join("").replace(/\s+/g, " ").trim();
}

async function extractOperatorTokens(bytes: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;
  const page = await document.getPage(1);
  const operators = await page.getOperatorList();
  const textOperators = new Set([
    pdfjs.OPS.showText,
    pdfjs.OPS.showSpacedText,
    pdfjs.OPS.nextLineShowText,
    pdfjs.OPS.nextLineSetSpacingShowText,
  ]);
  const tokens: string[] = [];
  operators.fnArray.forEach((operator, index) => {
    if (!textOperators.has(operator)) return;
    const token = glyphText(operators.argsArray[index]);
    if (token) tokens.push(token);
  });
  await loadingTask.destroy();
  return tokens;
}

function manualReviewCharacter(file: File): Character {
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.pdf$/i, ""),
    className: "Adventurer",
    level: 1,
    armorClass: 10,
    speedFeet: 30,
    hitPoints: { current: 1, maximum: 1 },
    proficiencyBonus: 2,
    abilities: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    resources: [],
    attacks: [],
    spells: [],
    source: { format: "flattened-pdf", fileName: file.name, importedAt: new Date().toISOString() },
  };
}

async function importFlattenedPdf(file: File, bytes: ArrayBuffer): Promise<ImportResult> {
  try {
    const tokens = await extractOperatorTokens(bytes);
    const parsed = parseDndBeyondTokens(tokens);
    if (parsed) {
      const character: Character = {
        id: crypto.randomUUID(),
        ...parsed,
        resources: [],
        spells: [],
        source: { format: "flattened-pdf", fileName: file.name, importedAt: new Date().toISOString() },
      };
      return {
        character,
        format: "flattened-pdf",
        requiresReview: true,
        warnings: [`Flattened D&D Beyond sheet detected. ${parsed.attacks.length} weapon attacks and saving throw modifiers extracted; review the values before combat.`],
      };
    }
  } catch {
    // The editable review below is the safe fallback for image-only or unfamiliar PDFs.
  }

  return {
    character: manualReviewCharacter(file),
    format: "flattened-pdf",
    requiresReview: true,
    warnings: ["This flattened PDF uses an unfamiliar layout. Enter or correct the highlighted values before combat."],
  };
}

export const pdfImporter: CharacterImporter = {
  supports: (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
  async import(file): Promise<ImportResult> {
    const bytes = await file.arrayBuffer();
    const document = await PDFDocument.load(bytes);
    const formFields = document.getForm().getFields();
    if (!formFields.length) return importFlattenedPdf(file, bytes);

    const fields = new Map(formFields.map((field) => [field.getName().toLowerCase(), fieldValue(field)]));
    const classLevel = value(fields, aliases.classLevel) ?? "Adventurer 1";
    const match = classLevel.match(/^(.*?)[\s,]+(\d+)$/);
    const hp = numberValue(value(fields, aliases.hp), 1);
    const character: Character = {
      id: crypto.randomUUID(),
      name: value(fields, aliases.name) ?? file.name.replace(/\.pdf$/i, ""),
      className: match?.[1]?.trim() || classLevel,
      level: numberValue(match?.[2], 1),
      armorClass: numberValue(value(fields, aliases.armorClass), 10),
      hitPoints: { current: hp, maximum: numberValue(value(fields, aliases.hpMax), hp) },
      proficiencyBonus: numberValue(value(fields, aliases.proficiency), 2),
      abilities: {
        strength: numberValue(value(fields, aliases.strength), 10),
        dexterity: numberValue(value(fields, aliases.dexterity), 10),
        constitution: numberValue(value(fields, aliases.constitution), 10),
        intelligence: numberValue(value(fields, aliases.intelligence), 10),
        wisdom: numberValue(value(fields, aliases.wisdom), 10),
        charisma: numberValue(value(fields, aliases.charisma), 10),
      },
      resources: [],
      source: { format: "fillable-pdf", fileName: file.name, importedAt: new Date().toISOString() },
    };
    return { character, format: "fillable-pdf", warnings: ["Standard form fields mapped; review custom sheet values."] };
  },
};
