"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import type { Character } from "../src/domain/character";
import type { CombatAction, ExperienceMode } from "../src/domain/combat";
import { actionCatalog, availableActions, consumeAction, findActionFromText, validateAction } from "../src/engine/actions";
import { createEncounter, endTurn } from "../src/engine/encounter";
import { rollD20 } from "../src/engine/dice";
import { importCharacterFile } from "../src/importers";
import { rulesets, type RulesetId } from "../src/rulesets";
import { generateScriptedScenario } from "../src/scenarios/scripted-generator";

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
  const [scenarioPrompt, setScenarioPrompt] = useState("A ruined crypt where I must rescue a trapped scholar");
  const [scenario, setScenario] = useState(() => generateScriptedScenario("ruined crypt rescue"));
  const [encounter, setEncounter] = useState(() => createEncounter(sample));
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

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const imported = await importCharacterFile(file);
      setCharacter(imported.character); setEncounter(createEncounter(imported.character));
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
    setEncounter((state) => consumeAction(action, state));
    const roll = rollD20({ mode: "normal", modifier: character.proficiencyBonus }); setLastRoll(roll);
    setFeedback(`${action.name} accepted. Resolution roll: ${roll.total} (${roll.kept} + ${roll.modifier}).`);
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const action = findActionFromText(command, rulesetId);
    if (!action) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : "I could not match that request to a supported action yet. Try naming the action directly."); return; }
    runAction(action); setCommand("");
  }

  function buildScenario(event: FormEvent) {
    event.preventDefault(); const next = generateScriptedScenario(scenarioPrompt);
    setScenario(next); setEncounter(createEncounter(character)); setFeedback(next.opening);
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
        <form className="scenario-builder" onSubmit={buildScenario}><label>Describe the encounter you want<input value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} /></label><button>Generate scenario</button></form>
        <div className="scenario-summary"><div><span>Objective</span><strong>{scenario.objective}</strong></div><div><span>Terrain</span><strong>{scenario.features.join(" · ")}</strong></div></div>

        <div className="initiative-strip"><div className="round">Round <strong>{encounter.round}</strong></div>{encounter.combatants.map((combatant, index) => <div key={combatant.id} className={`initiative-card ${index === encounter.activeIndex ? "active" : ""}`}><span>{combatant.initiative}</span><div><strong>{combatant.name}</strong><small>{combatant.side} · {combatant.hitPoints.current}/{combatant.hitPoints.maximum} HP</small></div></div>)}</div>

        <div className="turn-dashboard"><div><span>Current turn</span><strong>{activeCombatant.name}</strong></div><div><span>Action</span><strong>{encounter.turn.action ? "Ready" : "Used"}</strong></div><div><span>Bonus action</span><strong>{encounter.turn.bonusAction ? "Ready" : "Used"}</strong></div><div><span>Movement</span><strong>{encounter.turn.movementRemaining} ft.</strong></div><div><span>Reaction</span><strong>{encounter.turn.reaction ? "Ready" : "Used"}</strong></div></div>

        <section className="action-console">
          <div className="console-heading"><div><span className="eyebrow">{modeCopy[experienceMode].label} mode</span><h3>Choose your action</h3></div>{lastRoll && <div className="mini-roll"><span>Last roll</span><strong>{lastRoll.total}</strong></div>}</div>
          <div className="action-grid">{visibleActions.map((action) => { const validation = validateAction(action, encounter); return <button key={action.id} className={!validation.legal ? "illegal" : ""} onClick={() => runAction(action)} title={experienceMode === "training" ? (validation.legal ? action.description : validation.reason) : undefined}><strong>{action.name}</strong><span>{action.cost.replace("-", " ")}</span>{experienceMode !== "advanced" && <small>{action.description}</small>}</button>; })}</div>
          <form className="command-bar" onSubmit={submitCommand}><label htmlFor="command">Or describe your action</label><div><input id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Example: I cast a spell at the scout" /><button>Submit</button></div></form>
          <div className="feedback" aria-live="polite"><span>ADaM</span><p>{feedback}</p></div>
        </section>

        <section className="encounter-log"><div><span className="eyebrow">Combat log</span><h3>Encounter state</h3></div><ol>{encounter.log.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol></section>
      </section>
    </section>
  </main>;
}
