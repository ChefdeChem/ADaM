import type { EncounterState } from "../domain/combat";

export type ResolutionReceiptKind = "attack" | "movement" | "breath-weapon" | "lay-on-hands" | "defense";

export interface ResolutionReceipt {
  kind: ResolutionReceiptKind;
  eyebrow: string;
  title: string;
  summary: string;
  changes: string[];
}

const receiptCopy: Record<ResolutionReceiptKind, { eyebrow: string; title: string }> = {
  attack: { eyebrow: "Attack result", title: "The attack is resolved" },
  movement: { eyebrow: "Movement result", title: "Surina changed position" },
  "breath-weapon": { eyebrow: "Breath Weapon result", title: "The breath resolves across its area" },
  "lay-on-hands": { eyebrow: "Lay on Hands result", title: "Healing and cleansing are applied" },
  defense: { eyebrow: "Defense result", title: "The required response is resolved" },
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function buildResolutionReceipt(input: {
  kind: ResolutionReceiptKind;
  before: EncounterState;
  after: EncounterState;
  actorId: string;
  summary: string;
  concealEnemyHitPoints?: boolean;
}): ResolutionReceipt {
  const copy = receiptCopy[input.kind];
  const changes: string[] = [];
  const beforeActor = input.before.combatants.find((combatant) => combatant.id === input.actorId);
  const afterActor = input.after.combatants.find((combatant) => combatant.id === input.actorId);

  for (const afterCombatant of input.after.combatants) {
    const beforeCombatant = input.before.combatants.find((combatant) => combatant.id === afterCombatant.id);
    if (!beforeCombatant) continue;
    const hitPointChange = afterCombatant.hitPoints.current - beforeCombatant.hitPoints.current;
    if (hitPointChange) changes.push(input.concealEnemyHitPoints && afterCombatant.side === "enemy"
      ? `${afterCombatant.name} ${hitPointChange < 0 ? "took damage" : "regained hit points"}`
      : `${afterCombatant.name} HP ${signed(hitPointChange)} · ${afterCombatant.hitPoints.current}/${afterCombatant.hitPoints.maximum}`);
    const gainedConditions = afterCombatant.conditions.filter((condition) => !beforeCombatant.conditions.includes(condition));
    const removedConditions = beforeCombatant.conditions.filter((condition) => !afterCombatant.conditions.includes(condition));
    for (const condition of gainedConditions) changes.push(`${afterCombatant.name} gained ${condition}`);
    for (const condition of removedConditions) changes.push(`${afterCombatant.name} removed ${condition}`);
  }

  if (beforeActor && afterActor) {
    const moved = beforeActor.position.x !== afterActor.position.x || beforeActor.position.y !== afterActor.position.y;
    const movementSpent = input.before.turn.movementRemaining - input.after.turn.movementRemaining;
    if (moved) changes.push(`Position ${String.fromCharCode(65 + beforeActor.position.x)}${beforeActor.position.y + 1} → ${String.fromCharCode(65 + afterActor.position.x)}${afterActor.position.y + 1} · ${Math.max(0, movementSpent)} ft. spent`);

    for (const afterResource of afterActor.resources) {
      const beforeResource = beforeActor.resources.find((resource) => resource.id === afterResource.id);
      if (beforeResource && beforeResource.current !== afterResource.current) {
        changes.push(`${afterResource.name} ${beforeResource.current} → ${afterResource.current}`);
      }
    }

    if (beforeActor.reactionAvailable !== afterActor.reactionAvailable) {
      changes.push(`Reaction ${afterActor.reactionAvailable ? "restored" : "used"}`);
    }
  }

  if (input.after.pendingResponse && !input.before.pendingResponse) changes.push("Player response required before play continues");
  if (!input.after.turn.action && input.before.turn.action) changes.push("Action used");
  if (!changes.length) changes.push(input.after.pendingResponse ? "Continue with the highlighted response" : "No hit points, conditions, position, or tracked resources changed");

  return { kind: input.kind, eyebrow: copy.eyebrow, title: copy.title, summary: input.summary, changes };
}
