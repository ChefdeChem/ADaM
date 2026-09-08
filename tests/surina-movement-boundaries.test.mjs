import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { legalMovementDestinations, moveActiveCombatant, applyMovementContinuation, resumeMovementContinuation } from '../src/engine/movement.ts';
import { gridStepCost, crossesSolidCorner } from '../src/engine/grid-movement.ts';
import { pushTargetAway } from '../src/engine/areas.ts';
import { resolveEnemyTurn } from '../src/engine/enemy-turns.ts';
import { applyEffect } from '../src/engine/effects.ts';
import { resolvePointHazardResponse } from '../src/engine/point-effects.ts';

function state() {
 const e=createPlayableEncounter(source,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));
 e.combatants=e.combatants.slice(0,2).map((c,i)=>({...c,position:{x:i?5:1,y:1},initiativeRolled:true}));
 e.map.terrain=[];return e;
}
test('five-foot diagonals remain available without solid corners',()=>{
 const e=state(); e.turn.movementRemaining=5;
 assert.equal(legalMovementDestinations(e).find(c=>c.x===2&&c.y===2)?.cost,5);
});
test('wall corners disallow the diagonal shortcut but allow a longer open route',()=>{
 const e=state();e.map.terrain=[{x:2,y:1,kind:'wall',label:'wall'}];
 assert.equal(legalMovementDestinations(e).find(c=>c.x===2&&c.y===2)?.cost,10);
 e.turn.movementRemaining=5;assert.equal(moveActiveCombatant(e,2,2).legal,false);
});
test('cover and difficult terrain do not become solid-corner blockers',()=>{
 const e=state();for(const kind of ['cover','difficult','open-door']){
 e.map.terrain=[{x:2,y:1,kind,label:kind}];
 assert.equal(crossesSolidCorner(e,source.id,{x:1,y:1},{x:2,y:2}),false);
 }
});
test('crawling plus Difficult Terrain is fifteen feet for players and enemies',()=>{
 const e=state();e.map.terrain=[{x:2,y:1,kind:'difficult',label:'rubble'}];
 for(const c of e.combatants){c.conditions=['Prone'];assert.equal(gridStepCost(e,c.id,{x:2,y:1}),15);}
 assert.equal(legalMovementDestinations(e).find(c=>c.x===2&&c.y===1)?.cost,15);
});
test('Prone enemy movement pays the crawl cost before attacking',()=>{
 const e=state();e.activeIndex=1;e.combatants[1].position={x:4,y:1};e.combatants[1].conditions=['Prone'];
 e.combatants[1].attacks=e.combatants[1].attacks.filter(a=>a.kind==='melee');e.turn.movementRemaining=10;
 const r=resolveEnemyTurn(e,'beginner',()=>0.01);
 assert.equal(Math.max(Math.abs(r.encounter.combatants[1].position.x-4),Math.abs(r.encounter.combatants[1].position.y-1)),1);
 assert.equal(r.encounter.turn.movementRemaining,0);assert.equal(r.attackRoll,null);
});
test('forced diagonal movement stops at solid corners rather than passing through them',()=>{
 const e=state();e.combatants[0].position={x:0,y:0};e.combatants[1].position={x:1,y:1};
 e.map.terrain=[{x:2,y:1,kind:'wall',label:'wall'}];
 assert.deepEqual(pushTargetAway(e,source.id,e.combatants[1].id,10).combatants[1].position,{x:1,y:1});
});
test('resumed movement rejects newly blocked or occupied destinations without spending movement',()=>{
 for(const blocker of ['wall','creature']){
 const e=state();if(blocker==='wall')e.map.terrain=[{x:2,y:1,kind:'wall',label:'closed door'}];else e.combatants[1].position={x:2,y:1};
 const r=resumeMovementContinuation(e,{combatantId:source.id,x:2,y:1,cost:5,destination:{x:3,y:1}});
 assert.equal(r.legal,false);assert.equal(r.encounter,e);
 }
});
test('stale continuation costs and pending responses cannot teleport or overspend movement',()=>{
 const e=state();const c={combatantId:source.id,x:2,y:1,cost:5};
 for(const cost of [-5,0,35])assert.equal(applyMovementContinuation(e,{...c,cost}),e);
 assert.equal(applyMovementContinuation(e,{...c,x:4,cost:5}),e);
 e.combatants[0].conditions=['Prone'];assert.equal(applyMovementContinuation(e,c),e);
 e.combatants[0].conditions=[];e.pendingResponse={type:'concentration-check',targetCombatantId:source.id,dc:10,damageTaken:1};
 assert.equal(applyMovementContinuation(e,c),e);
});
test('lethal damage on a movement square stops the remaining path',()=>{
 let e=state();e.combatants[0].hitPoints.current=1;
 // Test fixture for the existing user-provided hazard engine, not a new spell grant.
 e=applyEffect(e,{name:'Test hazard',description:'movement regression',sourceCombatantId:e.combatants[1].id,targetCombatantId:e.combatants[1].id,points:[{x:2,y:1}],pointEffect:{type:'damaging-hazard',damage:'1d6 cold',save:{ability:'dexterity',dc:99,damageOnSuccess:'none'}}});
 e.map.height=2;e.map.terrain=[{x:1,y:0,kind:'wall',label:'wall'},{x:2,y:0,kind:'wall',label:'wall'},{x:3,y:0,kind:'wall',label:'wall'}];
 const r=moveActiveCombatant(e,3,1,()=>0.5);assert.equal(r.legal,true);
 assert.equal(r.encounter.pendingResponse.type,'point-hazard-save');
 r.encounter=resolvePointHazardResponse(r.encounter,()=>0.5).encounter;
 assert.equal(r.encounter.combatants[0].hitPoints.current,0);assert.deepEqual(r.encounter.combatants[0].position,{x:2,y:1});assert.equal(r.encounter.turn.movementRemaining,25);
});
