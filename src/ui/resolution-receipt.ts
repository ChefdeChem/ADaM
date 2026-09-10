import type { EncounterState } from "../domain/combat";

export type ResolutionReceiptKind =
  | "attack"
  | "movement"
  | "breath-weapon"
  | "lay-on-hands"
  | "defense"
  | "initiative"
  | "enemy-turn"
  | "end-turn"
  | "recovery"
  | "new-encounter"
  | "equipment"
  | "object"
  | "stand-up"
  | "grapple-escape"
  | "death-save"
  | "grapple"
  | "shove"
  | "help"
  | "ready"
  | "hide";

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
  initiative: { eyebrow: "Initiative result", title: "Turn order is ready" },
  "enemy-turn": { eyebrow: "Enemy turn result", title: "ADaM finished the enemy action" },
  "end-turn": { eyebrow: "Turn result", title: "Surina's turn is complete" },
  recovery: { eyebrow: "Recovery result", title: "Rest changes are applied" },
  "new-encounter": { eyebrow: "Encounter ready", title: "A fresh training encounter is prepared" },
  equipment: { eyebrow: "Equipment result", title: "Surina changed what she is holding" },
  object: { eyebrow: "Object result", title: "The nearby object is updated" },
  "stand-up": { eyebrow: "Movement result", title: "Surina stood up" },
  "grapple-escape": { eyebrow: "Grapple result", title: "The escape attempt is resolved" },
  "death-save": { eyebrow: "Death save result", title: "Surina's survival track is updated" },
  grapple: { eyebrow: "Grapple result", title: "The Grapple attempt is resolved" },
  shove: { eyebrow: "Shove result", title: "The Shove attempt is resolved" },
  help: { eyebrow: "Help result", title: "Surina's assistance is prepared" },
  ready: { eyebrow: "Ready result", title: "The prepared attack is tracked" },
  hide: { eyebrow: "Hide result", title: "Surina's Stealth attempt is resolved" },
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

  if (input.kind === "initiative") {
    changes.push(`Turn order: ${input.after.combatants.map((combatant) => `${combatant.name} ${combatant.initiative}`).join(" · ")}`);
    changes.push(`${input.after.combatants[input.after.activeIndex]?.name ?? "The first combatant"} acts first`);
  }

  if (input.kind === "new-encounter") {
    changes.push(`${input.after.combatants.length - 1} hostile ${input.after.combatants.length - 1 === 1 ? "creature" : "creatures"} ready`);
    changes.push("Choose held weapons before initiative");
    changes.push("Roll initiative to begin");
  }

  if (input.kind === "end-turn") {
    changes.push(`Next turn: ${input.after.combatants[input.after.activeIndex]?.name ?? "unknown"}`);
    changes.push(`Round ${input.after.round}`);
  }

  if (input.kind === "object") {
    for (const afterCell of input.after.map.terrain.filter((cell) => cell.door)) {
      const beforeCell = input.before.map.terrain.find((cell) => cell.x === afterCell.x && cell.y === afterCell.y);
      if (beforeCell?.kind !== afterCell.kind) changes.push(`${afterCell.label}: ${afterCell.kind === "wall" ? "closed" : "open"}`);
    }
  }

  const addedEffects = input.after.effects.filter((effect) => !input.before.effects.some((beforeEffect) => beforeEffect.id === effect.id));
  if (input.kind === "help") {
    for (const effect of addedEffects) {
      const target = input.after.combatants.find((combatant) => combatant.id === effect.targetCombatantId);
      if (effect.helpAttack) changes.push(`Next ally attack against ${target?.name ?? "the target"}: Advantage`);
      if (effect.helpCheck) changes.push(`${target?.name ?? "Ally"}'s next ${effect.helpCheck} check: Advantage`);
    }
  }
  if (input.kind === "ready") {
    const prepared = addedEffects.find((effect) => effect.readiedAttack)?.readiedAttack;
    if (prepared) {
      const attack = afterActor?.attacks.find((candidate) => candidate.id === prepared.attackId);
      const target = input.after.combatants.find((combatant) => combatant.id === prepared.targetId);
      changes.push(`Prepared: ${attack?.name ?? "weapon attack"} against ${target?.name ?? "the target"}`);
      changes.push(`Trigger: ${prepared.trigger === "becomes-attackable" ? "target first becomes attackable" : "target finishes moving"}`);
      changes.push("Reaction remains ready");
    } else if (input.before.pendingResponse?.type === "readied-attack") {
      if (input.after.pendingResponse?.type === "readied-attack" && input.after.pendingResponse.phase === "attack-roll") changes.push("Trigger accepted · roll the attack next");
      else if (input.after.pendingResponse?.type === "readied-attack" && input.after.pendingResponse.phase === "damage-roll") changes.push("Attack hit · roll damage next");
      else if (input.before.pendingResponse.phase === "choice" && beforeActor?.reactionAvailable === afterActor?.reactionAvailable) changes.push("Trigger ignored · Reaction preserved");
      else changes.push("Readied attack resolved");
    }
  }
  if (input.kind === "hide") {
    const hidden = addedEffects.find((effect) => effect.hidden)?.hidden;
    changes.push(hidden ? `Hidden · Perception DC ${hidden.dc}` : "Hide failed · Surina remains detectable");
  }

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
    if (input.kind === "help" && !beforeCombatant.stabilized && afterCombatant.stabilized) changes.push(`${afterCombatant.name} stabilized at 0 HP`);
    if (input.kind === "shove" && (beforeCombatant.position.x !== afterCombatant.position.x || beforeCombatant.position.y !== afterCombatant.position.y) && afterCombatant.id !== input.actorId) {
      changes.push(`${afterCombatant.name} moved ${String.fromCharCode(65 + beforeCombatant.position.x)}${beforeCombatant.position.y + 1} → ${String.fromCharCode(65 + afterCombatant.position.x)}${afterCombatant.position.y + 1}`);
    }
  }

  if (beforeActor && afterActor) {
    const moved = beforeActor.position.x !== afterActor.position.x || beforeActor.position.y !== afterActor.position.y;
    const movementSpent = input.before.turn.movementRemaining - input.after.turn.movementRemaining;
    if (moved) changes.push(`Position ${String.fromCharCode(65 + beforeActor.position.x)}${beforeActor.position.y + 1} → ${String.fromCharCode(65 + afterActor.position.x)}${afterActor.position.y + 1} · ${Math.max(0, movementSpent)} ft. spent`);
    if (input.kind === "stand-up" && movementSpent > 0) changes.push(`Movement ${movementSpent} ft. spent · ${input.after.turn.movementRemaining} ft. remains`);

    if (input.kind === "equipment") {
      const heldNames = afterActor.inventory.filter((item) => afterActor.heldWeaponIds?.includes(item.id)).map((item) => item.name);
      changes.push(`In hand: ${heldNames.join(", ") || "nothing"}`);
      if (input.before.turn.objectInteractionUsed !== input.after.turn.objectInteractionUsed) changes.push("Free object interaction used");
    }

    if (input.kind === "death-save") {
      changes.push(`Death saves: ${afterActor.deathSaves.successes} successes · ${afterActor.deathSaves.failures} failures`);
      if (!beforeActor.stabilized && afterActor.stabilized) changes.push("Stable at 0 HP");
      if (afterActor.deathSaves.failures >= 3) changes.push("Three failures · defeated");
    }

    for (const afterResource of afterActor.resources) {
      const beforeResource = beforeActor.resources.find((resource) => resource.id === afterResource.id);
      if (beforeResource && beforeResource.current !== afterResource.current) {
        changes.push(`${afterResource.name} ${beforeResource.current} → ${afterResource.current}`);
      }
    }

    if (beforeActor.reactionAvailable !== afterActor.reactionAvailable) {
      changes.push(`Reaction ${afterActor.reactionAvailable ? "restored" : "used"}`);
    }

    if (input.kind === "recovery") {
      const beforeDice = input.before.recoveryState?.hitDiceRemaining;
      const afterDice = input.after.recoveryState?.hitDiceRemaining;
      if (beforeDice !== undefined && afterDice !== undefined && beforeDice !== afterDice) changes.push(`Hit Dice ${beforeDice} → ${afterDice}`);
      const beforeMinutes = input.before.recoveryState?.elapsedMinutes ?? 0;
      const afterMinutes = input.after.recoveryState?.elapsedMinutes ?? 0;
      if (beforeMinutes !== afterMinutes) changes.push(`Downtime +${afterMinutes - beforeMinutes} minutes`);
    }
  }

  if (input.after.pendingResponse && !input.before.pendingResponse) changes.push("Player response required before play continues");
  if (!input.after.turn.action && input.before.turn.action) changes.push("Action used");
  if (!changes.length) changes.push(input.after.pendingResponse ? "Continue with the highlighted response" : "No hit points, conditions, position, or tracked resources changed");

  return { kind: input.kind, eyebrow: copy.eyebrow, title: copy.title, summary: input.summary, changes };
}
