import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { abilityCheckModifier } from "../src/engine/ability-checks.ts";
import { executeSpellChoice } from "../src/engine/combat-options.ts";
import { jsonImporter } from "../src/importers/json.ts";
import { importPlayabilityChecks } from "../src/importers/playability.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

const payload = {
  id: "imported-ranger",
  name: "Imported Ranger",
  className: "Ranger",
  level: 4,
  armorClass: 15,
  speedFeet: 35,
  hitPoints: { current: 28, maximum: 28 },
  proficiencyBonus: 2,
  abilities: { strength: 12, dexterity: 14, constitution: 12, intelligence: 8, wisdom: 16, charisma: 10 },
  savingThrowModifiers: { strength: 7 },
  resources: [{ id: "spell-slot-1", name: "Level 1 Spell Slots", kind: "spell-slot", level: 1, current: 2, maximum: 2, recovery: "long-rest" }],
  attacks: [{ id: "shortbow", name: "Shortbow", kind: "ranged", attackBonus: 4, damage: "1d6 + 2 piercing", normalRangeFeet: 80, longRangeFeet: 320 }],
  spells: [{
    id: "training-ward",
    name: "Training Ward",
    level: 1,
    castingTime: "action",
    rangeFeet: 0,
    target: "self",
    requiresLineOfSight: false,
    durationRounds: 1,
    effect: { name: "Training Ward", description: "A harmless imported test effect." },
    provenance: { rulesetId: "dnd-2024", sourceId: "user-imported", sourceReference: "Import fixture" },
  }],
  profile: { initiativeModifier: 5, skills: { Perception: 6 } },
  source: { format: "json", importedAt: "2026-09-20T00:00:00.000Z" },
};

async function imported() {
  const result = await jsonImporter.import(new File([JSON.stringify(payload)], "imported-ranger.json", { type: "application/json" }));
  return result.character;
}

function encounter(character) {
  return createPlayableEncounter(character, generateScriptedScenario("easy crypt fight"));
}

test("imported initiative modifier reaches the encounter instead of being replaced by Dexterity", async () => {
  const character = await imported();
  assert.equal(encounter(character).combatants[0].initiativeModifier, 5);
  assert.match(importPlayabilityChecks(character).find((check) => check.id === "initiative").detail, /\+5 from the imported profile/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Five combat handoffs/);
});

test("imported walking speed is available on the first turn", async () => {
  const character = await imported();
  const ready = encounter(character);
  assert.equal(ready.combatants[0].baseSpeedFeet, 35);
  assert.equal(ready.turn.movementRemaining, 35);
  assert.match(importPlayabilityChecks(character).find((check) => check.id === "movement").detail, /35 feet/);
});

test("explicit imported saving throws remain while missing saves derive from abilities", async () => {
  const character = await imported();
  const player = encounter(character).combatants[0];
  assert.equal(player.savingThrowModifiers.strength, 7);
  assert.equal(player.savingThrowModifiers.dexterity, 2);
  assert.match(importPlayabilityChecks(character).find((check) => check.id === "saving-throws").detail, /1 imported modifier; 5 safely derived/);
});

test("imported skill modifiers override ability defaults and unlisted skills use their linked ability", async () => {
  const character = await imported();
  const ready = encounter(character);
  assert.equal(abilityCheckModifier(ready, character.id, "perception"), 6);
  assert.equal(abilityCheckModifier(ready, character.id, "arcana"), -1);
  assert.match(importPlayabilityChecks(character).find((check) => check.id === "skill-checks").detail, /all 18 registered skills/);
});

test("imported leveled spells spend their matching imported spell-slot pool", async () => {
  const character = await imported();
  const ready = encounter(character);
  const result = executeSpellChoice(ready, character.spells[0], () => 0.5);
  assert.equal(result.legal, true);
  assert.equal(result.encounter.combatants[0].resources.find((resource) => resource.id === "spell-slot-1").current, 1);
  assert.equal(result.encounter.turn.action, false);
  assert.match(importPlayabilityChecks(character).find((check) => check.id === "spell-slots").detail, /1\/1 leveled spell linked/);
});
