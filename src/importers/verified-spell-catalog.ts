import { BUILT_IN_CHARACTERS } from "../characters/built-ins";
import type { CharacterSpell } from "../domain/character";

const normalizedSpellName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const templates = BUILT_IN_CHARACTERS
  .flatMap((character) => character.spells ?? [])
  .filter((spell) => spell.provenance
    && ["srd-5.1", "srd-5.2.1", "official-errata"].includes(spell.provenance.sourceId)
    && !spell.unsupportedReason
    && !(spell.missingCapabilities?.length));

export function verifiedSpellTemplate(name: string): CharacterSpell | undefined {
  const matches = templates.filter((spell) => normalizedSpellName(spell.name) === normalizedSpellName(name));
  return matches.find((spell) => spell.provenance?.rulesetId === "dnd-2024") ?? matches[0];
}
