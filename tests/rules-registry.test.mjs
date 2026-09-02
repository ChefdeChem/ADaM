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
    assert.ok(report.entries.every((entry) => entry.sourceReference === character.source.fileName));
    assert.ok(report.entries.every((entry) => entry.rulesetId === character.rulesetId));
  }
});

test("coverage separates executable cores from unresolved riders", () => {
  const cleira = BUILT_IN_CHARACTERS.find((character) => character.id === "cleira-oestwilde");
  const report = buildCharacterMechanicCoverage(cleira);
  const healingWord = report.entries.find((entry) => entry.entityId === "healing-word");
  const viciousMockery = report.entries.find((entry) => entry.entityId === "vicious-mockery");
  assert.equal(healingWord.status, "supported");
  assert.equal(viciousMockery.status, "partial");
  assert.match(viciousMockery.missingCapabilities.join(" "), /disadvantage rider/i);
});

test("weapon mastery is partial while its core attack remains registered", () => {
  const barbarian = BUILT_IN_CHARACTERS.find((character) => character.id === "goliath-barbarian");
  const report = buildCharacterMechanicCoverage(barbarian);
  const maul = report.entries.find((entry) => entry.entityId === "maul");
  assert.equal(maul.status, "partial");
  assert.deepEqual(maul.components, ["targeting", "range", "attack-roll", "damage-roll"]);
});
