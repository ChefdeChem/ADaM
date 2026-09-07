import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source, goliathBarbarian } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter, playableCharacter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { legalMovementDestinations, moveActiveCombatant } from '../src/engine/movement.ts';
import { completeSurinaRest } from '../src/engine/rests.ts';
import { executeFeatureAction, resumeAreaDamage } from '../src/engine/feature-actions.ts';
import { areaTargets } from '../src/engine/areas.ts';
import { applyEffect, automaticallyFailsSave, outgoingAttackRollMode } from '../src/engine/effects.ts';
import { resolveAttackRoll, resolveAttackDamage } from '../src/engine/combat-options.ts';
import { actionCatalog, consumeAction } from '../src/engine/actions.ts';
import { executeSkillAction } from '../src/engine/skill-actions.ts';
import { endTurn, rollPlayerAndEnemyInitiative } from '../src/engine/encounter.ts';
import { combatOutcome, resolveEnemyTurn } from '../src/engine/enemy-turns.ts';
import { resolveDamageReductionReaction, resolveSavingThrowResponse, resolveAttackReaction, chooseOpportunityAttack } from '../src/engine/responses.ts';
const scenario=generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'});
const profile=playableCharacter(source).character;
const feature=name=>profile.featureActions.find(f=>f.id.includes(name));
function ready(){const e=createPlayableEncounter(source,scenario);return {...e,map:{...e.map,terrain:[]},selectedTargetId:e.combatants[1].id,combatants:e.combatants.map((c,i)=>({...c,position:{x:1+i,y:1},initiativeRolled:true}))};}
function victory(){const e=ready();return {...e,combatants:e.combatants.map((c,i)=>({...c,hitPoints:{...c.hitPoints,current:i?0:3}}))};}
const current=e=>e.combatants.find(c=>c.id===source.id);
test('Short Rest spends the level-one Hit Die, caps healing, and preserves long-rest resources',()=>{
 let e=victory();e.combatants[0].resources=e.combatants[0].resources.map(r=>({...r,current:0}));
 const r=completeSurinaRest(e,source,'short-rest',true,()=>0.4);
 assert.equal(r.legal,true);assert.equal(current(r.encounter).hitPoints.current,9);
 assert.equal(r.encounter.recoveryState.hitDiceRemaining,0);
 assert.equal(current(r.encounter).resources.find(r=>/Breath/.test(r.name)).current,1);
 assert.equal(current(r.encounter).resources.find(r=>/Lay/.test(r.name)).current,0);
 assert.equal(completeSurinaRest(r.encounter,source,'short-rest',true).legal,false);
});
test('Long Rest heals, restores Hit Dice and source pools, expires effects, and waits before repeat rest',()=>{
 let e=applyEffect(victory(),{name:'Temporary condition',description:'test',sourceCombatantId:source.id,targetCombatantId:source.id,conditionGranted:'Poisoned',durationRounds:10});
 e.combatants[0].temporaryHitPoints=4;
 const r=completeSurinaRest(e,source,'long-rest');assert.equal(r.legal,true);
 assert.equal(current(r.encounter).hitPoints.current,11);assert.equal(current(r.encounter).temporaryHitPoints,0);
 assert.equal(current(r.encounter).conditions.includes('Poisoned'),false);
 assert.equal(r.encounter.recoveryState.hitDiceRemaining,1);
 const again=completeSurinaRest(r.encounter,source,'long-rest');assert.equal(again.encounter.recoveryState.elapsedMinutes,1920);
});
test('Rest rejects live hostiles, zero HP, pending responses and recurring damage',()=>{
 assert.equal(completeSurinaRest(ready(),source,'long-rest').legal,false);
 const e=victory();e.combatants[0].hitPoints.current=0;
 assert.equal(completeSurinaRest(e,source,'long-rest').legal,false);
 const pending={...victory(),pendingResponse:{type:'concentration-check'}};
 assert.equal(completeSurinaRest(pending,source,'long-rest').legal,false);
 const damage=applyEffect(victory(),{name:'Burning',description:'test',sourceCombatantId:source.id,targetCombatantId:source.id,turnStartDamage:{damage:'1d6 fire'}});
 assert.equal(completeSurinaRest(damage,source,'long-rest').legal,false);
});
test('Breath preserves source records and resources while offering current damage and shapes',()=>{
 const original=source.featureActions.find(f=>f.id==='breath-weapon-gold');
 assert.equal(original.resolution.damage,'2d6 fire');assert.equal(feature('breath').resolution.damage,'1d10 fire');
 const e=ready();const line={...feature('breath'),resolution:{...feature('breath').resolution,area:{...feature('breath').resolution.area,shape:'line',sizeFeet:30}}};
 e.combatants.push({...e.combatants[1],id:'off-line',position:{x:3,y:2}});
 assert.equal(areaTargets(e,source.id,e.selectedTargetId,line.resolution.area).some(c=>c.id==='off-line'),false);
 const r=executeFeatureAction(e,line,{random:()=>0.4});assert.equal(r.legal,true);assert.equal(r.roll.total,5);
 assert.equal(r.encounter.turn.action,false);assert.equal(r.encounter.turn.bonusAction,true);
 assert.equal(current(r.encounter).resources.find(r=>/Breath/.test(r.name)).current,0);
 assert.equal(executeFeatureAction(r.encounter,line).legal,false);
});
test('Area damage serializes defensive choices and applies later targets exactly once',()=>{
 const e=ready();const ally=createPlayableEncounter(goliathBarbarian,scenario).combatants[0];
 e.combatants=[e.combatants[0],{...ally,position:{x:2,y:1}}, {...e.combatants[1],position:{x:3,y:1}}];
 e.selectedTargetId=e.combatants[2].id;const hp=e.combatants[2].hitPoints.current;
 const r=executeFeatureAction(e,feature('breath'),{random:()=>0.4});assert.equal(r.legal,true);
 assert.equal(r.encounter.pendingResponse.type,'damage-reduction-reaction');assert.equal(r.encounter.combatants[2].hitPoints.current,hp);
 const resumed=resumeAreaDamage(resolveDamageReductionReaction(r.encounter,false).encounter);
 assert.ok(resumed.combatants[2].hitPoints.current<hp);assert.equal(resumed.pendingAreaDamage.length,0);
 assert.deepEqual(resumeAreaDamage(resumed),resumed);
});
test('Prone allows crawling and Stand Up costs half Speed; paralysis affects saves and nearby hits',()=>{
 let e=ready();e.combatants[0].conditions=['Prone'];
 e=consumeAction(actionCatalog.find(a=>a.id==='stand-up'),e);
 assert.equal(e.turn.movementRemaining,15);assert.equal(current(e).conditions.length,0);
 e.combatants[1].conditions=['Paralyzed'];
 assert.equal(automaticallyFailsSave(e,e.combatants[1].id,'dexterity'),true);
 assert.equal(automaticallyFailsSave(e,e.combatants[1].id,'wisdom'),false);
 const attack=resolveAttackRoll(e,e.combatants[0].attacks[0],()=>0.8);
 assert.equal(attack.hit,true);assert.equal(attack.critical,true);
 e.combatants[1].position.x=3;
 assert.equal(resolveAttackRoll(e,e.combatants[0].attacks[0],()=>0.8).critical,false);
 assert.equal(outgoingAttackRollMode(e,source.id,e.combatants[1].id),'advantage');
});
test('Search and Study use sheet modifiers, spend Action, and do not invent narrative success',()=>{
 const r=executeSkillAction(ready(),'study','history',()=>0.5);
 assert.equal(r.legal,true);assert.equal(r.roll.total,14);assert.equal(r.encounter.turn.action,false);
 assert.match(r.summary,/scenario or DM/);
 assert.equal(executeSkillAction(r.encounter,'study','history').legal,false);
 assert.equal(executeSkillAction(ready(),'search','athletics').legal,false);
});
test('Complete Surina encounter: initiative, enemy attacks, healing, breath, weapon victory, both rests and next encounter',()=>{
 const snapshot=JSON.stringify(source);
 let e=ready();let initiativeCalls=0;
 e=rollPlayerAndEnemyInitiative(e,source.id,()=>initiativeCalls++===0?0.95:0.1).encounter;
 let playerTurns=0, enemyTurns=0, healed=false, breathed=false, weaponHits=0;
 for(let steps=0;steps<60&&combatOutcome(e)==='active';steps++){
  const active=e.combatants[e.activeIndex];
  if(active.side==='player'){
   playerTurns++;
   e={...e,selectedTargetId:e.combatants.find(c=>c.side==='enemy'&&c.hitPoints.current>0)?.id};
   const target=e.combatants.find(c=>c.id===e.selectedTargetId);
   if(playerTurns>1){const cells=legalMovementDestinations(e).sort((a,b)=>Math.max(Math.abs(a.x-target.position.x),Math.abs(a.y-target.position.y))-Math.max(Math.abs(b.x-target.position.x),Math.abs(b.y-target.position.y))||a.cost-b.cost);if(cells[0]){const moved=moveActiveCombatant(e,cells[0].x,cells[0].y,()=>0.01);assert.equal(moved.legal,true);e=moved.encounter;}}
   if(playerTurns===1){const sense=executeFeatureAction(e,feature('divine-sense'));assert.equal(sense.legal,true);e=sense.encounter;}
   if(current(e).hitPoints.current<11&&!healed){const healing=executeFeatureAction(e,feature('lay-on-hands'),{resourceAmount:Math.min(5,11-current(e).hitPoints.current)});assert.equal(healing.legal,true);e=healing.encounter;healed=true;}
   if(playerTurns===1){e=executeSkillAction(e,'search','perception',()=>0.5).encounter;}
   else if(!breathed){const r=executeFeatureAction(e,feature('breath'),{random:()=>0.4});assert.equal(r.legal,true);e=r.encounter;breathed=true;}
   else {const attack=current(e).attacks.find(a=>a.id==='glaive');const r=resolveAttackRoll(e,attack,()=>0.9);assert.equal(r.legal,true,r.reason);e=r.encounter;if(r.hit){const d=resolveAttackDamage(e,attack,e.selectedTargetId,r.critical,()=>0.9);assert.equal(d.legal,true);e=d.encounter;weaponHits++;}}
  }else{
   const r=resolveEnemyTurn(e,()=>enemyTurns++===0?0.7:0.01);e=r.encounter;
   while(e.pendingResponse){if(e.pendingResponse.type==='attack-reaction')e=resolveAttackReaction(e,null,()=>0.01).encounter;else if(e.pendingResponse.type==='saving-throw')e=resolveSavingThrowResponse(e,()=>0.5).encounter;else if(e.pendingResponse.type==='opportunity-attack'){e=chooseOpportunityAttack(e,null).encounter;e=resolveEnemyTurn(e,()=>enemyTurns++===0?0.7:0.01).encounter;}else assert.fail(e.pendingResponse.type);}
  }
  if(combatOutcome(e)==='active')e=endTurn(e);
 }
 assert.equal(combatOutcome(e),'victory');assert.equal(healed,true);assert.equal(breathed,true);assert.ok(weaponHits>0);assert.ok(enemyTurns>0);
 const short=completeSurinaRest(e,source,'short-rest',true,()=>0.5);assert.equal(short.legal,true);
 const long=completeSurinaRest(short.encounter,source,'long-rest');assert.equal(long.legal,true);
 const p=current(long.encounter),carried={...source,hitPoints:{...p.hitPoints},resources:p.resources,recoveryState:long.encounter.recoveryState,inventoryRemaining:Object.fromEntries(p.inventory.map(i=>[i.id,i.current]))};
 const next=createPlayableEncounter(carried,scenario);assert.equal(current(next).hitPoints.current,11);assert.equal(next.recoveryState.hitDiceRemaining,1);
 assert.equal(current(next).resources.find(r=>/Breath/.test(r.name)).maximum,1);assert.equal(current(next).spells.length,0);
 assert.equal(JSON.stringify(source),snapshot);
});

test('Dodge applies to the actual player saving-throw prompt, not only the modifier helper',()=>{
 let e=consumeAction(actionCatalog.find(a=>a.id==='dodge'),ready());
 e={...e,pendingResponse:{type:'saving-throw',sourceCombatantId:e.combatants[1].id,targetCombatantId:source.id,ability:{name:'Training flame',saveAbility:'dexterity',saveDc:12,damage:'1d6 fire',damageOnSuccess:'half'}}};
 const r=resolveSavingThrowResponse(e,()=>0.5);
 assert.equal(r.playerRoll.mode,'advantage');assert.equal(r.playerRoll.rolls.length,2);
});
test('Spent carried inventory persists without rewriting the imported equipment record',()=>{
 const saved={...source,inventoryRemaining:{javelin:2}};
 const next=createPlayableEncounter(saved,scenario);
 assert.equal(current(next).inventory.find(i=>i.id==='javelin').current,2);
 assert.equal(source.profile.equipment.find(i=>i.name==='Javelin').quantity,5);
});
