"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { Character } from "../src/domain/character";
import type { CombatAction, ExperienceMode } from "../src/domain/combat";
import { actionCatalog, availableActions, consumeAction, findActionFromText, validateAction } from "../src/engine/actions";
import { createEncounter, endTurn } from "../src/engine/encounter";
import { moveActiveCombatant } from "../src/engine/movement";
import { analyzeTarget, selectTarget } from "../src/engine/targeting";
import { rollD20 } from "../src/engine/dice";
import { importCharacterFile } from "../src/importers";
import { rulesets, type RulesetId } from "../src/rulesets";
import { defaultScenarioSetup, generateScriptedScenario, scenarioTemplates } from "../src/scenarios/scripted-generator";
import type { ScenarioDifficulty, ScenarioEnvironment, ScenarioObjective, ScenarioSetup, ScenarioTemplate } from "../src/scenarios/types";

type ScenarioSetupMode = "describe" | "guided" | "combined" | "templates";

const setupModeCopy: Record<ScenarioSetupMode, { label: string; detail: string }> = {
  describe: { label: "Describe", detail: "Write the encounter in your own words." },
  guided: { label: "Guided", detail: "Choose environment, objective, and difficulty." },
  combined: { label: "Combined", detail: "Use controls, then add custom details." },
  templates: { label: "Templates", detail: "Start from a saved scenario setup." },
};

const sample: Character = {
  id: "sample-hinnom", name: "Hinnom", className: "Sorcerer", level: 4, armorClass: 15,
  hitPoints: { current: 34, maximum: 34 }, proficiencyBonus: 2,
  abilities: { strength: 8, dexterity: 12, constitution: 16, intelligence: 10, wisdom: 13, charisma: 18 },
  resources: [{ name: "Sorcery Points", current: 4, maximum: 4 }],
  actions: ["Attack", "Magic", "Cast a Spell", "Dash", "Disengage", "Dodge", "Help", "Hide", "Ready", "Search", "Utilize", "Use an Object", "Study", "Influence", "Quickened Spell"],
  source: { format: "sample", importedAt: new Date().toISOString() },
};

const modeCopy: Record<ExperienceMode, { label: string; detail: string }> = {
  beginner: { label: "Beginner", detail: "Only currently legal character actions are shown." },
  training: { label: "Training", detail: "All actions are shown; illegal choices explain why." },
  advanced: { label: "Advanced", detail: "All actions remain available; illegal choices are simply disallowed." },
};

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

  const activeRuleset = rulesets.find((ruleset) => ruleset.id === rulesetId)!;
  const sheetActions = useMemo(() => availableActions(character, rulesetId), [character, rulesetId]);
  const visibleActions = useMemo(() => {
    const rulesetActions = actionCatalog.filter((action) => action.rulesets.includes(rulesetId));
    if (experienceMode !== "beginner") return rulesetActions;
    return sheetActions.filter((action) => validateAction(action, encounter).legal);
  }, [encounter, experienceMode, rulesetId, sheetActions]);
  const activeCombatant = encounter.combatants[encounter.activeIndex];
  const targetAnalysis = useMemo(() => encounter.selectedTargetId ? analyzeTarget(encounter, encounter.selectedTargetId) : null, [encounter]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("adam-scenario-templates");
      if (stored) setSavedTemplates(JSON.parse(stored) as ScenarioTemplate[]);
    } catch {
      setSavedTemplates([]);
    }
  }, []);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const imported = await importCharacterFile(file);
      setCharacter(imported.character); setEncounter(createEncounter(imported.character, scenario));
      setMessage(`${imported.character.name} imported. ${imported.warnings.join(" ") || "Ready for combat."}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The sheet could not be imported."); }
    finally { event.target.value = ""; }
  }

  function runAction(action: CombatAction) {
    if (action.id === "end-turn") { setEncounter((state) => endTurn(state)); setFeedback("Turn ended. Initiative advanced."); return; }
    const validation = validateAction(action, encounter);
    if (!validation.legal) {
      setFeedback(experienceMode === "training" ? validation.reason ?? "That action is not currently legal." : "Action disallowed."); return;
    }
    if (action.id === "move") { setFeedback("Choose a highlighted adjacent square on the tactical map. Difficult terrain costs 10 feet."); return; }
    setEncounter((state) => consumeAction(action, state));
    const roll = rollD20({ mode: "normal", modifier: character.proficiencyBonus }); setLastRoll(roll);
    const targetCopy = action.requiresTarget && targetAnalysis ? ` against ${targetAnalysis.target.name}` : "";
    setFeedback(`${action.name}${targetCopy} accepted. Resolution roll: ${roll.total} (${roll.kept} + ${roll.modifier}).`);
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
        <div className="stats"><div><span>AC</span><strong>{character.armorClass}</strong></div><div><span>HP</span><strong>{character.hitPoints.current}/{character.hitPoints.maximum}</strong></div><div><span>PROF</span><strong>+{character.proficiencyBonus}</strong></div></div>
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
            {targetAnalysis ? <><div><span>Selected target</span><strong>{targetAnalysis.target.name}</strong><small>{targetAnalysis.target.side} · AC {targetAnalysis.target.armorClass} · {targetAnalysis.target.hitPoints.current}/{targetAnalysis.target.hitPoints.maximum} HP</small></div><div><span>Distance</span><strong>{targetAnalysis.distanceFeet} ft.</strong></div><div><span>Sightline</span><strong>{targetAnalysis.lineOfSight ? "Clear" : "Blocked"}</strong></div><div><span>Cover</span><strong>{targetAnalysis.cover === "half" ? "Half (+2 AC)" : "None"}</strong></div><button type="button" onClick={() => { setEncounter((state) => selectTarget(state, null)); setFeedback("Target cleared."); }}>Clear target</button></> : <div className="target-empty"><span>Step 1 · Target first</span><strong>Select another creature on the map</strong><small>ADaM will use distance and line of sight to determine which actions are legal.</small></div>}
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

        <section className="action-console">
          <div className="console-heading"><div><span className="eyebrow">{modeCopy[experienceMode].label} mode</span><h3>{targetAnalysis ? `Actions against ${targetAnalysis.target.name}` : "Choose your action"}</h3></div>{lastRoll && <div className="mini-roll"><span>Last roll</span><strong>{lastRoll.total}</strong></div>}</div>
          <div className="action-grid">{visibleActions.map((action) => { const validation = validateAction(action, encounter); return <button key={action.id} className={!validation.legal ? "illegal" : ""} onClick={() => runAction(action)} title={experienceMode === "training" ? (validation.legal ? action.description : validation.reason) : undefined}><strong>{action.name}</strong><span>{action.cost.replace("-", " ")}</span>{experienceMode !== "advanced" && <small>{action.description}</small>}</button>; })}</div>
          <form className="command-bar" onSubmit={submitCommand}><label htmlFor="command">Or describe your action</label><div><input id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Example: I cast a spell at the scout" /><button>Submit</button></div></form>
          <div className="feedback" aria-live="polite"><span>ADaM</span><p>{feedback}</p></div>
        </section>

        <section className="encounter-log"><div><span className="eyebrow">Combat log</span><h3>Encounter state</h3></div><ol>{encounter.log.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol></section>
      </section>
    </section>
  </main>;
}
