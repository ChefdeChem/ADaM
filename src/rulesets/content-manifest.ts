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
    revision: "defensive-responses-2026.08",
    reviewedOn: "2026-08-27",
    scope: "Core action economy, enemy turns, saving throws, reactions, concentration checks, death saves, and data-driven profiles",
  },
  "dnd-2014": {
    rulesetId: "dnd-2014",
    revision: "legacy-defensive-responses-2026.08",
    reviewedOn: "2026-08-27",
    scope: "Legacy action economy, enemy turns, saving throws, reactions, concentration checks, death saves, and data-driven profiles",
  },
};
