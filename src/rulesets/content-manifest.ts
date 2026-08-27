import type { RulesetId } from "./types";

export type RulesContentRevision = {
  rulesetId: RulesetId;
  revision: string;
  reviewedOn: string;
  scope: string;
};

export const rulesContentManifest: Record<RulesetId, RulesContentRevision> = {
  "dnd-2024": {
    rulesetId: "dnd-2024",
    revision: "enemy-turns-2026.08",
    reviewedOn: "2026-08-27",
    scope: "Core action economy, weapon ranges, spell slots, temporary effects, and data-driven enemy profiles",
  },
  "dnd-2014": {
    rulesetId: "dnd-2014",
    revision: "legacy-enemy-turns-2026.08",
    reviewedOn: "2026-08-27",
    scope: "Legacy action economy, weapon ranges, spell slots, temporary effects, and data-driven enemy profiles",
  },
};
