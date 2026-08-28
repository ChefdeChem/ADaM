import type { Character } from "../domain/character";

export const CHARACTER_ROSTER_LIMIT = 5;

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
