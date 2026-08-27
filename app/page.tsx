"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { AbilityName, Character, CharacterAttack, CharacterSpell } from "../src/domain/character";
import type { ActionCost, CombatAction, ExperienceMode } from "../src/domain/combat";
import { actionCatalog, consumeAction, findActionFromText, validateAction, visibleActionsForMode } from "../src/engine/actions";
import { executeAttackChoice, executeSpellChoice, validateAttackChoice, validateSpellChoice } from "../src/engine/combat-options";
import { applyEffect, effectiveArmorClass, effectsForCombatant, remainingEffectRounds } from "../src/engine/effects";
import { createEncounter, endTurn } from "../src/engine/encounter";
import { moveActiveCombatant } from "../src/engine/movement";
import { analyzeTarget, selectTarget } from "../src/engine/targeting";
import { rollD20 } from "../src/engine/dice";
import { importCharacterFile, type ImportResult } from "../src/importers";
import { rulesets, type RulesetId } from "../src/rulesets";
import { defaultScenarioSetup, generateScriptedScenario, scenarioTemplates } from "../src/scenarios/scripted-generator";
import type { ScenarioDifficulty, ScenarioEnvironment, ScenarioObjective, ScenarioSetup, ScenarioTemplate } from "../src/scenarios/types";

type ScenarioSetupMode = "describe" | "guided" | "combined" | "templates";
type ActionCategory = Extract<ActionCost, "action" | "bonus-action" | "movement">;
type ChoiceMode = "attack" | "spell" | null;

const actionCategoryCopy: Array<{ id: ActionCategory; label: string; detail: string }> = [
  { id: "action", label: "Action", detail: "Attacks, magic, and core actions" },
  { id: "bonus-action", label: "Bonus Action", detail: "Features with a bonus-action cost" },
  { id: "movement", label: "Movement", detail: "Positioning on the tactical grid" },
];

const setupModeCopy: Record<ScenarioSetupMode, { label: string; detail: string }> = {
  describe: { label: "Describe", detail: "Write the encounter in your own words." },
  guided: { label: "Guided", detail: "Choose environment, objective, and difficulty." },
  combined: { label: "Combined", detail: "Use controls, then add custom details." },
  templates: { label: "Templates", detail: "Start from a saved scenario setup." },
};

const abilityLabels: Array<{ id: AbilityName; label: string }> = [
  { id: "strength", label: "Strength" },
  { id: "dexterity", label: "Dexterity" },
  { id: "constitution", label: "Constitution" },
  { id: "intelligence", label: "Intelligence" },
  { id: "wisdom", label: "Wisdom" },
  { id: "charisma", label: "Charisma" },
];

const sample: Character = {
  id: "sample-hinnom", name: "Hinnom", className: "Sorcerer", level: 4, armorClass: 15,
  speedFeet: 30, hitPoints: { current: 34, maximum: 34 }, proficiencyBonus: 2,
  abilities: { strength: 8, dexterity: 12, constitution: 16, intelligence: 10, wisdom: 13, charisma: 18 },
  resources: [
    { id: "sorcery-points", name: "Sorcery Points", kind: "generic", current: 4, maximum: 4, recovery: "long-rest" },
    { id: "spell-slot-1", name: "Level 1 Spell Slots", kind: "spell-slot", level: 1, current: 4, maximum: 4, recovery: "long-rest" },
    { id: "spell-slot-2", name: "Level 2 Spell Slots", kind: "spell-slot", level: 2, current: 3, maximum: 3, recovery: "long-rest" },
  ],
  attacks: [
    { id: "quarterstaff", name: "Quarterstaff", kind: "melee", attackBonus: 1, damage: "1d6 − 1 bludgeoning", normalRangeFeet: 5, description: "A close-range melee strike." },
    { id: "thrown-dagger", name: "Thrown Dagger", kind: "ranged", attackBonus: 3, damage: "1d4 + 1 piercing", normalRangeFeet: 20, longRangeFeet: 60, description: "Normal to 20 feet; disadvantage from 25–60 feet." },
    { id: "light-crossbow", name: "Light Crossbow", kind: "ranged", attackBonus: 3, damage: "1d8 + 1 piercing", normalRangeFeet: 80, longRangeFeet: 320, description: "Normal to 80 feet; disadvantage from 85–320 feet." },
  ],
  spells: [
    { id: "fire-bolt", name: "Fire Bolt", level: 0, castingTime: "action", rangeFeet: 120, target: "single", requiresLineOfSight: true, attackBonus: 6, damage: "1d10 fire" },
    { id: "chromatic-orb", name: "Chromatic Orb", level: 1, castingTime: "action", rangeFeet: 90, target: "single", requiresLineOfSight: true, attackBonus: 6, damage: "3d8 chosen damage" },
    { id: "scorching-ray", name: "Scorching Ray", level: 2, castingTime: "action", rangeFeet: 120, target: "single", requiresLineOfSight: true, attackBonus: 6, damage: "2d6 fire per ray" },
    { id: "false-life", name: "False Life", level: 1, castingTime: "action", rangeFeet: 0, target: "self", requiresLineOfSight: false, durationRounds: 600, effect: { name: "False Life", description: "7 temporary hit points for 1 hour.", temporaryHitPoints: 7 } },
    { id: "blur", name: "Blur", level: 2, castingTime: "action", rangeFeet: 0, target: "self", requiresLineOfSight: false, concentration: true, durationRounds: 10, effect: { name: "Blur", description: "Incoming attacks have disadvantage while concentration lasts.", modifiers: { incomingAttacks: "disadvantage" } } },
  ],
  actions: ["Attack", "Magic", "Cast a Spell", "Dash", "Disengage", "Dodge", "Help", "Hide", "Ready", "Search", "Utilize", "Use an Object", "Study", "Influence", "Quickened Spell"],
  source: { format: "sample", importedAt: new Date().toISOString() },
};

const modeCopy: Record<ExperienceMode, { label: string; detail: string }> = {
  beginner: { label: "Beginner", detail: "Only currently legal character actions are shown." },
  training: { label: "Training", detail: "All actions are shown; illegal choices explain why." },
  advanced: { label: "Advanced", detail: "All actions remain available; illegal choices are simply disallowed." },
};

function withCombatDefaults(character: Character): Character {
  return {
    ...character,
    speedFeet: character.speedFeet ?? 30,
    resources: (character.resources ?? []).map((resource, index) => ({
      id: resource.id ?? `resource-${index}`,
      name: resource.name,
      kind: resource.kind ?? "generic",
      level: resource.level,
      current: resource.current,
      maximum: resource.maximum,
      recovery: resource.recovery ?? "long-rest",
    })),
    attacks: character.attacks?.length ? character.attacks : [{
      id: "unarmed-strike",
      name: "Unarmed Strike",
      kind: "melee",
      attackBonus: character.proficiencyBonus,
      damage: "1 + Strength modifier bludgeoning",
      normalRangeFeet: 5,
      description: "Fallback attack added because the imported sheet did not include attack data.",
    }],
    spells: character.spells ?? [],
  };
}

export default function Home() {
  const [character, setCharacter] = useState(sample);
  const [rulesetId, setRulesetId] = useState<RulesetId>("dnd-2024");
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>("beginner");
  const [message, setMessage] = useState("Using the built-in sample character. Import a PDF or ADaM JSON anytime.");
  const [pendingImport, setPendingImport] = useState<ImportResult | null>(null);
  const [reviewCharacter, setReviewCharacter] = useState<Character | null>(null);
  const [setupMode, setSetupMode] = useState<ScenarioSetupMode>("combined");
  const [scenarioPrompt, setScenarioPrompt] = useState(defaultScenarioSetup.prompt);
  const [environment, setEnvironment] = useState<ScenarioEnvironment>(defaultScenarioSetup.environment);
  const [objective, setObjective] = useState<ScenarioObjective>(defaultScenarioSetup.objective);
  const [difficulty, setDifficulty] = useState<ScenarioDifficulty>(defaultScenarioSetup.difficulty);
  const [scenario, setScenario] = useState(() => generateScriptedScenario(defaultScenarioSetup));
  const [savedTemplates, setSavedTemplates] = useState<ScenarioTemplate[]>([]);
  const [encounter, setEncounter] = useState(() => createEncounter(sample, scenario));
  const [command, setCommand] = useState("");
  const [feedback, setFeedback] = useState("Choose an action or describe what you want to do.");
  const [lastRoll, setLastRoll] = useState<ReturnType<typeof rollD20> | null>(null);
  const [actionCategory, setActionCategory] = useState<ActionCategory>("action");
  const [choiceMode, setChoiceMode] = useState<ChoiceMode>(null);

  const activeRuleset = rulesets.find((ruleset) => ruleset.id === rulesetId)!;
  const visibleActions = useMemo(
    () => visibleActionsForMode(character, rulesetId, experienceMode, encounter),
    [character, encounter, experienceMode, rulesetId],
  );
  const categorizedActions = useMemo(() => visibleActions.filter((action) => action.cost === actionCategory), [actionCategory, visibleActions]);
  const activeCombatant = encounter.combatants[encounter.activeIndex];
  const playerCombatant = encounter.combatants.find((combatant) => combatant.id === character.id) ?? encounter.combatants[0];
  const playerArmorClass = effectiveArmorClass(encounter, playerCombatant.id);
  const playerEffects = effectsForCombatant(encounter, playerCombatant.id);
  const targetAnalysis = useMemo(() => encounter.selectedTargetId ? analyzeTarget(encounter, encounter.selectedTargetId) : null, [encounter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem("adam-scenario-templates");
        if (stored) setSavedTemplates(JSON.parse(stored) as ScenarioTemplate[]);
      } catch {
        setSavedTemplates([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setMessage(`Reading ${file.name}...`);
    try {
      const imported = await importCharacterFile(file);
      if (imported.requiresReview) {
        setPendingImport(imported);
        setReviewCharacter(imported.character);
        setMessage(`${file.name} read. Review the extracted values before using this character.`);
      } else {
        applyImportedCharacter(imported.character, imported.warnings);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The sheet could not be imported."); }
    finally { event.target.value = ""; }
  }

  function applyImportedCharacter(importedCharacter: Character, warnings: string[]) {
    const normalized = withCombatDefaults(importedCharacter);
    setCharacter(normalized);
    setEncounter(createEncounter(normalized, scenario));
    setChoiceMode(null);
    setMessage(`${normalized.name} imported. ${warnings.join(" ") || "Ready for combat."}`);
  }

  function updateReviewNumber(field: "level" | "armorClass" | "proficiencyBonus" | "speedFeet", value: string) {
    setReviewCharacter((current) => current ? { ...current, [field]: Number(value) } : current);
  }

  function updateReviewHitPoints(field: "current" | "maximum", value: string) {
    setReviewCharacter((current) => current ? { ...current, hitPoints: { ...current.hitPoints, [field]: Number(value) } } : current);
  }

  function updateReviewAbility(ability: AbilityName, value: string) {
    setReviewCharacter((current) => current ? { ...current, abilities: { ...current.abilities, [ability]: Number(value) } } : current);
  }

  function confirmReviewedImport(event: FormEvent) {
    event.preventDefault();
    if (!reviewCharacter) return;
    applyImportedCharacter(reviewCharacter, pendingImport?.warnings ?? []);
    setPendingImport(null);
    setReviewCharacter(null);
  }

  function runAction(action: CombatAction) {
    if (action.id === "end-turn") { setEncounter((state) => endTurn(state)); setChoiceMode(null); setFeedback("Turn ended. Initiative advanced."); return; }
    if (action.id === "attack" && !encounter.selectedTargetId) {
      setChoiceMode("attack");
      setFeedback(`${character.attacks?.length ?? 0} weapon attacks are ready. Select an enemy token on the tactical map to check range and use one.`);
      return;
    }
    const validation = validateAction(action, encounter, character);
    if (!validation.legal) {
      setFeedback(experienceMode === "training" ? validation.reason ?? "That action is not currently legal." : "Action disallowed."); return;
    }
    if (action.id === "move") { setFeedback("Choose a highlighted adjacent square on the tactical map. Difficult terrain costs 10 feet."); return; }
    if (action.id === "attack") { setChoiceMode("attack"); setFeedback("Choose the specific attack to resolve against the selected target."); return; }
    if (action.id === "magic" || action.id === "cast-spell") { setChoiceMode("spell"); setFeedback("Choose a spell. ADaM will verify its level, slot, target, and range before casting."); return; }
    let next = consumeAction(action, encounter);
    if (action.id === "dodge") {
      next = applyEffect(next, {
        name: "Dodge",
        description: "Incoming attacks have disadvantage until the start of your next turn.",
        sourceCombatantId: activeCombatant.id,
        targetCombatantId: activeCombatant.id,
        durationRounds: 1,
        modifiers: { incomingAttacks: "disadvantage" },
      });
    }
    setEncounter(next);
    setChoiceMode(null);
    const roll = rollD20({ mode: "normal", modifier: character.proficiencyBonus }); setLastRoll(roll);
    const targetCopy = action.targeting?.mode === "single" && targetAnalysis ? ` against ${targetAnalysis.target.name}` : "";
    setFeedback(`${action.name}${targetCopy} accepted. Resolution roll: ${roll.total} (${roll.kept} + ${roll.modifier}).`);
  }

  function chooseAttack(attack: CharacterAttack) {
    const result = executeAttackChoice(encounter, attack);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter); setLastRoll(result.roll); setChoiceMode(null); setFeedback(result.summary);
  }

  function chooseSpell(spell: CharacterSpell) {
    const result = executeSpellChoice(encounter, spell);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter); setLastRoll(result.roll); setChoiceMode(null); setFeedback(result.summary);
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const action = findActionFromText(command, rulesetId);
    if (!action) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : "I could not match that request to a supported action yet. Try naming the action directly."); return; }
    runAction(action); setCommand("");
  }

  function buildScenario(event: FormEvent) {
    event.preventDefault();
    const setup: ScenarioSetup = { prompt: setupMode === "guided" ? "" : scenarioPrompt, environment, objective, difficulty };
    const next = generateScriptedScenario(setupMode === "describe" ? scenarioPrompt : setup);
    setScenario(next); setEncounter(createEncounter(character, next)); setFeedback(next.opening);
  }

  function loadTemplate(template: ScenarioTemplate) {
    setScenarioPrompt(template.setup.prompt);
    setEnvironment(template.setup.environment);
    setObjective(template.setup.objective);
    setDifficulty(template.setup.difficulty);
    const next = generateScriptedScenario(template.setup);
    setScenario(next); setEncounter(createEncounter(character, next)); setFeedback(`${template.name} loaded. ${next.opening}`);
  }

  function saveTemplate() {
    const template: ScenarioTemplate = {
      id: `saved-${Date.now()}`,
      name: `${scenario.title} · ${scenario.difficulty}`,
      description: scenarioPrompt || `${scenario.objective} in ${scenario.environment}`,
      setup: { prompt: scenarioPrompt, environment, objective, difficulty },
    };
    const next = [...savedTemplates, template];
    setSavedTemplates(next);
    localStorage.setItem("adam-scenario-templates", JSON.stringify(next));
    setFeedback("Scenario setup saved on this device.");
  }

  function handleGridMove(x: number, y: number) {
    const result = moveActiveCombatant(encounter, x, y);
    if (result.legal) setEncounter(result.encounter);
    setFeedback(result.reason);
  }

  function handleGridInteraction(x: number, y: number, occupantId?: string) {
    if (!occupantId) { handleGridMove(x, y); return; }
    if (occupantId === activeCombatant.id) {
      setEncounter((state) => selectTarget(state, null));
      setFeedback("Target cleared. Select another creature before choosing a targeted action.");
      return;
    }
    const analysis = analyzeTarget(encounter, occupantId);
    if (!analysis) return;
    setEncounter((state) => selectTarget(state, occupantId));
    setFeedback(`${analysis.target.name} selected at ${analysis.distanceFeet} feet. Line of sight: ${analysis.lineOfSight ? "clear" : "blocked"}. Cover: ${analysis.cover}.`);
  }

  return <main className="app-shell">
    <header className="topbar"><div><span className="eyebrow">ADaM · Automated Dungeon & Mechanics</span><h1>Combat Trainer</h1></div><div className="status"><span />Rules engine active</div></header>
    {pendingImport && reviewCharacter && <div className="import-review-backdrop">
      <form className="import-review" onSubmit={confirmReviewedImport} role="dialog" aria-modal="true" aria-labelledby="import-review-title">
        <div className="import-review-heading"><div><span className="eyebrow">Flattened PDF detected</span><h2 id="import-review-title">Review imported character</h2></div><span className="import-count">{reviewCharacter.attacks?.length ?? 0} attacks found</span></div>
        <p className="import-review-note">{pendingImport.warnings.join(" ")} Correct anything that does not match the PDF, then load the character into combat.</p>
        <div className="import-core-grid">
          <label>Character name<input required value={reviewCharacter.name} onChange={(event) => setReviewCharacter({ ...reviewCharacter, name: event.target.value })} /></label>
          <label>Class<input required value={reviewCharacter.className} onChange={(event) => setReviewCharacter({ ...reviewCharacter, className: event.target.value })} /></label>
          <label>Level<input required min="1" max="20" type="number" value={reviewCharacter.level} onChange={(event) => updateReviewNumber("level", event.target.value)} /></label>
          <label>Armor class<input required min="1" type="number" value={reviewCharacter.armorClass} onChange={(event) => updateReviewNumber("armorClass", event.target.value)} /></label>
          <label>Current HP<input required min="0" type="number" value={reviewCharacter.hitPoints.current} onChange={(event) => updateReviewHitPoints("current", event.target.value)} /></label>
          <label>Maximum HP<input required min="1" type="number" value={reviewCharacter.hitPoints.maximum} onChange={(event) => updateReviewHitPoints("maximum", event.target.value)} /></label>
          <label>Proficiency bonus<input required min="0" type="number" value={reviewCharacter.proficiencyBonus} onChange={(event) => updateReviewNumber("proficiencyBonus", event.target.value)} /></label>
          <label>Walking speed<input required min="0" step="5" type="number" value={reviewCharacter.speedFeet ?? 30} onChange={(event) => updateReviewNumber("speedFeet", event.target.value)} /></label>
        </div>
        <div className="import-ability-grid">{abilityLabels.map((ability) => <label key={ability.id}>{ability.label}<input required min="1" max="30" type="number" value={reviewCharacter.abilities[ability.id]} onChange={(event) => updateReviewAbility(ability.id, event.target.value)} /></label>)}</div>
        {(reviewCharacter.attacks?.length ?? 0) > 0 && <div className="import-attacks"><span>Imported attacks</span><p>{reviewCharacter.attacks?.map((attack) => `${attack.name} (${attack.attackBonus >= 0 ? "+" : ""}${attack.attackBonus}, ${attack.damage}, ${attack.normalRangeFeet}${attack.longRangeFeet ? `/${attack.longRangeFeet}` : ""} ft.)`).join(" · ")}</p></div>}
        <div className="import-review-actions"><button type="button" onClick={() => { setPendingImport(null); setReviewCharacter(null); setMessage("Import canceled; the previous character remains active."); }}>Cancel</button><button type="submit">Use this character</button></div>
      </form>
    </div>}
    <section className="workspace">
      <aside className="sidebar">
        <div className="panel"><div className="panel-heading"><span>01</span><h2>Character</h2></div><label className="file-button">Import character sheet<input type="file" accept="application/pdf,application/json,.json,.pdf" onChange={handleImport} /></label><p className="helper">{message}</p></div>
        <div className="character-card"><div className="portrait">{character.name[0]?.toUpperCase()}</div><div><p className="character-name">{character.name}</p><p>{character.className} · Level {character.level}</p></div></div>
        <div className="stats"><div><span>AC</span><strong>{playerArmorClass}</strong>{playerArmorClass !== character.armorClass && <small>base {character.armorClass}</small>}</div><div><span>HP</span><strong>{playerCombatant.hitPoints.current}/{playerCombatant.hitPoints.maximum}</strong>{playerCombatant.temporaryHitPoints > 0 && <small>+{playerCombatant.temporaryHitPoints} temp</small>}</div><div><span>PROF</span><strong>+{character.proficiencyBonus}</strong></div></div>
        <div className="weapon-summary"><span>Weapon attacks</span><strong>{character.attacks?.length ?? 0} ready</strong><p>{character.attacks?.map((attack) => attack.name).join(" · ") || "No weapon attacks imported."}</p></div>
        <div className="panel"><div className="panel-heading"><span>02</span><h2>Experience</h2></div><div className="mode-list">{(Object.keys(modeCopy) as ExperienceMode[]).map((mode) => <button key={mode} className={experienceMode === mode ? "selected" : ""} onClick={() => { setExperienceMode(mode); setFeedback(modeCopy[mode].detail); }}><strong>{modeCopy[mode].label}</strong><small>{modeCopy[mode].detail}</small></button>)}</div></div>
        <div className="panel"><div className="panel-heading"><span>03</span><h2>Ruleset</h2></div><div className="ruleset-list">{rulesets.map((ruleset) => <button key={ruleset.id} className={ruleset.id === rulesetId ? "selected" : ""} onClick={() => setRulesetId(ruleset.id)}><strong>{ruleset.name}</strong><small>{ruleset.description}</small></button>)}</div></div>
      </aside>

      <section className="combat-area">
        <div className="combat-heading"><div><span className="eyebrow">Scripted scenario engine</span><h2>{scenario.title}</h2></div><div className="rules-badge">{activeRuleset.label}</div></div>
        <section className="scenario-studio">
          <div className="setup-tabs" aria-label="Scenario setup method">{(Object.keys(setupModeCopy) as ScenarioSetupMode[]).map((mode) => <button key={mode} type="button" className={setupMode === mode ? "active" : ""} onClick={() => setSetupMode(mode)}><strong>{setupModeCopy[mode].label}</strong><small>{setupModeCopy[mode].detail}</small></button>)}</div>
          {setupMode === "templates" ? <div className="template-grid">{[...scenarioTemplates, ...savedTemplates].map((template) => <button type="button" key={template.id} onClick={() => loadTemplate(template)}><span>{template.setup.difficulty}</span><strong>{template.name}</strong><small>{template.description}</small></button>)}</div> : <form className="scenario-builder" onSubmit={buildScenario}>
            {(setupMode === "describe" || setupMode === "combined") && <label className="prompt-field">Describe the encounter you want<input value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} placeholder="A ruined crypt where I must rescue a trapped scholar" /></label>}
            {(setupMode === "guided" || setupMode === "combined") && <div className="guided-controls">
              <label>Environment<select value={environment} onChange={(event) => setEnvironment(event.target.value as ScenarioEnvironment)}><option value="crypt">Ruined crypt</option><option value="forest">Dense forest</option><option value="market">Abandoned market</option></select></label>
              <label>Objective<select value={objective} onChange={(event) => setObjective(event.target.value as ScenarioObjective)}><option value="defeat">Defeat enemies</option><option value="rescue">Rescue a civilian</option><option value="escape">Reach the exit</option><option value="hold">Hold a position</option></select></label>
              <label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as ScenarioDifficulty)}><option value="easy">Easy</option><option value="standard">Standard</option><option value="hard">Hard</option></select></label>
            </div>}
            <div className="scenario-actions"><button className="generate-button">Build encounter</button><button type="button" className="save-button" onClick={saveTemplate}>Save setup</button></div>
          </form>}
        </section>
        <div className="scenario-summary"><div><span>Objective</span><strong>{scenario.objective}</strong></div><div><span>Terrain</span><strong>{scenario.features.join(" · ")}</strong></div><div><span>Difficulty</span><strong>{scenario.difficulty}</strong></div></div>

        <section className="tactical-map-panel">
          <div className="map-heading"><div><span className="eyebrow">5-foot square grid</span><h3>Tactical map</h3></div><div className="map-legend"><span className="legend-player">Player</span><span className="legend-enemy">Enemy</span><span className="legend-difficult">Difficult</span><span className="legend-cover">Cover</span><span className="legend-objective">Objective</span></div></div>
          <div className={`target-panel ${targetAnalysis ? "has-target" : ""}`}>
            {targetAnalysis ? <><div><span>Selected target</span><strong>{targetAnalysis.target.name}</strong><small>{targetAnalysis.target.side} · AC {effectiveArmorClass(encounter, targetAnalysis.target.id)} · {targetAnalysis.target.hitPoints.current}/{targetAnalysis.target.hitPoints.maximum} HP</small></div><div><span>Distance</span><strong>{targetAnalysis.distanceFeet} ft.</strong></div><div><span>Sightline</span><strong>{targetAnalysis.lineOfSight ? "Clear" : "Blocked"}</strong></div><div><span>Cover</span><strong>{targetAnalysis.cover === "half" ? "Half (+2 AC)" : "None"}</strong></div><button type="button" onClick={() => { setEncounter((state) => selectTarget(state, null)); setChoiceMode(null); setFeedback("Target cleared."); }}>Clear target</button></> : <div className="target-empty"><span>Step 1 · Target first</span><strong>Select another creature on the map</strong><small>ADaM will use distance and line of sight to determine which actions are legal.</small></div>}
          </div>
          <div className="map-scroll" role="region" aria-label="Tactical combat map">
            <div className="battle-grid" style={{ gridTemplateColumns: `repeat(${encounter.map.width}, 46px)` }}>
              {Array.from({ length: encounter.map.width * encounter.map.height }, (_, index) => {
                const x = index % encounter.map.width;
                const y = Math.floor(index / encounter.map.width);
                const terrain = encounter.map.terrain.find((cell) => cell.x === x && cell.y === y);
                const occupant = encounter.combatants.find((combatant) => combatant.position.x === x && combatant.position.y === y);
                const dx = Math.abs(activeCombatant.position.x - x);
                const dy = Math.abs(activeCombatant.position.y - y);
                const cost = terrain?.kind === "difficult" ? 10 : 5;
                const reachable = activeCombatant.side === "player" && Math.max(dx, dy) === 1 && terrain?.kind !== "wall" && !occupant && encounter.turn.movementRemaining >= cost;
                const coordinate = `${String.fromCharCode(65 + x)}${y + 1}`;
                const targeted = occupant?.id === encounter.selectedTargetId;
                return <button type="button" key={`${x}-${y}`} className={`grid-cell terrain-${terrain?.kind ?? "open"} ${reachable ? "reachable" : ""} ${targeted ? "targeted" : ""}`} onClick={() => handleGridInteraction(x, y, occupant?.id)} aria-pressed={targeted} aria-label={`${coordinate}. ${terrain?.label ?? "Open ground"}${occupant ? `. Occupied by ${occupant.name}. Select as target.` : ""}`} title={`${coordinate} · ${occupant ? `Select ${occupant.name}` : terrain?.label ?? "Open ground"}`}>
                  <small>{coordinate}</small>
                  {terrain && <span className="terrain-mark" aria-hidden="true">{terrain.kind === "wall" ? "■" : terrain.kind === "difficult" ? "≈" : terrain.kind === "cover" ? "◩" : "◆"}</span>}
                  {occupant && <span className={`token ${occupant.side} ${targeted ? "selected" : ""}`} title={occupant.name}>{occupant.name.slice(0, 2).toUpperCase()}</span>}
                </button>;
              })}
            </div>
          </div>
          <div className="map-help"><span>Creature token: select target</span><span>Highlighted empty square: move</span><span>Diagonal squares cost 5 ft.; difficult terrain costs 10 ft.</span></div>
        </section>

        <div className="initiative-strip"><div className="round">Round <strong>{encounter.round}</strong></div>{encounter.combatants.map((combatant, index) => <div key={combatant.id} className={`initiative-card ${index === encounter.activeIndex ? "active" : ""}`}><span>{combatant.initiative}</span><div><strong>{combatant.name}</strong><small>{combatant.side} · {combatant.hitPoints.current}/{combatant.hitPoints.maximum} HP</small></div></div>)}</div>

        <div className="turn-dashboard"><div><span>Current turn</span><strong>{activeCombatant.name}</strong></div><div><span>Action</span><strong>{encounter.turn.action ? "Ready" : "Used"}</strong></div><div><span>Bonus action</span><strong>{encounter.turn.bonusAction ? "Ready" : "Used"}</strong></div><div><span>Movement</span><strong>{encounter.turn.movementRemaining} ft.</strong></div><div><span>Reaction</span><strong>{encounter.turn.reaction ? "Ready" : "Used"}</strong></div></div>

        <section className="state-tray" aria-label="Character resources and temporary effects">
          <div className="resource-tracker"><div><span className="eyebrow">Combat resources</span><h3>Uses remaining</h3></div><div className="resource-pills">{playerCombatant.resources.length ? playerCombatant.resources.map((resource) => <div key={resource.id}><span>{resource.kind === "spell-slot" ? `Level ${resource.level} slots` : resource.name}</span><strong>{resource.current}/{resource.maximum}</strong></div>) : <p>No tracked resources imported.</p>}</div></div>
          <div className="effect-tracker"><div><span className="eyebrow">Derived statistics</span><h3>Active effects</h3></div><div className="effect-pills">{playerEffects.length ? playerEffects.map((effect) => { const remaining = remainingEffectRounds(encounter, effect); return <div key={effect.id}><span>{effect.concentration ? "Concentration" : remaining === 1 ? "Until next turn" : remaining === null ? "Ongoing" : `${remaining} rounds`}</span><strong>{effect.name}</strong><small>{effect.description}</small></div>; }) : <p>Base statistics only; no temporary modifiers are active.</p>}</div></div>
        </section>

        <section className="action-console">
          <div className="console-heading"><div><span className="eyebrow">{modeCopy[experienceMode].label} mode</span><h3>{targetAnalysis ? `Actions against ${targetAnalysis.target.name}` : "Choose your action"}</h3></div>{lastRoll && <div className="mini-roll"><span>Last roll</span><strong>{lastRoll.total}</strong></div>}</div>
          <div className="action-category-tabs" aria-label="Action economy categories">{actionCategoryCopy.map((category) => {
            const actions = visibleActions.filter((action) => action.cost === category.id);
            const legalCount = actions.filter((action) => validateAction(action, encounter, character).legal).length;
            return <button type="button" key={category.id} className={actionCategory === category.id ? "active" : ""} onClick={() => setActionCategory(category.id)}><span>{category.label}</span><strong>{legalCount}</strong><small>{category.detail}</small></button>;
          })}</div>
          <div className="action-grid">{categorizedActions.length ? categorizedActions.map((action) => {
            const validation = validateAction(action, encounter, character);
            const targetingLabel = action.targeting?.mode === "single" ? `${action.targeting.rangeFeet} ft.` : action.targeting?.mode === "area" ? `${action.targeting.shape} · ${action.targeting.sizeFeet} ft.` : action.cost.replace("-", " ");
            return <button key={action.id} className={!validation.legal ? "illegal" : ""} onClick={() => runAction(action)} title={experienceMode === "training" ? (validation.legal ? action.description : validation.reason) : undefined}><strong>{action.name}</strong><span>{targetingLabel}</span>{experienceMode !== "advanced" && <small>{validation.legal || experienceMode === "beginner" ? action.description : validation.reason}</small>}</button>;
          }) : <div className="category-empty"><strong>No actions available</strong><p>Your imported sheet and current turn state do not provide an option in this category.</p></div>}</div>
          {choiceMode === "attack" && <div className="choice-panel"><div className="choice-heading"><div><span>{targetAnalysis ? "Step 2 · Choose attack" : "Weapons ready · Target required"}</span><strong>Weapon and attack options</strong></div><button type="button" onClick={() => setChoiceMode(null)}>Cancel</button></div><div className="choice-grid">{(character.attacks ?? []).map((attack) => { const validation = validateAttackChoice(encounter, attack); const longRange = validation.legal && validation.rollMode === "disadvantage"; return <button type="button" key={attack.id} className={!validation.legal ? "illegal" : longRange ? "warning" : ""} onClick={() => chooseAttack(attack)}><span>{attack.kind} · {attack.normalRangeFeet}{attack.longRangeFeet ? `/${attack.longRangeFeet}` : ""} ft.</span><strong>{attack.name}</strong><small>{attack.damage} · {attack.attackBonus >= 0 ? "+" : ""}{attack.attackBonus} to hit</small><p>{longRange ? "Long range: roll with disadvantage." : validation.legal ? attack.description : validation.reason}</p></button>; })}</div></div>}
          {choiceMode === "spell" && <div className="choice-panel"><div className="choice-heading"><div><span>Step 2 · Choose spell</span><strong>Spellbook and slot costs</strong></div><button type="button" onClick={() => setChoiceMode(null)}>Cancel</button></div><div className="choice-grid">{(character.spells ?? []).length ? (character.spells ?? []).map((spell) => { const validation = validateSpellChoice(encounter, spell); return <button type="button" key={spell.id} className={!validation.legal ? "illegal" : ""} onClick={() => chooseSpell(spell)}><span>{spell.level === 0 ? "Cantrip · free" : `Level ${spell.level} · 1 slot`}</span><strong>{spell.name}</strong><small>{spell.target === "self" ? "Self" : `${spell.rangeFeet} ft.`}{spell.concentration ? " · concentration" : ""}</small><p>{validation.legal ? spell.damage ?? spell.effect?.description ?? "Spell ready." : validation.reason}</p></button>; }) : <div className="category-empty"><strong>No spells imported</strong><p>This character sheet does not contain spell choices yet.</p></div>}</div></div>}
          <div className="area-effect-note"><span>Area-effect foundation</span><p>Future actions can define cones, cubes, cylinders, lines, spheres, or emanations and specify whether they affect every creature, only hostiles, or chosen creatures.</p></div>
          <div className="turn-controls"><div><span>Turn control</span><p>End the current combatant&apos;s turn and advance initiative.</p></div><button type="button" onClick={() => runAction(actionCatalog.find((action) => action.id === "end-turn")!)}>End turn</button></div>
          <form className="command-bar" onSubmit={submitCommand}><label htmlFor="command">Or describe your action</label><div><input id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Example: I cast a spell at the scout" /><button>Submit</button></div></form>
          <div className="feedback" aria-live="polite"><span>ADaM</span><p>{feedback}</p></div>
        </section>

        <section className="encounter-log"><div><span className="eyebrow">Combat log</span><h3>Encounter state</h3></div><ol>{encounter.log.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol></section>
      </section>
    </section>
  </main>;
}
