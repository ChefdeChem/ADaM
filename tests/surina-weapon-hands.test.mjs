import assert from 'node:assert/strict';
import test from 'node:test';
import { surinaDaardendrian as source } from '../src/characters/verified-pdf-characters.ts';
import { createPlayableEncounter, playableCharacter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { handleWeapon, validateWeaponHands } from '../src/engine/weapon-hands.ts';
import { resolveAttackRoll, resolveReactionAttackRoll } from '../src/engine/combat-options.ts';
import { interactWithDoor } from '../src/engine/interactions.ts';

function state() {
 const e=createPlayableEncounter(source,generateScriptedScenario({prompt:'',environment:'market',objective:'defeat',difficulty:'easy'}));
 e.combatants=e.combatants.slice(0,2).map((c,i)=>({...c,position:{x:1+i,y:1}}));
 e.selectedTargetId=e.combatants[1].id; e.map.terrain=[];
 return e;
}
const attack=(e,id)=>e.combatants[0].attacks.find(a=>a.id===id);
test('Surina starts with explicit empty hands and can choose equipment before initiative without costs',()=>{
 const e=state(); assert.deepEqual(e.combatants[0].heldWeaponIds,[]);
 const r=handleWeapon(e,source.id,'glaive'); assert.equal(r.legal,true);
 assert.deepEqual(r.encounter.combatants[0].heldWeaponIds,['glaive']); assert.deepEqual(r.encounter.turn,e.turn);
 assert.deepEqual(e.combatants[0].heldWeaponIds,[]);
});
test('a carried weapon cannot make an opportunity attack, but a held weapon can',()=>{
 let e=state();const a=attack(e,'glaive');
 assert.equal(resolveReactionAttackRoll(e,source.id,e.selectedTargetId,a,()=>0.9).legal,false);
 e=handleWeapon(e,source.id,'glaive').encounter;
 assert.equal(resolveReactionAttackRoll(e,source.id,e.selectedTargetId,a,()=>0.9).legal,true);
});
test('Attack draws a weapon without spending the separate free interaction',()=>{
 const e=state();const r=resolveAttackRoll(e,attack(e,'glaive'),()=>0.9);
 assert.equal(r.legal,true);assert.deepEqual(r.encounter.combatants[0].heldWeaponIds,['glaive']);
 assert.equal(r.encounter.turn.objectInteractionUsed,e.turn.objectInteractionUsed);
});
test('two-handed attacks reject an occupied second hand; one-handed Longsword and unarmed remain legal',()=>{
 let e=state();e=handleWeapon(e,source.id,'glaive').encounter;e=handleWeapon(e,source.id,'longsword').encounter;
 assert.equal(validateWeaponHands(e,source.id,attack(e,'glaive'),true).legal,false);
 assert.equal(validateWeaponHands(e,source.id,attack(e,'longsword-two-handed'),true).legal,false);
 assert.equal(validateWeaponHands(e,source.id,attack(e,'longsword'),true).legal,true);
 assert.equal(validateWeaponHands(e,source.id,attack(e,'unarmed-strike'),true).legal,true);
});
test('stowing shares free interaction with doors and further handling consumes Action',()=>{
 let e=handleWeapon(state(),source.id,'glaive').encounter;e.combatants.forEach(c=>c.initiativeRolled=true);
 e=handleWeapon(e,source.id,'glaive').encounter;assert.equal(e.turn.objectInteractionUsed,true);assert.equal(e.turn.action,true);
 e.map.terrain=[{x:1,y:2,kind:'wall',label:'door',door:{locked:false}}];
 e=interactWithDoor(e,1,2).encounter;assert.equal(e.turn.action,false);
 assert.equal(handleWeapon(e,source.id,'longsword').legal,false);
});
test('weapon switching requires stowing when hands are occupied; source equipment is not rewritten',()=>{
 const original=structuredClone(source);let e=state();e=handleWeapon(e,source.id,'glaive').encounter;
 e.combatants.forEach(c=>c.initiativeRolled=true);
 e=handleWeapon(e,source.id,'glaive').encounter;
 const r=resolveAttackRoll(e,attack(e,'longsword-two-handed'),()=>0.9);assert.equal(r.legal,true);
 assert.deepEqual(r.encounter.combatants[0].heldWeaponIds,['longsword']);
 assert.equal(playableCharacter(source).character.attacks.find(a=>a.id==='glaive').requiresTwoHands,true);
 assert.deepEqual(source,original);
});
test('throwing expends a Javelin and frees its hand even with copies still carried',()=>{
 const e=state(); const a=e.combatants[0].attacks.find(a=>a.kind==='ranged' && /javelin/i.test(a.id));
 const item=e.combatants[0].inventory.find(item=>item.attackIds.includes(a.id));
 const r=resolveAttackRoll(e,a,()=>0.9);assert.equal(r.legal,true);
 assert.equal(r.encounter.combatants[0].inventory.find(i=>i.id===item.id).current,item.current-1);
 assert.equal(r.encounter.combatants[0].heldWeaponIds.includes(item.id),false);
});
test('an attack with an already-held weapon leaves exactly one equipment change afterward',()=>{
 let e=handleWeapon(state(),source.id,'glaive').encounter;e.combatants.forEach(c=>c.initiativeRolled=true);
 e.turn.objectInteractionUsed=true;
 e=resolveAttackRoll(e,attack(e,'glaive'),()=>0.9).encounter;
 assert.equal(e.turn.attackEquipmentChangeAvailable,true);
 const r=handleWeapon(e,source.id,'glaive');assert.equal(r.legal,true);
 assert.equal(r.encounter.turn.attackEquipmentChangeAvailable,false);
 assert.equal(handleWeapon(r.encounter,source.id,'longsword').legal,false);
});
