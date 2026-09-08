import type { ActionCost } from "../domain/combat";

export type QuickActionTone = "ready" | "setup" | "blocked";

export interface QuickActionPresentation {
  tone: QuickActionTone;
  status: string;
  explanation: string;
}

export function actionCostLabel(cost: ActionCost): string {
  if (cost === "bonus-action") return "Bonus Action";
  if (cost === "reaction") return "Reaction";
  if (cost === "movement") return "Movement";
  if (cost === "free") return "No action cost";
  return "Action";
}

export function quickActionPresentation(input: {
  legal: boolean;
  reason?: string;
  workflowCanStart?: boolean;
  workflowExplanation?: string;
}): QuickActionPresentation {
  if (input.legal) {
    return { tone: "ready", status: "Available now", explanation: "This option can be used in the current turn state." };
  }
  if (input.workflowCanStart) {
    return {
      tone: "setup",
      status: "Start here",
      explanation: input.workflowExplanation ?? "Choose the option first, then complete its target or resource decisions.",
    };
  }
  return {
    tone: "blocked",
    status: "Unavailable",
    explanation: input.reason ?? "This option is not legal in the current turn state.",
  };
}
