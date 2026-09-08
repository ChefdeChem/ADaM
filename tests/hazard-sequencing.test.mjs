import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source, pharos, goliathBarbarian } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { applyEffect } from '../src/engine/effects.ts';
import { resolveEnemyTurn } from '../src/engine/enemy-turns.ts';
import { resolvePointHazardsForCombatant, resumePointHazards, resolvePointHazardResponse } from '../src/engine/point-effects.ts';
import { resolveConcentrationResponse, chooseOpportunityAttack, resolveZeroHitPointReplacement, resolveDamageReductionReaction } from '../src/engine/responses.ts';
import { endTurn } from '../src/engine/encounter.ts';
import { handleWeapon } from '../src/engine/weapon-hands.ts';

function state() {
 const e=createPlayableEncounter(source,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));
 e.combatants=e.combatants.slice(0,2).map((c,i)=>({...c,position:{x:i?5:1,y:1},hitPoints:{...c.hitPoints,current:30,maximum:30}}));
 e.map.height=3;e.map.terrain=Array.from({length:e.map.width},(_,x)=>[{x,y:0,kind:'wall',label:'wall'},{x,y:2,kind:'wall',label:'wall'}]).flat();return e;
}
function hazard(e,name,x,damage='1d4 cold') {return applyEffect(e,{name,description:'synthetic sequencing fixture',sourceCombatantId:e.combatants[1].id,targetCombatantId:e.combatants[1].id,points:[{x,y:1}],pointEffect:{type:'damaging-hazard',sizeFeet:5,damage,save:{ability:'dexterity',dc:99,damageOnSuccess:'none'}}});}
test('overlapping hazards wait for individual player rolls and do not replay completed entries',()=>{
 let e=hazard(hazard(state(),'first',1),'second',1);
 e=resolvePointHazardsForCombatant(e,source.id,()=>0);assert.equal(e.pendingResponse.name,'first');assert.equal(e.combatants[0].hitPoints.current,30);assert.equal(e.pendingPointHazards.length,1);
 e=resolvePointHazardResponse(e,()=>0).encounter;assert.equal(e.combatants[0].hitPoints.current,29);assert.equal(e.pendingResponse.name,'second');
 e=resolvePointHazardResponse(e,()=>0).encounter;assert.equal(e.combatants[0].hitPoints.current,28);assert.equal(e.pendingResponse,null);
 assert.equal(resumePointHazards(e).combatants[0].hitPoints.current,28);
});
test('concentration resolves between overlapping hazards without losing the second hazard',()=>{
 let e=hazard(hazard(state(),'first',1),'second',1);
 e=applyEffect(e,{name:'Concentration fixture',description:'test',sourceCombatantId:source.id,targetCombatantId:source.id,concentration:true});
 e=resolvePointHazardsForCombatant(e,source.id);e=resolvePointHazardResponse(e,()=>0).encounter;
 assert.equal(e.pendingResponse.type,'concentration-check');assert.equal(e.pendingPointHazards.length,1);
 e=resolveConcentrationResponse(e,()=>0).encounter;e=resumePointHazards(e);
 assert.equal(e.pendingResponse.name,'second');e=resolvePointHazardResponse(e,()=>0).encounter;
 assert.equal(e.combatants[0].hitPoints.current,28);assert.equal(e.pendingResponse,null);
});
test('end-turn hazards pause initiative and resume without reapplying damage',()=>{
 let e=hazard(hazard(state(),'first',1),'second',1);e.combatants.forEach(c=>c.initiativeRolled=true);
 e=endTurn(e,()=>0);assert.equal(e.activeIndex,0);assert.equal(e.pendingTurnEnd,true);
 assert.equal(endTurn(e),e);
 e=resolvePointHazardResponse(e,()=>0).encounter;e=resolvePointHazardResponse(e,()=>0).encounter;
 e=endTurn(e,()=>0);assert.equal(e.activeIndex,1);assert.equal(e.combatants[0].hitPoints.current,28);assert.equal(e.pendingTurnEnd,undefined);
});
test('enemy crosses each hazard square, pays each step and then attacks',()=>{
 let e=hazard(hazard(state(),'first',4),'second',3);e.activeIndex=1;e.turn.movementRemaining=30;
 e.combatants[1].attacks=e.combatants[1].attacks.filter(a=>a.kind==='melee');
 const r=resolveEnemyTurn(e,'beginner',()=>0);assert.equal(r.encounter.combatants[1].hitPoints.current,28);
 assert.equal(r.encounter.combatants[1].position.x,2);assert.equal(r.encounter.turn.movementRemaining,15);assert.ok(r.attackRoll);
});
test('enemy killed midway through a route never reaches the destination or attacks',()=>{
 let e=hazard(state(),'lethal',4,'10d10 cold');e.activeIndex=1;e.combatants[1].attacks=e.combatants[1].attacks.filter(a=>a.kind==='melee');
 const r=resolveEnemyTurn(e,'beginner',()=>0.9);assert.equal(r.encounter.combatants[1].hitPoints.current,0);assert.equal(r.encounter.combatants[1].position.x,4);assert.equal(r.attackRoll,null);
});
test('declining an opportunity attack preserves the remaining enemy route and resolves the entered hazard',()=>{
 let e=state();e.combatants[1].position.x=2;e.combatants[1].tacticId='brute';e=handleWeapon(e,source.id,'longsword').encounter;
 e=hazard(e,'crossing',4);e.activeIndex=1;e.combatants.forEach(c=>c.initiativeRolled=true);
 // Existing advanced ranged tactic retreats from melee reach.
 const r=resolveEnemyTurn(e,'advanced',()=>0);assert.equal(r.encounter.pendingResponse.type,'opportunity-attack');
 assert.ok(r.encounter.pendingEnemyPath);
 e=chooseOpportunityAttack(r.encounter,null).encounter;
 const resumed=resolveEnemyTurn(e,'advanced',()=>0);assert.equal(resumed.encounter.pendingEnemyPath,undefined);
 assert.ok(resumed.encounter.combatants[1].hitPoints.current<30);
});
test('Paralyzed targets fail Dexterity hazard saves even on a natural 20',()=>{
 let e=hazard(state(),'test',1);e.effects[0].pointEffect.save.dc=2;e.combatants[0].conditions=['Paralyzed'];
 e=resolvePointHazardsForCombatant(e,source.id);e=resolvePointHazardResponse(e,()=>0.99).encounter;assert.equal(e.combatants[0].hitPoints.current,26);
});
test('zero-HP replacement cannot be overwritten by a second hazard',()=>{
 const scenario=generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'});
 let e=createPlayableEncounter(pharos,scenario);e.combatants[0].position={x:1,y:1};e.combatants[0].hitPoints.current=1;
 e=hazard(hazard(e,'first',1),'second',1);
 e=resolvePointHazardsForCombatant(e,pharos.id);e=resolvePointHazardResponse(e,()=>0).encounter;
 assert.equal(e.pendingResponse.type,'zero-hit-point-replacement');assert.equal(e.pendingPointHazards.length,1);
 e=resolveZeroHitPointReplacement(e,true,()=>0).encounter;e=resumePointHazards(e);
 assert.equal(e.pendingResponse.name,'second');assert.equal(e.combatants[0].hitPoints.current,1);
 e=resolvePointHazardResponse(e,()=>0).encounter;assert.equal(e.combatants[0].hitPoints.current,0);assert.equal(e.pendingResponse,null);
});
test('damage-reduction choice resolves before a second point-hazard saving throw',()=>{
 let e=createPlayableEncounter(goliathBarbarian,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));e.combatants[0].position={x:1,y:1};
 e=hazard(hazard(e,'first',1),'second',1);
 e=resolvePointHazardsForCombatant(e,goliathBarbarian.id);e=resolvePointHazardResponse(e,()=>0).encounter;
 assert.equal(e.pendingResponse.type,'damage-reduction-reaction');assert.equal(e.pendingPointHazards.length,1);
 e=resolveDamageReductionReaction(e,true,()=>0).encounter;e=resumePointHazards(e);
 assert.equal(e.pendingResponse.name,'second');assert.equal(e.combatants[0].reactionAvailable,false);
});
