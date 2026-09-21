import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { executeFeatureAction } from "../src/engine/feature-actions.ts";
import { recoverRestResources } from "../src/engine/resources.ts";
import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function importedCharacter(features, overrides = {}) {
  return {
    id: "resource-import",
    name: "Resource Import",
    className: "Paladin",
    level: 1,
    armorClass: 16,
    speedFeet: 30,
    hitPoints: { current: 11, maximum: 11 },
    proficiencyBonus: 2,
    abilities: { strength: 17, dexterity: 8, constitution: 13, intelligence: 12, wisdom: 10, charisma: 15 },
    resources: [],
    attacks: [],
    spells: [],
    profile: { equipment: [], features },
    source: { format: "flattened-pdf", importedAt: "2026-09-21T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

test("extracts an explicit full feature counter with verified long-rest recovery", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Divine Sense", description: "Uses 3/3. All expended uses return after a long rest." },
  ]));
  assert.deepEqual(linked.resources, [{
    id: "imported-divine-sense",
    name: "Divine Sense",
    kind: "generic",
    current: 3,
    maximum: 3,
    recovery: "long-rest",
    sourceFeatureName: "Divine Sense",
    provenance: { rulesetId: "dnd-2014", sourceId: "srd-5.1", sourceReference: "SRD 5.1, Paladin: Divine Sense" },
  }]);
});

test("preserves a printed partial counter instead of refilling it on import", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Divine Sense", description: "Uses 1/3. Regain expended uses after a long rest." },
  ]));
  assert.equal(linked.resources[0].current, 1);
  assert.equal(linked.resources[0].maximum, 3);
});

test("accepts written use counts only when the rest cadence matches the official feature", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Breath Weapon (Gold)", description: "Once per short or long rest, exhale fire in a 15-foot cone." },
    { name: "Divine Sense", description: "Three uses per short rest." },
    { name: "Unverified Gift", description: "Twice per long rest." },
  ]));
  assert.deepEqual(linked.resources.map((resource) => [resource.name, resource.maximum, resource.recovery]), [
    ["Breath Weapon (Gold)", 1, "short-rest"],
  ]);
});

test("a verified imported pool unlocks feature execution, spending, and registered recovery", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter([
    { name: "Divine Sense", description: "Three uses per long rest." },
  ]));
  assert.equal(linked.featureActions?.[0]?.name, "Divine Sense");
  const encounter = createPlayableEncounter(linked, generateScriptedScenario("easy crypt fight"));
  const used = executeFeatureAction(encounter, linked.featureActions[0]);
  assert.equal(used.encounter.combatants[0].resources[0].current, 2);
  const shortRest = recoverRestResources(used.encounter, linked.id, "short-rest");
  assert.equal(shortRest.encounter.combatants[0].resources[0].current, 2);
  const longRest = recoverRestResources(used.encounter, linked.id, "long-rest");
  assert.equal(longRest.encounter.combatants[0].resources[0].current, 3);
});

test("the import review exposes resource provenance and the ambiguity boundary", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Imported feature resources/);
  assert.match(page, /from \$\{resource\.sourceFeatureName\}/);
  assert.match(page, /Only explicit counters with a matching verified feature and recovery rule become executable/);
});
