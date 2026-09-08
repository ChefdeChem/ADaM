import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { surinaDaardendrian as source } from "../src/characters/verified-pdf-characters.ts";
import { createPlayableEncounter, playableCharacter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";
import { applyDamageToCombatant, resolveAttackDamage } from "../src/engine/combat-options.ts";
import { areaTargets } from "../src/engine/areas.ts";
import { creatureSenseSnapshot, executeFeatureAction, healingPoolTargetOption, validateFeatureAction } from "../src/engine/feature-actions.ts";
import { resolveGrapple } from "../src/engine/grappling.ts";
import { resolveShove } from "../src/engine/shove.ts";

const profile = playableCharacter(source).character;
const feature = (id) => profile.featureActions.find((candidate) => candidate.id === id);
function ready() {
  const encounter = createPlayableEncounter(source, generateScriptedScenario({ prompt: "", environment: "market", objective: "defeat", difficulty: "easy" }));
  return {
    ...encounter,
    activeIndex: 0,
    selectedTargetId: encounter.combatants[1].id,
    map: { ...encounter.map, terrain: [] },
    combatants: encounter.combatants.map((combatant, index) => ({
      ...combatant,
      initiativeRolled: true,
      position: { x: 1 + index, y: 1 },
      hitPoints: { current: index ? 20 : 11, maximum: index ? 20 : 11 },
    })),
  };
}

test("Fire Resistance halves matching damage, rounds down, and explains the reduction", () => {
  const encounter = ready();
  const damaged = applyDamageToCombatant(encounter, source.id, 7, { damageType: "fire", sourceCombatantId: encounter.combatants[1].id });
  assert.equal(damaged.combatants[0].hitPoints.current, 8);
  assert.match(damaged.log.join(" "), /resistance reduces 7 fire damage to 3/i);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Matching damage is halved, rounded down, and shown in the combat log/);
});

test("Breath Weapon exposes both current shapes and validates an explicit aim before spending its retained use", () => {
  const encounter = ready();
  const breath = feature("breath-weapon-gold");
  const targetId = encounter.combatants[1].id;
  for (const [shape, sizeFeet] of [["cone", 15], ["line", 30]]) {
    const shaped = { ...breath, resolution: { ...breath.resolution, area: { ...breath.resolution.area, shape, sizeFeet } } };
    assert.equal(validateFeatureAction(encounter, shaped, { targetCombatantId: targetId }).legal, true);
    assert.deepEqual(areaTargets(encounter, source.id, targetId, shaped.resolution.area).map((target) => target.id), [targetId]);
  }
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Choose a creature to set the direction/);
  assert.match(page, /Affects \$\{affected\.map/);
});

test("Divine Sense continuously reflects movement during its retained 2024-resolution duration", () => {
  let encounter = ready();
  encounter.combatants[1] = { ...encounter.combatants[1], creatureType: "undead", position: { x: 2, y: 1 } };
  const used = executeFeatureAction(encounter, feature("divine-sense"));
  assert.equal(used.legal, true);
  assert.match(creatureSenseSnapshot(used.encounter, source.id).summary, /undead at 2,1/i);
  const moved = { ...used.encounter, combatants: used.encounter.combatants.map((combatant) => combatant.side === "enemy" ? { ...combatant, position: { x: 8, y: 4 } } : combatant) };
  assert.match(creatureSenseSnapshot(moved, source.id).summary, /undead at 8,4/i);
  const outOfRange = { ...moved, combatants: moved.combatants.map((combatant) => combatant.side === "enemy" ? { ...combatant, position: { x: 20, y: 20 } } : combatant) };
  assert.match(creatureSenseSnapshot(outOfRange, source.id).summary, /no qualifying creatures/i);
});

test("Lay on Hands has an explicit touch-target step and heals the chosen creature rather than the prior attack target", () => {
  let encounter = ready();
  const ally = { ...structuredClone(encounter.combatants[0]), id: "ally", name: "Ally", position: { x: 1, y: 2 }, hitPoints: { current: 4, maximum: 9 } };
  encounter = { ...encounter, combatants: [...encounter.combatants, ally], selectedTargetId: encounter.combatants[1].id };
  const layOnHands = feature("lay-on-hands");
  assert.equal(healingPoolTargetOption(encounter, layOnHands, ally.id).legal, true);
  encounter.combatants[1] = { ...encounter.combatants[1], position: { x: 8, y: 8 } };
  assert.equal(healingPoolTargetOption(encounter, layOnHands, encounter.combatants[1].id).legal, false);
  const healed = executeFeatureAction(encounter, layOnHands, { targetCombatantId: ally.id, resourceAmount: 3 });
  assert.equal(healed.legal, true);
  assert.equal(healed.encounter.combatants.find((combatant) => combatant.id === ally.id).hitPoints.current, 7);
  assert.equal(healed.encounter.combatants.find((combatant) => combatant.side === "enemy").hitPoints.current, 20);
});

test("Unarmed Strike offers Damage, Grapple, and Shove as separate current-resolution choices", () => {
  let encounter = ready();
  const unarmed = encounter.combatants[0].attacks.find((attack) => attack.id === "unarmed-strike");
  const targetId = encounter.combatants[1].id;
  const damage = resolveAttackDamage(encounter, unarmed, targetId, false, () => 0);
  assert.equal(damage.legal, true);
  assert.equal(damage.damageApplied, 4);
  encounter = ready();
  assert.equal(resolveGrapple(encounter, targetId, () => 0).legal, true);
  assert.equal(resolveShove(ready(), targetId, "prone", () => 0).legal, true);
  assert.equal(resolveShove(ready(), targetId, "push", () => 0).legal, true);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Unarmed Strike: Damage/);
  assert.match(page, /Unarmed Strike: Shove/);
  assert.match(page, /Unarmed Strike: Grapple/);
});
