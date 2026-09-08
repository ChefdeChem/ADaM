import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { hide, interactWithDoor } from '../src/engine/interactions.ts';
import { revealHiddenInPlainSight, applyEffect } from '../src/engine/effects.ts';
import { applyMovementContinuation, moveActiveCombatant } from '../src/engine/movement.ts';
import { resolveEnemyTurn } from '../src/engine/enemy-turns.ts';

function state() {
 const e = createPlayableEncounter(source, generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));
 e.combatants = e.combatants.slice(0,2).map((c,i)=>({...c,position:{x:1+2*i,y:1},initiativeRolled:true}));
 e.map.terrain = [{x:2,y:1,kind:'wall',label:'quiet door',door:{locked:false}}];
 return hide(e,()=>0.9).encounter;
}
const hidden = e => e.effects.some(effect=>effect.hidden);
test('approved ruling reveals after movement and does not restore Hide on returning to cover',()=>{
 let e=state(); assert.equal(hidden(revealHiddenInPlainSight(e)),true);
 e=applyMovementContinuation(e,{combatantId:source.id,x:1,y:2,cost:5});
 assert.equal(hidden(e),false); assert.equal(e.turn.action,false);
 e=applyMovementContinuation(e,{combatantId:source.id,x:1,y:1,cost:5});
 assert.equal(hidden(e),false);
});
test('normal movement applies visibility without consuming an extra action',()=>{
 const r=moveActiveCombatant(state(),1,3,()=>0.01);
 assert.equal(r.legal,true); assert.equal(hidden(r.encounter),false);
 assert.equal(r.encounter.turn.action,false);
});
test('a moving observer reveals a stationary hidden character during resumed movement',()=>{
 let e=state(); e={...e,activeIndex:1};
 e=applyMovementContinuation(e,{combatantId:e.combatants[1].id,x:3,y:2,cost:5});
 e=applyMovementContinuation(e,{combatantId:e.combatants[1].id,x:3,y:3,cost:5});
 assert.equal(hidden(e),false); assert.equal(e.completedEnemyMovementId,e.combatants[1].id);
});
test('blind, unconscious, and allied observers cannot reveal through ordinary sight',()=>{
 for(const condition of ['Blinded','Unconscious']) {
  const e=state(); e.combatants[1].conditions=[condition]; e.map.terrain=[];
  assert.equal(hidden(revealHiddenInPlainSight(e)),true);
 }
 const e=state(); e.combatants[1].side='player'; e.map.terrain=[];
 assert.equal(hidden(revealHiddenInPlainSight(e)),true);
});
test('Hide reconciliation preserves magical invisibility and does not mutate input',()=>{
 let e=state(); e=applyEffect(e,{name:'Magical invisibility',description:'test fixture',sourceCombatantId:source.id,targetCombatantId:source.id,conditionGranted:'Invisible'});
 e.map.terrain=[]; const before=structuredClone(e);
 const next=revealHiddenInPlainSight(e); assert.equal(hidden(next),true);
 assert.equal(next.combatants[0].conditions.includes('Invisible'),true); assert.deepEqual(e,before);
});
test('quiet doors preserve Hide behind another wall; noisy doors end it',()=>{
 let e=state(); e.combatants[1].position.x=4;
 e.map.terrain.push({x:3,y:1,kind:'wall',label:'second wall'});
 assert.equal(hidden(interactWithDoor(e,2,1).encounter),true);
 e.map.terrain[0].door.noisy=true;
 assert.equal(hidden(interactWithDoor(e,2,1).encounter),false);
});
test('clear sight resolves before enemy Search, allowing its normal Action',()=>{
 let e=state(); e.map.terrain=[]; e.activeIndex=1; e.turn.action=true;
 const r=resolveEnemyTurn(e,'beginner',()=>0.01);
 assert.equal(hidden(r.encounter),false);
 assert.equal(r.steps.some(step=>step.summary.includes('uses Search')),false);
 assert.ok(r.attackRoll);
});
