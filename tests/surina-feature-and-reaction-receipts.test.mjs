import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actionCatalog, consumeAction } from "../src/engine/actions.ts";
import { applyEffect } from "../src/engine/effects.ts";
import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { releaseGrapple } from "../src/engine/grappling.ts";
import { endHiding } from "../src/engine/interactions.ts";
import { surinaDaardendrian as source } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter, playableCharacter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { buildResolutionReceipt } from "../src/ui/resolution-receipt.ts";

const scenario = generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" });

function encounter() {
  const state = createPlayableEncounter(source, scenario);
  return {
    ...state,
    selectedTargetId: null,
    map: { ...state.map, terrain: [] },
    combatants: state.combatants.map((combatant, index) => ({ ...combatant, initiative: 20 - index, initiativeRolled: true, position: { x: 1 + index, y: 1 } })),
  };
}

test("Divine Sense receipt shows current-resolution duration, live tracking, resource, and Bonus Action", () => {
  const before = encounter();
  const feature = playableCharacter(source).character.featureActions.find((candidate) => candidate.id === "divine-sense");
  const result = executeFeatureAction(before, feature);
  assert.equal(result.legal, true);
  const receipt = buildResolutionReceipt({ kind: "divine-sense", before, after: result.encounter, actorId: before.combatants[0].id, summary: result.summary });
  const changes = receipt.changes.join(" ");
  assert.match(changes, /Active within 60 ft\. · 10 minutes/);
  assert.match(changes, /locations and sacred auras update/);
  assert.match(changes, /Ends if Surina is Incapacitated/);
  assert.match(changes, /Divine Sense 3 → 2/);
  assert.match(changes, /Bonus Action used/);
});

test("Dodge receipt explains both defenses and its ending conditions", () => {
  const before = encounter();
  const after = consumeAction(actionCatalog.find((action) => action.id === "dodge"), before);
  const receipt = buildResolutionReceipt({ kind: "dodge", before, after, actorId: before.combatants[0].id, summary: "Surina Dodges." });
  const changes = receipt.changes.join(" ");
  assert.match(changes, /Visible attackers have Disadvantage/);
  assert.match(changes, /Advantage on Dexterity saving throws/);
  assert.match(changes, /Speed becomes 0/);
  assert.match(changes, /Action used/);
});

test("voluntary grapple-release receipt names the released creature and confirms its cost", () => {
  const base = encounter();
  const actor = base.combatants[0];
  const target = base.combatants[1];
  const before = applyEffect(base, { name: `Grappled by ${actor.name}`, description: "Speed 0", sourceCombatantId: actor.id, targetCombatantId: target.id, conditionGranted: "Grappled", grapple: { escapeDc: 13, rangeFeet: 5 } });
  const grapple = before.effects.find((effect) => effect.grapple);
  const result = releaseGrapple(before, grapple.id, actor.id);
  assert.equal(result.legal, true);
  const receipt = buildResolutionReceipt({ kind: "release-grapple", before, after: result.encounter, actorId: actor.id, summary: result.summary });
  assert.match(receipt.changes.join(" "), new RegExp(`${target.name} released`));
  assert.match(receipt.changes.join(" "), /No Action spent/);
});

test("speaking-to-end-Hide receipt makes detection and zero action cost explicit", () => {
  const base = encounter();
  const actor = base.combatants[0];
  const before = applyEffect(base, { name: "Hidden", description: "Hidden", sourceCombatantId: actor.id, targetCombatantId: actor.id, hidden: { dc: 15 } });
  const after = endHiding(before, actor.id, "player speaks loudly");
  const receipt = buildResolutionReceipt({ kind: "reveal-self", before, after, actorId: actor.id, summary: "Surina speaks and stops hiding." });
  assert.match(receipt.changes.join(" "), /Hidden ended · enemies can detect Surina normally/);
  assert.match(receipt.changes.join(" "), /No Action spent/);
});

test("opportunity-attack receipt guides selection, hit, and declined-reaction states", () => {
  const base = encounter();
  const actor = base.combatants[0];
  const target = base.combatants[1];
  const pending = { type: "opportunity-attack", phase: "choice", sourceCombatantId: actor.id, targetCombatantId: target.id, availableAttackIds: [actor.attacks[0].id], continuation: { moverId: target.id, destination: { x: 3, y: 1 }, remainingPath: [] } };
  const beforeChoice = { ...base, pendingResponse: pending };
  const afterChoice = { ...beforeChoice, pendingResponse: { ...pending, phase: "attack-roll", attackId: actor.attacks[0].id } };
  assert.match(buildResolutionReceipt({ kind: "opportunity-attack", before: beforeChoice, after: afterChoice, actorId: actor.id, summary: "Weapon selected." }).changes.join(" "), /roll the attack next/);

  const beforeRoll = afterChoice;
  const afterRoll = { ...beforeRoll, pendingResponse: { ...beforeRoll.pendingResponse, phase: "damage-roll", critical: false }, combatants: beforeRoll.combatants.map((combatant) => combatant.id === actor.id ? { ...combatant, reactionAvailable: false } : combatant) };
  const hitChanges = buildResolutionReceipt({ kind: "opportunity-attack", before: beforeRoll, after: afterRoll, actorId: actor.id, summary: "The attack hits." }).changes.join(" ");
  assert.match(hitChanges, /roll damage next/);
  assert.match(hitChanges, /Reaction used/);

  const declined = { ...beforeChoice, pendingResponse: null };
  assert.match(buildResolutionReceipt({ kind: "opportunity-attack", before: beforeChoice, after: declined, actorId: actor.id, summary: "Reaction saved." }).changes.join(" "), /Reaction preserved/);
});

test("the Surina page wires persistent results to all five workflows", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const marker of ["divine-sense", "dodge", "release-grapple", "reveal-self", "opportunity-attack"]) assert.match(page, new RegExp(`kind: "${marker}"`));
  assert.match(page, /stopHidingBySpeaking/);
  assert.match(page, /Opportunity Attack.*damage/);
});
