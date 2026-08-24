"use client";
import { ChangeEvent, useMemo, useState } from "react";
import { Character } from "../src/domain/character";
import { RollMode, rollD20 } from "../src/engine/dice";
import { importCharacterFile } from "../src/importers";
import { rulesets } from "../src/rulesets";

const sample: Character = { id:"sample", name:"Hinnom", className:"Sorcerer", level:8, armorClass:16, hitPoints:{current:58,maximum:58}, proficiencyBonus:3, abilities:{strength:8,dexterity:14,constitution:16,intelligence:12,wisdom:10,charisma:18}, resources:[], source:{format:"sample",importedAt:new Date().toISOString()} };

export default function Home() {
  const [character,setCharacter]=useState(sample), [rulesetId,setRulesetId]=useState("dnd-2024"), [mode,setMode]=useState<RollMode>("normal"), [modifier,setModifier]=useState(0);
  const [result,setResult]=useState<ReturnType<typeof rollD20>|null>(null), [message,setMessage]=useState("Load a fillable PDF or ADaM JSON file.");
  const active=useMemo(()=>rulesets.find(r=>r.id===rulesetId)!,[rulesetId]);
  async function handleImport(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];if(!file)return;try{const imported=await importCharacterFile(file);setCharacter(imported.character);setMessage(`${imported.character.name} imported from ${imported.format.toUpperCase()}. ${imported.warnings.join(" ")||"Ready for combat."}`)}catch(e){setMessage(e instanceof Error?e.message:"The sheet could not be imported.")}finally{event.target.value=""}}
  return <main className="app-shell">
    <header className="topbar"><div><span className="eyebrow">ADaM · Automated Dungeon & Mechanics</span><h1>Combat Trainer</h1></div><div className="status"><span/>Local session</div></header>
    <section className="workspace">
      <aside className="sidebar">
        <div className="panel"><div className="panel-heading"><span>01</span><h2>Character</h2></div><label className="file-button">Import character sheet<input type="file" accept="application/pdf,application/json,.json,.pdf" onChange={handleImport}/></label><p className="helper">{message}</p></div>
        <div className="character-card"><div className="portrait">{character.name[0]?.toUpperCase()}</div><div><p className="character-name">{character.name}</p><p>{character.className} · Level {character.level}</p></div></div>
        <div className="stats"><div><span>AC</span><strong>{character.armorClass}</strong></div><div><span>HP</span><strong>{character.hitPoints.current}/{character.hitPoints.maximum}</strong></div><div><span>PROF</span><strong>+{character.proficiencyBonus}</strong></div></div>
        <div className="panel"><div className="panel-heading"><span>02</span><h2>Ruleset</h2></div><div className="ruleset-list">{rulesets.map(r=><button key={r.id} className={r.id===rulesetId?"selected":""} onClick={()=>setRulesetId(r.id)}><strong>{r.name}</strong><small>{r.description}</small></button>)}</div></div>
      </aside>
      <section className="combat-area">
        <div className="combat-heading"><div><span className="eyebrow">Training console</span><h2>Make a d20 roll</h2></div><div className="rules-badge">{active.label}</div></div>
        <div className="roll-card"><div className="mode-control" role="group" aria-label="Roll mode">{(["disadvantage","normal","advantage"] as RollMode[]).map(o=><button key={o} className={mode===o?"active":""} onClick={()=>setMode(o)}>{o}</button>)}</div><label className="modifier-control">Modifier<div><button onClick={()=>setModifier(v=>v-1)}>−</button><strong>{modifier>=0?`+${modifier}`:modifier}</strong><button onClick={()=>setModifier(v=>v+1)}>+</button></div></label><button className="roll-button" onClick={()=>setResult(rollD20({mode,modifier}))}>Roll d20</button></div>
        <div className="result-panel" aria-live="polite">{result?<><span className="eyebrow">Latest result</span><div className="result-score">{result.total}</div><p>Dice: {result.rolls.join(" & ")} · Kept {result.kept} · Modifier {result.modifier>=0?`+${result.modifier}`:result.modifier}</p><div className={`outcome ${result.natural===20?"critical":""}`}>{result.natural===20?"Natural 20":result.natural===1?"Natural 1":`${result.mode} roll`}</div></>:<div className="empty-result"><div className="die">20</div><h3>Ready when you are</h3><p>Select a roll state, set the modifier, and roll.</p></div>}</div>
        <div className="foundation-grid"><article><span>Rules</span><h3>Version-aware mechanics</h3><p>2014 and 2024 rules are registered independently.</p></article><article><span>Imports</span><h3>Adapter-based sheets</h3><p>PDF and JSON normalize into one stable character model.</p></article><article><span>Engine</span><h3>Testable dice logic</h3><p>Roll behavior stays separate from the interface.</p></article></div>
      </section>
    </section>
  </main>;
}
