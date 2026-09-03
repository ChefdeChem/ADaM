import type { RulesetId } from "../rulesets/types";

export type RuleSourceId = "srd-5.1" | "srd-5.2.1" | "official-errata" | "open5e-v2" | "user-imported" | "adam-original";
export type RuleEntityKind = "attack" | "spell" | "feature" | "equipment" | "resource";
export type MechanicSupportStatus = "supported" | "partial" | "reference-only" | "needs-review";

export type RuleSource = {
  id: RuleSourceId;
  name: string;
  version: string;
  authority: "official" | "community-index" | "user" | "adam";
  rulesetIds: RulesetId[];
  license: "CC-BY-4.0" | "user-provided" | "internal";
  url?: string;
  attribution?: string;
  validationRequired: boolean;
};

export type MechanicComponent =
  | "attack-roll"
  | "damage-roll"
  | "healing-roll"
  | "saving-throw"
  | "targeting"
  | "range"
  | "resource-spend"
  | "resource-recovery"
  | "action-economy"
  | "movement"
  | "temporary-hit-points"
  | "trigger"
  | "replacement-effect"
  | "reaction"
  | "damage-reduction"
  | "dice-roll"
  | "duration"
  | "concentration"
  | "inventory"
  | "reference";

export type RuleRegistryEntry = {
  id: string;
  name: string;
  entityId: string;
  kind: RuleEntityKind;
  rulesetId: RulesetId;
  sourceId: RuleSourceId;
  sourceReference: string;
  evidenceSourceId: "user-imported" | "adam-original";
  evidenceReference: string;
  status: MechanicSupportStatus;
  executable: boolean;
  components: MechanicComponent[];
  missingCapabilities: string[];
};

export type MechanicCoverageCounts = Record<MechanicSupportStatus, number>;

export type CharacterMechanicCoverage = {
  characterId: string;
  rulesetId: RulesetId;
  sourceId: RuleSourceId;
  counts: MechanicCoverageCounts;
  total: number;
  executable: number;
  entries: RuleRegistryEntry[];
};
