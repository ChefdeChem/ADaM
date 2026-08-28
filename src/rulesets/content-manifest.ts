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
    revision: "tactical-reactions-2026.08",
    reviewedOn: "2026-08-28",
    scope: "Core action economy, split movement, opportunity attacks, saving throws, reactions, concentration checks, death saves, and data-driven enemy turns",
  },
  "dnd-2014": {
    rulesetId: "dnd-2014",
    revision: "legacy-tactical-reactions-2026.08",
    reviewedOn: "2026-08-28",
    scope: "Legacy action economy, split movement, opportunity attacks, saving throws, reactions, concentration checks, death saves, and data-driven enemy turns",
  },
};
