import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_CHARACTERS } from '../src/characters/built-ins.ts';
import { createPlayableEncounter, playableCharacter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { actionCatalog, consumeAction, validateAction } from '../src/engine/actions.ts';
import { applyEffect, effectiveSpeed, outgoingAttackRollMode, savingThrowRollMode, expireEffectsAtTurnStart, removeCondition, reconcileConcentration } from '../src/engine/effects.ts';
import { resolveAttackRoll, resolveReactionAttackRoll, validateAttackChoice, resolveAttackDamage } from '../src/engine/combat-options.ts';
import { legalMovementDestinations } from '../src/engine/movement.ts';
import { resolveEnemyTurn } from '../src/engine/enemy-turns.ts';
const source = BUILT_IN_CHARACTERS.find(c=>c.id==='surina-daardendrian');
const dodge = actionCatalog.find(a=>a.id==='dodge');
function ready() {
 const e=createPlayableEncounter(source,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));
 return {...e,selectedTargetId:e.combatants[1].id,map:{...e.map,terrain:[]},combatants:e.combatants.map((c,i)=>({...c,initiativeRolled:true,position:{x:1+i,y:1}}))};
}
function condition(e,name) {return applyEffect(e,{name,description:name,sourceCombatantId:source.id,targetCombatantId:source.id,conditionGranted:name});}
test('Dodge consumes Action, keeps Bonus Action, and changes attacks and Dexterity saves',()=>{
 const e=consumeAction(dodge,ready());
 assert.equal(e.turn.action,false);assert.equal(e.turn.bonusAction,true);
 assert.equal(outgoingAttackRollMode(e,e.combatants[1].id,source.id),'disadvantage');
 assert.equal(savingThrowRollMode(e,source.id,undefined,'normal','dexterity'),'advantage');
 assert.equal(savingThrowRollMode(e,source.id,undefined,'normal','constitution'),'normal');
});
test('Dodge visibility restriction affects attacks but not Dexterity saves',()=>{
 const e=consumeAction(dodge,ready());
 for(const state of [condition(e,'Blinded'),{...e,combatants:e.combatants.map((c,i)=>i===1?{...c,conditions:['Invisible']}:c)}]) {
  assert.equal(outgoingAttackRollMode(state,state.combatants[1].id,source.id),'normal');
  assert.equal(savingThrowRollMode(state,source.id,undefined,'normal','dexterity'),'advantage');
 }
});
test('Dodge respects cover visibility and advantage/disadvantage cancellation',()=>{
 const e=consumeAction(dodge,ready());
 e.combatants[1].position={x:4,y:1};e.map.terrain=[{x:2,y:1,kind:'wall'}];
 assert.equal(outgoingAttackRollMode(e,e.combatants[1].id,source.id),'normal');
 e.map.terrain=[];
 assert.equal(outgoingAttackRollMode(e,e.combatants[1].id,source.id,'advantage'),'normal');
 assert.equal(savingThrowRollMode(e,source.id,undefined,'disadvantage','dexterity'),'normal');
});
test('spending all movement does not end Dodge; Speed zero does and does not restore it on release',()=>{
 const e=consumeAction(dodge,ready());e.turn.movementRemaining=0;
 assert.equal(savingThrowRollMode(e,source.id,undefined,'normal','dexterity'),'advantage');
 const stopped=condition(e,'Grappled');
 assert.equal(effectiveSpeed(stopped,source.id),0);
 assert.equal(stopped.effects.some(x=>x.modifiers.dodge),false);
 assert.equal(legalMovementDestinations({...stopped,turn:{...stopped.turn,movementRemaining:30}}).length,0);
 const released=removeCondition(stopped,source.id,'Grappled');
 assert.equal(savingThrowRollMode(released,source.id,undefined,'normal','dexterity'),'normal');
});
test('Dodge ends at the next turn and on incapacitation',()=>{
 const e=consumeAction(dodge,ready());
 assert.equal(condition(e,'Stunned').effects.some(x=>x.modifiers.dodge),false);
 assert.equal(expireEffectsAtTurnStart(e,2,source.id).effects.some(x=>x.modifiers.dodge),false);
});
test('Dodge is not prematurely removed while a zero-HP replacement is awaiting a choice',()=>{
 const e=consumeAction(dodge,ready());e.combatants[0].hitPoints.current=0;
 e.pendingResponse={type:'zero-hit-point-replacement',targetCombatantId:source.id};
 assert.equal(reconcileConcentration(e).effects.some(x=>x.modifiers.dodge),true);
});
test('Dodge applies to actual enemy attacks and opportunity attacks',()=>{
 const e=consumeAction(dodge,ready());const enemy=e.combatants[1];
 const state={...e,activeIndex:1,selectedTargetId:source.id,turn:{...e.turn,action:true}};
 assert.equal(resolveAttackRoll(state,enemy.attacks[0],()=>0.5).roll.rolls.length,2);
 assert.equal(resolveReactionAttackRoll(e,enemy.id,source.id,enemy.attacks.find(a=>a.kind==='melee'),()=>0.5).roll.rolls.length,2);
});
test('Incapacitated blocks generic actions, attacks, reactions and enemy offense',()=>{
 const e=condition(ready(),'Incapacitated');const attack=e.combatants[0].attacks[0];
 assert.equal(validateAction(dodge,e,source).legal,false);
 assert.equal(consumeAction(dodge,e),e);
 assert.equal(validateAttackChoice(e,attack).legal,false);
 assert.equal(resolveReactionAttackRoll(e,source.id,e.combatants[1].id,attack).legal,false);
 const enemyState={...e,activeIndex:1,combatants:e.combatants.map((c,i)=>i===1?{...c,conditions:['Stunned']}:c)};
 assert.equal(resolveEnemyTurn(enemyState).attackRoll,null);
});
test('opportunity attacks require seeing the departing creature',()=>{
 const e=condition(ready(),'Blinded');
 assert.equal(resolveReactionAttackRoll(e,source.id,e.combatants[1].id,e.combatants[0].attacks[0]).legal,false);
});
test('Versatile offers two damage choices without mutating the source or granting mastery',()=>{
 const before=JSON.stringify(source),p=playableCharacter(source).character,e=ready();
 const two=p.attacks.find(a=>a.id==='longsword-two-handed');
 assert.equal(two.damage,'1d10 + 3 slashing');assert.equal(two.mastery,undefined);
 assert.equal(p.attacks.find(a=>a.id==='longsword').damage,'1d8 + 3 slashing');
 assert.equal(JSON.stringify(source),before);
 assert.equal(resolveAttackDamage(e,two,e.combatants[1].id,false,()=>0.99).roll.total,13);
 assert.equal(resolveAttackDamage(e,two,e.combatants[1].id,true,()=>0.99).roll.total,23);
});
test('two-handed Longsword respects carried inventory and equipped Shields',()=>{
 const e=ready(),two=e.combatants[0].attacks.find(a=>a.id==='longsword-two-handed');
 assert.equal(validateAttackChoice(e,two).legal,true);
 e.combatants[0].hasEquippedShield=true;
 assert.equal(validateAttackChoice(e,two).legal,false);
 assert.equal(resolveReactionAttackRoll(e,source.id,e.combatants[1].id,two).legal,false);
 e.combatants[0].hasEquippedShield=false;
 e.combatants[0].inventory.find(i=>i.id==='longsword').current=0;
 assert.equal(validateAttackChoice(e,two).legal,false);
});
