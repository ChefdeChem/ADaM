import type { Character } from "../domain/character";
import { BUILT_IN_CHARACTERS } from "./built-ins";

export const CHARACTER_ROSTER_LIMIT = 5;
export const CHARACTER_ROSTER_SEED_VERSION = 5;

export type RosterUpdate = {
  characters: Character[];
  stored: boolean;
  replaced: boolean;
  reason?: string;
};

export function upsertRosterCharacter(characters: Character[], character: Character): RosterUpdate {
  const existingIndex = characters.findIndex((candidate) => candidate.id === character.id);
  if (existingIndex >= 0) {
    return {
      characters: characters.map((candidate, index) => index === existingIndex ? character : candidate),
      stored: true,
      replaced: true,
    };
  }
  if (characters.length >= CHARACTER_ROSTER_LIMIT) {
    return {
      characters,
      stored: false,
      replaced: false,
      reason: `The character roster is full. Remove one of the ${CHARACTER_ROSTER_LIMIT} stored characters before importing another.`,
    };
  }
  return { characters: [...characters, character], stored: true, replaced: false };
}

export function removeRosterCharacter(characters: Character[], characterId: string): Character[] {
  return characters.filter((character) => character.id !== characterId);
}

export function mergeBuiltInCharacters(characters: Character[]): Character[] {
  const merged = [...characters];
  for (const builtIn of BUILT_IN_CHARACTERS) {
    const existingIndex = merged.findIndex((character) => character.id === builtIn.id);
    if (existingIndex >= 0) merged[existingIndex] = builtIn;
    else if (merged.length < CHARACTER_ROSTER_LIMIT) merged.push(builtIn);
  }
  return merged.slice(0, CHARACTER_ROSTER_LIMIT);
}
