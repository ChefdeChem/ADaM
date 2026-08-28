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
    revision: "pathfinding-tactics-2026.08",
    reviewedOn: "2026-08-28",
    scope: "Core action economy, one-tap movement pathfinding, opportunity attacks, mode-scaled enemy tactics, saving throws, reactions, concentration checks, and death saves",
  },
  "dnd-2014": {
    rulesetId: "dnd-2014",
    revision: "legacy-pathfinding-tactics-2026.08",
    reviewedOn: "2026-08-28",
    scope: "Legacy action economy, one-tap movement pathfinding, opportunity attacks, mode-scaled enemy tactics, saving throws, reactions, concentration checks, and death saves",
  },
};
