import type { Character } from "../domain/character";
import {
  validateEquipmentInventory,
  validateEquipmentRuleLinks,
  validateFeatureDependencies,
  validateFeatureOwnershipLinks,
  validateWeaponEquipmentLinks,
} from "./validation";

export type ImportCrossReferenceCheck = {
  id: "inventory-records" | "equipment-rules" | "weapon-links" | "feature-ownership" | "feature-dependencies";
  label: string;
  status: "ready" | "review" | "blocked";
  detail: string;
};

function status(errors: number, warnings = 0): ImportCrossReferenceCheck["status"] {
  return errors ? "blocked" : warnings ? "review" : "ready";
}

export function importCrossReferenceChecks(character: Character): ImportCrossReferenceCheck[] {
  const inventoryIssues = validateEquipmentInventory(character);
  const equipmentIssues = validateEquipmentRuleLinks(character);
  const weaponIssues = validateWeaponEquipmentLinks(character);
  const ownershipIssues = validateFeatureOwnershipLinks(character);
  const dependencyIssues = validateFeatureDependencies(character);
  const inventoryCount = character.profile?.equipment?.length ?? 0;
  const ruleCount = character.equipmentRules?.length ?? 0;
  const governedAttacks = new Set((character.equipmentRules ?? []).flatMap((rule) =>
    rule.resolution.type === "weapon" || rule.resolution.type === "ammunition" ? rule.resolution.attackIds : [])).size;
  const sourceLinks = (character.profile?.features ?? []).reduce((total, feature) => total
    + Number(Boolean(feature.executableActionId))
    + Number(Boolean(feature.executablePassiveId))
    + Number(Boolean(feature.executableTriggerId))
    + (feature.executableAttackIds?.length ?? 0), 0);
  const dependencies = (character.featureActions?.length ?? 0)
    + (character.triggeredFeatures ?? []).filter((feature) => feature.resourceName).length
    + (character.passiveFeatures ?? []).filter((feature) => feature.resolution.type === "ability-check-reroll" || feature.resolution.type === "free-spell-cast").length;

  return [
    { id: "inventory-records", label: "Inventory records", status: status(inventoryIssues.filter((candidate) => candidate.severity === "error").length), detail: `${inventoryCount} imported item${inventoryCount === 1 ? "" : "s"} checked for unique names, quantities, and weights.` },
    { id: "equipment-rules", label: "Equipment rules", status: status(equipmentIssues.filter((candidate) => candidate.severity === "error").length), detail: `${ruleCount} executable equipment rule${ruleCount === 1 ? "" : "s"} checked against carried inventory.` },
    { id: "weapon-links", label: "Attack links", status: status(weaponIssues.filter((candidate) => candidate.severity === "error").length), detail: `${governedAttacks} governed attack${governedAttacks === 1 ? "" : "s"} checked for weapon and ammunition availability.` },
    { id: "feature-ownership", label: "Feature ownership", status: status(ownershipIssues.filter((candidate) => candidate.severity === "error").length, ownershipIssues.filter((candidate) => candidate.severity === "warning").length), detail: `${sourceLinks} source feature link${sourceLinks === 1 ? "" : "s"} checked against executable actions, passives, triggers, and attacks.` },
    { id: "feature-dependencies", label: "Feature resources", status: status(dependencyIssues.filter((candidate) => candidate.severity === "error").length), detail: `${dependencies} executable feature dependenc${dependencies === 1 ? "y" : "ies"} checked against imported resources and spells.` },
  ];
}
