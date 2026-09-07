import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { hide, help, helpAbility, readyAttack, queueReadiedAttack, resolveReadiedAttack, interactWithDoor } from '../src/engine/interactions.ts';
import { resolveAbilityCheck } from "../src/engine/ability-checks.ts";
import { outgoingAttackRollMode, consumeAttackRollEffects, expireEffectsAtTurnStart, applyEffect } from '../src/engine/effects.ts';
import { resolveEnemyTurn } from '../src/engine/enemy-turns.ts';
import { applyMovementContinuation } from '../src/engine/movement.ts';
import { validateAction, actionCatalog } from '../src/engine/actions.ts';
function state(){const e=createPlayableEncounter(source,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));return {...e,selectedTargetId:e.combatants[1].id,map:{...e.map,terrain:[]},combatants:e.combatants.map((c,i)=>({...c,position:{x:1+2*i,y:1},initiativeRolled:true}))};}
function ally(e){return {...e,combatants:[...e.combatants,{...structuredClone(e.combatants[0]),id:'ally',name:'Ally',position:{x:1,y:2}}]};}
test('Hide requires total cover in current maps, rolls Stealth with armor disadvantage and stores discovery DC',()=>{
 const e=state();assert.equal(hide(e).legal,false);
 e.map.terrain=[{x:2,y:1,kind:'wall',label:'wall'}];
 const r=hide(e,()=>0.9);assert.equal(r.legal,true);assert.equal(r.roll.mode,'disadvantage');assert.equal(r.encounter.turn.action,false);
 assert.equal(r.encounter.effects.find(x=>x.hidden).hidden.dc,18);
 assert.equal(r.encounter.combatants[0].conditions.includes('Invisible'),true);
 const revealed=consumeAttackRollEffects(r.encounter,source.id,e.selectedTargetId);
 assert.equal(revealed.effects.some(x=>x.hidden),false);assert.equal(revealed.combatants[0].conditions.includes('Invisible'),false);
});
test('Failed Hide consumes Action without granting invisibility; half cover cannot qualify',()=>{
 const e=state();e.map.terrain=[{x:2,y:1,kind:'cover',label:'half cover'}];assert.equal(hide(e).legal,false);
 e.map.terrain[0].kind='wall';const r=hide(e,()=>0.1);assert.equal(r.legal,true);assert.equal(r.encounter.turn.action,false);assert.equal(r.encounter.effects.some(x=>x.hidden),false);
});
test('Enemy Search can discover a hidden creature and costs the enemy Action',()=>{
 const e=state();e.map.terrain=[{x:2,y:1,kind:'wall',label:'wall'}];
 const hidden=hide(e,()=>0.8).encounter;const turn={...hidden,activeIndex:1,turn:{...hidden.turn,action:true}};
 const r=resolveEnemyTurn(turn,()=>0.99);assert.equal(r.encounter.turn.action,false);assert.equal(r.encounter.effects.some(x=>x.hidden),false);assert.equal(r.damageRoll,null);
});
test('Help attack benefits the next ally attack only against the distracted adjacent enemy',()=>{
 const e=ally(state());e.combatants[1].position.x=2;
 const r=help(e,'attack',e.combatants[1].id);assert.equal(r.legal,true);
 assert.equal(outgoingAttackRollMode(r.encounter,source.id,e.combatants[1].id),'normal');
 assert.equal(outgoingAttackRollMode(r.encounter,'ally',e.combatants[1].id),'advantage');
 assert.equal(consumeAttackRollEffects(r.encounter,'ally',source.id).effects.some(x=>x.helpAttack),true);
 assert.equal(consumeAttackRollEffects(r.encounter,'ally',e.combatants[1].id).effects.some(x=>x.helpAttack),false);
 assert.equal(expireEffectsAtTurnStart(r.encounter,2,source.id).effects.some(x=>x.helpAttack),false);
 assert.equal(help(state(),'attack',e.combatants[1].id).legal,false);
});
test('Help stabilization makes DC10 Medicine check, clears saves but does not heal or wake the ally',()=>{
 const e=ally(state()),a=e.combatants[2];a.hitPoints.current=0;a.conditions=['Unconscious'];a.deathSaves.failures=2;
 const r=help(e,'stabilize',a.id,()=>0.5);assert.equal(r.legal,true);assert.equal(r.encounter.combatants[2].stabilized,true);assert.equal(r.encounter.combatants[2].hitPoints.current,0);assert.equal(r.encounter.combatants[2].conditions.includes('Unconscious'),true);
 a.deathSaves.failures=3;assert.equal(help(e,'stabilize',a.id).legal,false);
});
test('Door interaction is free once, then costs Action, changes cover and rejects locked or occupied doors',()=>{
 const e=state();e.map.terrain=[{x:2,y:1,kind:'wall',label:'door',door:{locked:false}}];
 let r=interactWithDoor(e,2,1);assert.equal(r.legal,true);assert.equal(r.encounter.turn.action,true);assert.equal(r.encounter.map.terrain[0].kind,'open-door');
 r=interactWithDoor(r.encounter,2,1);assert.equal(r.encounter.turn.action,false);assert.equal(interactWithDoor(r.encounter,2,1).legal,false);
 e.turn.action=false;assert.equal(validateAction(actionCatalog.find(a=>a.id==='utilize'),e).legal,true);assert.equal(interactWithDoor(e,2,1).legal,true);
 e.map.terrain[0].door.locked=true;assert.equal(interactWithDoor(e,2,1).legal,false);
});
test('Ready weapon uses Action now, waits for movement, allows decline, and preserves enemy turn when resolved',()=>{
 let e=state(),target=e.combatants[1];e=readyAttack(e,'glaive',target.id).encounter;
 assert.equal(e.turn.action,false);assert.equal(e.combatants[0].reactionAvailable,true);
 e={...e,activeIndex:1,turn:{...e.turn,action:true}};
 let q=queueReadiedAttack(e,target.id);assert.equal(q.pendingResponse.type,'readied-attack');
 const declined=resolveReadiedAttack(q,'decline').encounter;assert.equal(declined.combatants[0].reactionAvailable,true);assert.equal(queueReadiedAttack(declined,target.id).pendingResponse,null);
 q=resolveReadiedAttack(q,'accept').encounter;
 const hit=resolveReadiedAttack(q,'roll',()=>0.9);assert.equal(hit.encounter.combatants[0].reactionAvailable,false);assert.equal(hit.encounter.turn.action,true);assert.equal(hit.encounter.activeIndex,1);assert.equal(hit.encounter.pendingResponse.phase,'damage-roll');
 const damage=resolveReadiedAttack(hit.encounter,'roll',()=>0.5);assert.equal(damage.encounter.pendingResponse,null);assert.ok(damage.encounter.combatants[1].hitPoints.current<target.hitPoints.current);assert.equal(damage.encounter.turn.action,true);
});
test('Ready validates range at trigger time, expires, and cannot fire while incapacitated',()=>{
 let e=state();e=readyAttack(e,'longsword',e.combatants[1].id).encounter;
 assert.equal(queueReadiedAttack(e,e.combatants[1].id).pendingResponse,null);
 assert.equal(expireEffectsAtTurnStart(e,2,source.id).effects.some(x=>x.readiedAttack),false);
 e.combatants[1].position.x=2;e=applyEffect(e,{name:'Stunned',description:'test',sourceCombatantId:source.id,targetCombatantId:source.id,conditionGranted:'Stunned'});
 assert.equal(queueReadiedAttack(e,e.combatants[1].id).pendingResponse,null);
});
test('Ready trigger survives movement resumed after an opportunity-attack choice',()=>{
 let e=state();e=readyAttack(e,'glaive',e.combatants[1].id).encounter;e={...e,activeIndex:1,turn:{...e.turn,action:true}};
 e=applyMovementContinuation(e,{combatantId:e.combatants[1].id,x:2,y:1,cost:5});
 const r=resolveEnemyTurn(e,()=>0.01);assert.equal(r.encounter.pendingResponse.type,'readied-attack');assert.equal(r.encounter.turn.action,true);
});

test('Skill Help requires proficiency and explicit feasibility, then consumes only on the matching check',()=>{
 const e=ally(state());assert.equal(helpAbility(e,'ally','history',false).legal,false);assert.equal(helpAbility(e,'ally','stealth',true).legal,false);
 const r=helpAbility(e,'ally','history',true);assert.equal(r.legal,true);
 const different=resolveAbilityCheck(r.encounter,'ally','perception',{});assert.equal(different.encounter.effects.some(x=>x.helpCheck),true);
 const matching=resolveAbilityCheck(different.encounter,'ally','history',{});assert.equal(matching.roll.mode,'advantage');assert.equal(matching.encounter.effects.some(x=>x.helpCheck),false);
});
test('The enemy resumes its own Action after a readied attack triggered by actual movement',()=>{
 let e=state();e.combatants[1].position.x=5;e.combatants[1].attacks=e.combatants[1].attacks.filter(a=>a.kind==='melee');
 e=readyAttack(e,'glaive',e.combatants[1].id).encounter;e={...e,activeIndex:1,turn:{...e.turn,action:true,movementRemaining:30}};
 let r=resolveEnemyTurn(e,()=>0.01);assert.equal(r.encounter.pendingResponse.type,'readied-attack');
 e=resolveReadiedAttack(r.encounter,'accept').encounter;e=resolveReadiedAttack(e,'roll',()=>0.8).encounter;e=resolveReadiedAttack(e,'roll',()=>0).encounter;
 r=resolveEnemyTurn(e,'beginner',()=>0.01);assert.equal(r.encounter.turn.action,false);assert.ok(r.attackRoll);assert.equal(r.encounter.pendingResponse,null);
});
test('Opening even a quiet door ends Hide when it exposes the creature to an enemy',()=>{
 const e=state();e.map.terrain=[{x:2,y:1,kind:'wall',label:'quiet door',door:{locked:false}}];
 let h=hide(e,()=>0.9).encounter;
 assert.equal(interactWithDoor(h,2,1).encounter.effects.some(x=>x.hidden),false);
 h={...h,map:{...h.map,terrain:h.map.terrain.map(c=>({...c,door:{...c.door,noisy:true}}))}};
 assert.equal(interactWithDoor(h,2,1).encounter.effects.some(x=>x.hidden),false);
});
