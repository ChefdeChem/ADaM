import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { endTurn } from "../src/engine/encounter.ts";
import { hasSpellcastingFocus, setLightSourceMode } from "../src/engine/equipment-actions.ts";
import { equipmentCombatActions, executeToolCheck, toolRuleForAction } from "../src/engine/tool-actions.ts";
import { linkVerifiedImportedMechanics } from "../src/importers/verified-import-links.ts";
import { createPlayableEncounter } from "../src/rulesets/edition-policy.ts";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator.ts";

function importedCharacter(overrides = {}) {
  return {
    id: "utility-import",
    name: "Utility Import",
    className: "Bard",
    level: 1,
    armorClass: 12,
    speedFeet: 30,
    hitPoints: { current: 10, maximum: 10 },
    proficiencyBonus: 2,
    abilities: { strength: 10, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 10, charisma: 14 },
    resources: [],
    attacks: [],
    spells: [],
    profile: {
      spellcasting: { ability: "charisma", saveDc: 12, attackBonus: 4 },
      proficiencies: { armor: [], weapons: [], tools: [], languages: [] },
      equipment: [],
      features: [],
    },
    source: { format: "flattened-pdf", importedAt: "2026-09-21T00:00:00.000Z", editionAssessment: { edition: "dnd-2014", confidence: "high", evidence: ["Fixture"] } },
    ...overrides,
  };
}

const scenario = () => generateScriptedScenario("easy crypt fight");

test("links an explicit official spellcasting focus only for its imported spellcasting class", () => {
  const bard = linkVerifiedImportedMechanics(importedCharacter({ profile: { ...importedCharacter().profile, equipment: [{ name: "Lute", quantity: 1 }] } }));
  const bardEncounter = createPlayableEncounter(bard, scenario());
  assert.equal(bard.equipmentRules.find((rule) => rule.name === "Lute")?.resolution.type, "spellcasting-focus");
  assert.equal(hasSpellcastingFocus(bardEncounter, bard.id, "Bard"), true);

  const fighter = linkVerifiedImportedMechanics(importedCharacter({
    className: "Fighter",
    profile: { ...importedCharacter().profile, equipment: [{ name: "Lute", quantity: 1 }] },
  }));
  assert.equal(fighter.equipmentRules.some((rule) => rule.name === "Lute"), false);
});

test("links an imported hooded lantern and exposes its encounter light controls", async () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({ profile: { ...importedCharacter().profile, equipment: [{ name: "Hooded Lantern", quantity: 1 }] } }));
  const encounter = createPlayableEncounter(linked, scenario());
  const lit = setLightSourceMode(encounter, linked.id, "imported-hooded-lantern", "bright");
  const lantern = lit.encounter.combatants.find((combatant) => combatant.id === linked.id)?.inventory.find((item) => item.id === "imported-hooded-lantern");
  assert.equal(lit.legal, true);
  assert.deepEqual({ mode: lantern?.lightSource?.mode, bright: lantern?.lightSource?.brightLightFeet, dim: lantern?.lightSource?.dimLightFeet }, { mode: "bright", bright: 30, dim: 30 });
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /changeLightSource/);
  assert.match(page, />Open<\/button>/);
  assert.match(page, />Hood<\/button>/);
});

test("an active imported light source consumes one minute after ten complete combat rounds", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({ profile: { ...importedCharacter().profile, equipment: [{ name: "Hooded Lantern", quantity: 1 }] } }));
  const started = createPlayableEncounter(linked, scenario());
  const lit = setLightSourceMode(started, linked.id, "imported-hooded-lantern", "bright");
  assert.equal(lit.legal, true);
  const atRoundEnd = { ...lit.encounter, round: 10, activeIndex: lit.encounter.combatants.length - 1, pendingResponse: null };
  const advanced = endTurn(atRoundEnd, () => 0.5);
  const lantern = advanced.combatants.find((combatant) => combatant.id === linked.id)?.inventory.find((item) => item.id === "imported-hooded-lantern");
  assert.equal(advanced.round, 11);
  assert.equal(lantern?.lightSource?.fuelMinutesRemaining, 359);
});

test("links an explicit verified tool to the imported character action surface", () => {
  const linked = linkVerifiedImportedMechanics(importedCharacter({ profile: { ...importedCharacter().profile, equipment: [{ name: "Disguise Kit", quantity: 1 }] } }));
  const actions = equipmentCombatActions(linked);
  assert.deepEqual(actions.map((action) => action.name), ["Use Disguise Kit"]);
  assert.equal(toolRuleForAction(linked, actions[0].id)?.provenance.sourceId, "srd-5.1");
});

test("imported tool proficiency adds the proficiency bonus to the executable tool check", () => {
  const profile = importedCharacter().profile;
  const linked = linkVerifiedImportedMechanics(importedCharacter({
    profile: {
      ...profile,
      proficiencies: { ...profile.proficiencies, tools: ["Disguise Kit"] },
      equipment: [{ name: "Disguise Kit", quantity: 1 }],
    },
  }));
  const encounter = createPlayableEncounter(linked, scenario());
  const action = equipmentCombatActions(linked)[0];
  const rule = toolRuleForAction(linked, action.id);
  const result = executeToolCheck(encounter, rule, "dexterity", () => 0);
  assert.equal(result.legal, true);
  assert.equal(result.proficient, true);
  assert.equal(result.roll.modifier, 4);
  assert.equal(result.roll.total, 5);
});
