import type { AbilityName, Character, CharacterEquipmentRule } from "../domain/character";
import type { CombatAction, EncounterState } from "../domain/combat";
import { abilityCheckRollMode } from "./effects";
import { rollD20, type D20Result } from "./dice";

const toolActionId = (rule: CharacterEquipmentRule) => `use-tool-${rule.id}`;

export function equipmentCombatActions(character: Character): CombatAction[] {
  return (character.equipmentRules ?? [])
    .filter((rule) => rule.equipped && rule.resolution.type === "tool-check")
    .map((rule) => ({
      id: toolActionId(rule),
      name: `Use ${rule.name}`,
      cost: rule.resolution.type === "tool-check" ? rule.resolution.actionCost : "action",
      description: rule.description,
      rulesets: [rule.provenance.rulesetId],
    }));
}

export function toolRuleForAction(character: Character, actionId: string): CharacterEquipmentRule | undefined {
  return (character.equipmentRules ?? []).find((rule) => rule.resolution.type === "tool-check" && toolActionId(rule) === actionId);
}

export type ToolCheckResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; summary: string; encounter: EncounterState; roll: D20Result; proficient: boolean };

export function executeToolCheck(
  encounter: EncounterState,
  rule: CharacterEquipmentRule,
  ability: AbilityName,
  random = Math.random,
): ToolCheckResolution {
  const active = encounter.combatants[encounter.activeIndex];
  if (!active || active.side !== "player") return { legal: false, reason: "Tool checks are available only on the player's turn.", encounter };
  if (active.hitPoints.current <= 0) return { legal: false, reason: "An unconscious character cannot use a tool.", encounter };
  if (!encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn.", encounter };
  if (rule.resolution.type !== "tool-check") return { legal: false, reason: `${rule.name} is not registered as a tool check.`, encounter };
  const item = active.inventory.find((candidate) => candidate.id === rule.id && candidate.current > 0 && candidate.tool);
  if (!item?.tool) return { legal: false, reason: `${rule.name} is not available in carried inventory.`, encounter };
  if (!rule.resolution.allowedAbilities.includes(ability)) return { legal: false, reason: `${ability} is not registered for this tool check.`, encounter };
  const proficient = item.tool.proficient;
  const modifier = active.abilityModifiers[ability] + (proficient ? active.proficiencyBonus : 0);
  const roll = rollD20({ mode: abilityCheckRollMode(encounter, active.id, ability), modifier, random });
  const summary = `${active.name} uses ${rule.name} to ${rule.resolution.purpose}: ${roll.rolls.join(" / ")} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${roll.total}${proficient ? " with tool proficiency" : " without tool proficiency"}.`;
  return {
    legal: true,
    roll,
    proficient,
    summary,
    encounter: { ...encounter, turn: { ...encounter.turn, action: false }, log: [summary, ...encounter.log] },
  };
}
