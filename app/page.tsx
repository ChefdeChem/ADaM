"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { Character, CharacterAttack, CharacterSpell } from "../src/domain/character";
import type { ActionCost, CombatAction, ExperienceMode } from "../src/domain/combat";
import { actionCatalog, availableActions, consumeAction, findActionFromText, validateAction } from "../src/engine/actions";
import { executeAttackChoice, executeSpellChoice, validateAttackChoice, validateSpellChoice } from "../src/engine/combat-options";
import { applyEffect, effectiveArmorClass, effectsForCombatant, remainingEffectRounds } from "../src/engine/effects";
import { createEncounter, endTurn } from "../src/engine/encounter";
import { moveActiveCombatant } from "../src/engine/movement";
import { analyzeTarget, selectTarget } from "../src/engine/targeting";
import { rollD20 } from "../src/engine/dice";
import { importCharacterFile } from "../src/importers";
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
  const [message, setMessage] = useState("Using the built-in sample character. Import a fillable PDF or ADaM JSON anytime.");
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
  const sheetActions = useMemo(() => availableActions(character, rulesetId), [character, rulesetId]);
  const visibleActions = useMemo(() => {
    const rulesetActions = actionCatalog.filter((action) => action.rulesets.includes(rulesetId));
    if (experienceMode !== "beginner") return rulesetActions;
    return sheetActions.filter((action) => validateAction(action, encounter, character).legal);
  }, [character, encounter, experienceMode, rulesetId, sheetActions]);
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
    try {
      const imported = await importCharacterFile(file);
      const normalized = withCombatDefaults(imported.character);
      setCharacter(normalized); setEncounter(createEncounter(normalized, scenario));
      setChoiceMode(null);
      setMessage(`${normalized.name} imported. ${imported.warnings.join(" ") || "Ready for combat."}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The sheet could not be imported."); }
    finally { event.target.value = ""; }
  }

  function runAction(action: CombatAction) {
    if (action.id === "end-turn") { setEncounter((state) => endTurn(state)); setChoiceMode(null); setFeedback("Turn ended. Initiative advanced."); return; }
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
    <section className="workspace">
      <aside className="sidebar">
        <div className="panel"><div className="panel-heading"><span>01</span><h2>Character</h2></div><label className="file-button">Import character sheet<input type="file" accept="application/pdf,application/json,.json,.pdf" onChange={handleImport} /></label><p className="helper">{message}</p></div>
        <div className="character-card"><div className="portrait">{character.name[0]?.toUpperCase()}</div><div><p className="character-name">{character.name}</p><p>{character.className} · Level {character.level}</p></div></div>
        <div className="stats"><div><span>AC</span><strong>{playerArmorClass}</strong>{playerArmorClass !== character.armorClass && <small>base {character.armorClass}</small>}</div><div><span>HP</span><strong>{playerCombatant.hitPoints.current}/{playerCombatant.hitPoints.maximum}</strong>{playerCombatant.temporaryHitPoints > 0 && <small>+{playerCombatant.temporaryHitPoints} temp</small>}</div><div><span>PROF</span><strong>+{character.proficiencyBonus}</strong></div></div>
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
        <div className="scenario-summary"><div><span>Objective</span><strong>{scenario.objective}</strong></div><div><span>Terrain</span><strong>{scenario.features.join(" · ")}</strong></div><div><span>Difficulty</span><stro