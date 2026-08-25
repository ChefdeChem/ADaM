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
    revision: "core-actions-2026.08",
    reviewedOn: "2026-08-25",
    scope: "Core action economy and current ADaM sample actions",
  },
  "dnd-2014": {
    rulesetId: "dnd-2014",
    revision: "legacy-actions-2026.08",
    reviewedOn: "2026-08-25",
    scope: "Legacy core action economy and compatible ADaM sample actions",
  },
};
