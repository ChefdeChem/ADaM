import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { resolveShove, validateShove } from '../src/engine/shove.ts';
import { applyEffect, effectiveSpeed, outgoingAttackRollMode } from '../src/engine/effects.ts';
import { resolvePointHazardsForCombatant, resumePointHazards } from '../src/engine/point-effects.ts';
import { resolveConcentrationResponse } from '../src/engine/responses.ts';
import { consumeAction, actionCatalog } from '../src/engine/actions.ts';
import { handleWeapon } from '../src/engine/weapon-hands.ts';

function state() {
 const e=createPlayableEncounter(source,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));
 e.combatants=e.combatants.slice(0,2).map((c,i)=>({...c,position:{x:1+i,y:2},initiativeRolled:true,hitPoints:{current:30,maximum:30},savingThrowModifiers:{...c.savingThrowModifiers,strength:0,dexterity:0}}));
 e.map.terrain=[];e.selectedTargetId=e.combatants[1].id;return e;
}
const shove=(e,mode='prone',random=()=>0)=>resolveShove(e,e.combatants[1].id,mode,random);
function hazard(e,name,points) {return applyEffect(e,{name,description:'Synthetic hazard; no additional spell rules',sourceCombatantId:source.id,targetCombatantId:source.id,points,pointEffect:{type:'damaging-hazard',sizeFeet:5,damage:'1d4 cold',save:{ability:'dexterity',dc:99,damageOnSuccess:'none'}}});}

test('Surina Shove uses DC13 saving throw, no Athletics contest, damage or resource spending',()=>{
 const e=state(),snapshot=JSON.stringify(e),original=JSON.stringify(source);
 e.combatants[0].skillModifiers.athletics=100;
 const r=shove(e);assert.equal(r.legal,true);assert.equal(r.dc,13);assert.equal(r.saved,false);
 assert.equal(r.encounter.turn.action,false);assert.equal(r.encounter.turn.bonusAction,true);
 assert.equal(r.encounter.combatants[1].hitPoints.current,30);assert.ok(r.encounter.combatants[1].conditions.includes('Prone'));
 assert.deepEqual(r.encounter.combatants[0].resources,e.combatants[0].resources);
 assert.deepEqual(r.encounter.combatants[0].inventory,e.combatants[0].inventory);
 assert.equal(shove(r.encounter).legal,false);assert.equal(JSON.stringify(source),original);
 assert.equal(JSON.parse(snapshot).combatants[1].conditions.includes('Prone'),false);
});
test('NPC chooses save before rolling by probability, including Dodge and half cover',()=>{
 let e=state();e.combatants[1].savingThrowModifiers.strength=2;
 e=applyEffect(e,{name:'Dodge',description:'test',sourceCombatantId:e.combatants[1].id,targetCombatantId:e.combatants[1].id,modifiers:{dodge:true}});
 let r=shove(e,'push',()=>0.9);assert.equal(r.saveAbility,'dexterity');assert.equal(r.roll.mode,'advantage');assert.equal(r.saved,true);
 e=state();e.map.terrain=[{x:2,y:2,kind:'cover',label:'half cover'}];r=shove(e,'push',()=>0.5);
 assert.equal(r.saveAbility,'dexterity');assert.equal(r.roll.modifier,2);assert.equal(r.roll.total,13);assert.equal(r.saved,true);
});
test('save ties succeed; natural 20 does not override a save total below DC',()=>{
 let e=state();let r=shove(e,'prone',()=>0.6);assert.equal(r.roll.total,13);assert.equal(r.saved,true);
 e.combatants[1].savingThrowModifiers.strength=-10;e.combatants[1].savingThrowModifiers.dexterity=-10;
 r=shove(e,'prone',()=>0.999);assert.equal(r.roll.natural,20);assert.equal(r.saved,false);
});
test('2024 Incapacitated alone is not an automatic failure; Paralyzed and Stunned are',()=>{
 for(const condition of ['Paralyzed','Stunned','Petrified','Unconscious']) {
  const e=state();e.combatants[1].conditions=[condition];
  const r=shove(e,'prone',()=>{throw Error('automatic failure must not roll')});assert.equal(r.saved,false);assert.equal(r.roll,null);
 }
 const e=state();e.combatants[1].conditions=['Incapacitated'];assert.equal(shove(e,'push',()=>0.99).saved,true);
});
test('Prone affects attack rolls and can be cleared by standing for half Speed',()=>{
 const e=shove(state()).encounter,id=e.combatants[1].id;
 assert.equal(outgoingAttackRollMode(e,id,source.id),'disadvantage');
 // Use the generic player-controlled action surface to exercise the same condition lifecycle.
 const controlled={...e,activeIndex:1,turn:{...e.turn,movementRemaining:30},combatants:e.combatants.map(c=>({...c,side:'player'}))};
 const stood=consumeAction(actionCatalog.find(a=>a.id==='stand-up'),controlled);
 assert.equal(stood.combatants[1].conditions.includes('Prone'),false);assert.equal(stood.turn.movementRemaining,15);
 assert.equal(stood.effects.some(f=>f.name==='Shove: Prone'),false);
});
test('Prone immunity prevents both the condition and an ongoing Prone marker',()=>{
 let e=state();e.combatants[1].conditionImmunities=['Prone'];let r=shove(e);
 assert.equal(r.encounter.combatants[1].conditions.includes('Prone'),false);assert.equal(r.encounter.effects.length,0);assert.match(r.summary,/immune/);
 e=state();e=applyEffect(e,{name:'Immunity',description:'test',sourceCombatantId:source.id,targetCombatantId:e.combatants[1].id,modifiers:{conditionImmunities:['Prone']}});
 assert.equal(shove(e).encounter.effects.some(f=>f.name==='Shove: Prone'),false);
});
test('push moves exactly one square without movement cost, reaction or weapon on-hit triggers',()=>{
 let e=state();e.combatants[0].heldWeaponIds=['glaive','longsword'];
 e=applyEffect(e,{name:'Sap',description:'next attack roll',sourceCombatantId:e.combatants[1].id,targetCombatantId:source.id,consumeOnAttackRoll:true,modifiers:{outgoingAttacks:'disadvantage'}});
 const r=shove(e,'push');assert.deepEqual(r.encounter.combatants[1].position,{x:3,y:2});
 assert.equal(r.encounter.turn.movementRemaining,e.turn.movementRemaining);assert.equal(r.encounter.pendingResponse,null);
 assert.equal(r.encounter.combatants[0].reactionAvailable,true);assert.equal(r.encounter.effects.some(f=>f.name==='Sap'),true);
 assert.deepEqual(r.encounter.combatants[0].heldWeaponIds,['glaive','longsword']);
 assert.equal(r.encounter.turn.attackEquipmentChangeAvailable,true);
 const stowed=handleWeapon(r.encounter,source.id,'glaive');assert.equal(stowed.legal,true);assert.equal(stowed.encounter.turn.attackEquipmentChangeAvailable,false);
});
test('a wall, occupied destination, map edge or solid corner stops a push without collision damage',()=>{
 for (const type of ['wall','occupied','edge','corner']) {
  const e=state();
  if(type==='wall')e.map.terrain=[{x:3,y:2,kind:'wall',label:'wall'}];
  if(type==='occupied')e.combatants.push({...structuredClone(e.combatants[1]),id:'blocker',position:{x:3,y:2}});
  if(type==='edge')e.map.width=3;
  if(type==='corner'){e.combatants[1].position={x:2,y:3};e.map.terrain=[{x:3,y:3,kind:'wall',label:'corner'}];}
  const r=shove(e,'push');assert.equal(r.legal,true);assert.deepEqual(r.encounter.combatants[1].position,e.combatants[1].position);
  assert.equal(r.encounter.combatants[1].hitPoints.current,30);assert.equal(r.encounter.turn.action,false);
 }
});
test('push enters hazards once and a blocked push does not re-trigger a hazard',()=>{
 let e=hazard(state(),'landing',[{x:3,y:2}]);assert.equal(shove(e,'push').encounter.combatants[1].hitPoints.current,29);
 e=hazard(state(),'standing',[{x:2,y:2}]);e.map.terrain=[{x:3,y:2,kind:'wall',label:'wall'}];
 assert.equal(shove(e,'push').encounter.combatants[1].hitPoints.current,30);
});
test('Large footprint edge is reachable and hazards hit once even across multiple occupied points',()=>{
 let e=state();e.combatants[0].position={x:4,y:2};e.combatants[1].position={x:2,y:2};e.combatants[1].size='large';
 assert.equal(validateShove(e,e.combatants[1].id).legal,true);
 e=hazard(e,'edge hazard',[{x:1,y:3},{x:2,y:3}]);const r=shove(e,'push');
 assert.equal(r.encounter.combatants[1].position.x,1);assert.equal(r.encounter.combatants[1].hitPoints.current,29);
 const smaller=state();smaller.combatants[0].size='small';smaller.combatants[1].size='large';assert.equal(shove(smaller).legal,false);
});
test('pushed concentration target preserves overlapping hazard responses',()=>{
 let e=state();e=applyEffect(e,{name:'Focus',description:'test',sourceCombatantId:e.combatants[1].id,targetCombatantId:e.combatants[1].id,concentration:true});
 e=hazard(hazard(e,'first',[{x:3,y:2}]),'second',[{x:3,y:2}]);
 let r=shove(e,'push').encounter;
 // NPC concentration resolves internally; both events still resolve once.
 if(r.pendingResponse?.type==='concentration-check')r=resumePointHazards(resolveConcentrationResponse(r,()=>0).encounter,()=>0);
 assert.equal(r.combatants[1].hitPoints.current,28);assert.equal(r.pendingPointHazards.length,0);
});
test('illegal Shoves are atomic and cannot be used before initiative, through pending responses or on enemy turns',()=>{
 const mutations=[e=>e.turn.action=false,e=>e.combatants[0].initiativeRolled=false,e=>e.combatants[0].conditions=['Stunned'],e=>e.pendingResponse={type:'point-hazard-save',effectId:'pending',targetCombatantId:source.id,name:'pending'},e=>e.activeIndex=1,e=>e.combatants[1].position.x=3,e=>e.combatants[1].hitPoints.current=0];
 for(const mutate of mutations){const e=state();mutate(e);const snapshot=JSON.stringify(e);const r=shove(e);assert.equal(r.legal,false);assert.equal(r.encounter,e);assert.equal(JSON.stringify(e),snapshot);}
});
test('charm forbids Shove against its source, but Speed zero and occupied hands do not',()=>{
 let e=state();e=applyEffect(e,{name:'Charm',description:'test',sourceCombatantId:e.combatants[1].id,targetCombatantId:source.id,modifiers:{preventsHarmingSource:true}});assert.equal(shove(e).legal,false);
 e=state();e.combatants[0].conditions=['Grappled'];e.combatants[0].heldWeaponIds=['glaive','longsword'];assert.equal(effectiveSpeed(e,source.id),0);assert.equal(shove(e).legal,true);
});
test('stationary footprint hazard resolution also detects non-anchor occupied cells',()=>{
 let e=state();e.combatants[1].size='large';e=hazard(e,'edge',[{x:3,y:3}]);
 assert.equal(resolvePointHazardsForCombatant(e,e.combatants[1].id,()=>0).combatants[1].hitPoints.current,29);
});
