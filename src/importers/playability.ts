import { abilityModifier, type AbilityName, type Character } from "../domain/character";
import { SKILL_ABILITIES } from "../rulesets/skills";

export type ImportPlayabilityCheck = {
  id: "initiative" | "movement" | "saving-throws" | "skill-checks" | "spell-slots";
  label: string;
  status: "ready" | "review";
  detail: string;
};

const abilities: AbilityName[] = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

export function importPlayabilityChecks(character: Character): ImportPlayabilityCheck[] {
  const initiative = Number.isFinite(character.profile?.initiativeModifier)
    ? character.profile!.initiativeModifier!
    : abilityModifier(character.abilities.dexterity);
  const explicitSaves = abilities.filter((ability) => Number.isFinite(character.savingThrowModifiers?.[ability])).length;
  const explicitSkills = Object.entries(character.profile?.skills ?? {}).filter(([, modifier]) => Number.isFinite(modifier)).length;
  const leveledSpells = (character.spells ?? []).filter((spell) => spell.level > 0);
  const castableSpells = leveledSpells.filter((spell) => {
    const slot = character.resources.some((resource) => resource.kind === "spell-slot" && resource.level === spell.level);
    const freeCast = Boolean(spell.freeCastResourceName && character.resources.some((resource) => resource.name.toLowerCase() === spell.freeCastResourceName!.toLowerCase()));
    return slot || freeCast;
  });

  return [
    {
      id: "initiative",
      label: "Initiative",
      status: "ready",
      detail: `${initiative >= 0 ? "+" : ""}${initiative} ${character.profile?.initiativeModifier === undefined ? "derived from Dexterity" : "from the imported profile"}.`,
    },
    {
      id: "movement",
      label: "Starting movement",
      status: "ready",
      detail: `${character.speedFeet ?? 30} feet available on the first turn and every later turn.`,
    },
    {
      id: "saving-throws",
      label: "Saving throws",
      status: "ready",
      detail: `${explicitSaves} imported modifier${explicitSaves === 1 ? "" : "s"}; ${abilities.length - explicitSaves} safely derived from ability scores.`,
    },
    {
      id: "skill-checks",
      label: "Skill checks",
      status: "ready",
      detail: `${explicitSkills} imported modifier${explicitSkills === 1 ? "" : "s"}; unlisted skills use their linked ability modifier across all ${Object.keys(SKILL_ABILITIES).length} registered skills.`,
    },
    {
      id: "spell-slots",
      label: "Spell resources",
      status: castableSpells.length === leveledSpells.length ? "ready" : "review",
      detail: leveledSpells.length === 0
        ? "No leveled spells require a casting pool."
        : `${castableSpells.length}/${leveledSpells.length} leveled spell${leveledSpells.length === 1 ? "" : "s"} linked to an imported slot or free-cast pool.`,
    },
  ];
}
