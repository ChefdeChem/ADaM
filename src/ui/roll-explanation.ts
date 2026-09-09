import type { D20Result, DamageRoll } from "../engine/dice";

export type RollExplanationKind = "initiative" | "attack" | "damage" | "saving-throw" | "ability-check";

export type RollExplanation = {
  kind: RollExplanationKind;
  eyebrow: string;
  title: string;
  formula: string;
  total: number;
  comparison: string;
  nextStep: string;
};

const eyebrowByKind: Record<RollExplanationKind, string> = {
  initiative: "Initiative roll",
  attack: "Attack roll",
  damage: "Damage roll",
  "saving-throw": "Saving throw",
  "ability-check": "Ability or tool check",
};

function signedModifier(modifier: number): string {
  if (modifier === 0) return "+ 0";
  return `${modifier > 0 ? "+" : "−"} ${Math.abs(modifier)}`;
}

function d20Formula(roll: D20Result): string {
  if (roll.mode === "normal") return `d20 (${roll.kept}) ${signedModifier(roll.modifier)}`;
  const kept = roll.mode === "advantage" ? "higher" : "lower";
  return `2d20 (${roll.rolls.join(", ")}), keep ${kept} ${roll.kept} ${signedModifier(roll.modifier)}`;
}

export function explainD20Roll(input: {
  kind: Exclude<RollExplanationKind, "damage">;
  title: string;
  roll: D20Result;
  target?: { label: string; value: number };
  hiddenTargetLabel?: string;
  outcome?: string;
  nextStep: string;
}): RollExplanation {
  const comparison = input.target
    ? `${input.roll.total} vs ${input.target.label} ${input.target.value}${input.outcome ? ` · ${input.outcome}` : ""}`
    : input.hiddenTargetLabel
      ? `${input.outcome ?? "Resolved"} · ${input.hiddenTargetLabel} stays hidden in Advanced mode`
      : input.outcome ?? "Use this total for the selected check.";
  return {
    kind: input.kind,
    eyebrow: eyebrowByKind[input.kind],
    title: input.title,
    formula: d20Formula(input.roll),
    total: input.roll.total,
    comparison,
    nextStep: input.nextStep,
  };
}

export function explainDamageRoll(input: {
  title: string;
  roll: DamageRoll;
  targetName: string;
  nextStep: string;
}): RollExplanation {
  const { formula, rolls, modifier, critical, total } = input.roll;
  const dice = formula.diceCount === 0
    ? "fixed damage"
    : `${critical ? formula.diceCount * 2 : formula.diceCount}d${formula.dieSize} (${rolls.join(", ")})`;
  return {
    kind: "damage",
    eyebrow: eyebrowByKind.damage,
    title: input.title,
    formula: `${dice} ${signedModifier(modifier)} ${formula.damageType}`,
    total,
    comparison: `${input.targetName} receives the resolved ${formula.damageType} damage after applicable defenses.`,
    nextStep: input.nextStep,
  };
}
