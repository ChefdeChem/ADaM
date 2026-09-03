import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CHARACTERS } from "../src/characters/built-ins.ts";
import { buildCharacterMechanicCoverage, canonicalRuleId, RULE_SOURCES } from "../src/rules-registry/index.ts";

test("registry declares versioned official, accelerator, imported, and original sources", () => {
  assert.equal(RULE_SOURCES["srd-5.1"].version, "5.1");
  assert.equal(RULE_SOURCES["srd-5.2.1"].version, "5.2.1");
  assert.equal(RULE_SOURCES["srd-5.2.1"].license, "CC-BY-4.0");
  assert.equal(RULE_SOURCES["open5e-v2"].validationRequired, true);
  assert.equal(RULE_SOURCES["user-imported"].license, "user-provided");
});

test("canonical rule IDs preserve edition boundaries", () => {
  assert.equal(canonicalRuleId("dnd-2014", "spell", "Healing Word"), "dnd-2014.spell.healing-word");
  assert.notEqual(canonicalRuleId("dnd-2014", "spell", "Healing Word"), canonicalRuleId("dnd-2024", "spell", "Healing Word"));
});

test("all five verified characters receive provenance and non-empty coverage", () => {
  assert.equal(BUILT_IN_CHARACTERS.length, 5);
  for (const character of BUILT_IN_CHARACTERS) {
    const report = buildCharacterMechanicCoverage(character);
    assert.equal(report.sourceId, "user-imported");
    assert.ok(report.total > 0, `${character.name} should have mechanics`);
    assert.equal(report.total, report.entries.length);
    assert.ok(report.entries.every((entry) => entry.evidenceReference === character.source.fileName));
    assert.ok(report.entries.every((entry) => entry.evidenceSourceId === "user-imported"));
  }
});

test("feature provenance can cross the character's base edition without changing it", () => {
  const pharos = BUILT_IN_CHARACTERS.find((character) => character.id === "pharos");
  const report = buildCharacterMechanicCoverage(pharos);
  const adrenalineRush = report.entries.find((entry) => entry.entityId === "adrenaline-rush" && entry.kind === "feature");
  assert.equal(pharos.rulesetId, "dnd-2014");
  assert.equal(adrenalineRush.rulesetId, "dnd-2024");
  assert.equal(adrenalineRush.sourceId, "srd-5.2.1");
  assert.equal(adrenalineRush.evidenceSourceId, "user-imported");
  assert.equal(adrenalineRush.evidenceReference, "Orc Warlock.pdf");
  assert.equal(adrenalineRush.status, "supported");
  assert.equal(adrenalineRush.executable, true);
  assert.deepEqual(adrenalineRush.missingCapabilities, []);
  assert.deepEqual(adrenalineRush.components, ["action-economy", "movement", "resource-spend", "resource-recovery", "temporary-hit-points"]);
});

test("triggered feature coverage records Relentless Endurance as an executable 2024 replacement", () => {
  const pharos = BUILT_IN_CHARACTERS.find((character) => character.id === "pharos");
  const report = buildCharacterMechanicCoverage(pharos);
  const relentlessEndurance = report.entries.find((entry) => entry.entityId === "relentless-endurance" && entry.kind === "feature");
  assert.equal(relentlessEndurance.rulesetId, "dnd-2024");
  assert.equal(relentlessEndurance.sourceId, "srd-5.2.1");
  assert.equal(relentlessEndurance.status, "supported");
  assert.equal(relentlessEndurance.executable, true);
  assert.deepEqual(relentlessEndurance.components, ["trigger", "replacement-effect", "resource-spend", "resource-recovery"]);
});

test("triggered feature coverage records Stone's Endurance as an executable 2024 damage reaction", () => {
  const barbarian = BUILT_IN_CHARACTERS.find((character) => character.id === "goliath-barbarian");
  const report = buildCharacterMechanicCoverage(barbarian);
  const stonesEndurance = report.entries.find((entry) => entry.entityId === "stones-endurance" && entry.kind === "feature");
  assert.equal(stonesEndurance.rulesetId, "dnd-2024");
  assert.equal(stonesEndurance.sourceId, "srd-5.2.1");
  assert.equal(stonesEndurance.status, "supported");
  assert.equal(stonesEndurance.executable, true);
  assert.deepEqual(stonesEndurance.missingCapabilities, []);
  assert.deepEqual(stonesEndurance.components, ["trigger", "reaction", "dice-roll", "damage-reduction", "resource-spend", "resource-recovery"]);
});

test("coverage separates executable cores from unresolved riders", () => {
  const cleira = BUILT_IN_CHARACTERS.find((character) => character.id === "cleira-oestwilde");
  const report = buildCharacterMechanicCoverage(cleira);
  const healingWord = report.entries.find((entry) => entry.entityId === "healing-word");
  const viciousMockery = report.entries.find((entry) => entry.entityId === "vicious-mockery");
  assert.equal(healingWord.status, "supported");
  assert.equal(healingWord.executable, true);
  assert.equal(viciousMockery.status, "partial");
  assert.equal(viciousMockery.executable, false);
  assert.match(viciousMockery.missingCapabilities.join(" "), /disadvantage rider/i);
});

test("weapon mastery is partial while its core attack remains registered", () => {
  const barbarian = BUILT_IN_CHARACTERS.find((character) => character.id === "goliath-barbarian");
  const report = buildCharacterMechanicCoverage(barbarian);
  const maul = report.entries.find((entry) => entry.entityId === "maul");
  assert.equal(maul.status, "partial");
  assert.equal(maul.executable, true);
  assert.deepEqual(maul.components, ["targeting", "range", "attack-roll", "damage-roll"]);
});
