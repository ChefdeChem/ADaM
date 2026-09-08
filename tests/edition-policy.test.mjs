import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_CHARACTERS } from '../src/characters/built-ins.ts';
import { detectCharacterEdition, playableCharacter, createPlayableEncounter } from '../src/rulesets/edition-policy.ts';
import { generateScriptedScenario } from '../src/scenarios/scripted-generator.ts';
import { executeFeatureAction } from '../src/engine/feature-actions.ts';
import { applyEffect, expireEffectsAtTurnStart } from '../src/engine/effects.ts';
import { buildCharacterMechanicCoverage } from '../src/rules-registry/index.ts';
const source = BUILT_IN_CHARACTERS.find(c => c.id === 'surina-daardendrian');
const scenario = () => generateScriptedScenario({ prompt: '', environment: 'market', objective: 'defeat', difficulty: 'easy' });
function ready() {
 const e = createPlayableEncounter(source, scenario());
 return {...e, combatants:e.combatants.map((c,i)=>({...c, initiativeRolled:true, position:{x:1+i,y:1}})), map:{...e.map,terrain:[]}};
}
test('detects unlabelled legacy Paladin using feature evidence without changing the source',()=>{
 const c=structuredClone(source); delete c.rulesetId;
 assert.equal(detectCharacterEdition(c).edition,'dnd-2014');
 assert.equal(c.rulesetId,undefined);
});
test('generic sheet and weapon wording do not invent an edition or a mastery',()=>{
 const c={...source,rulesetId:undefined,className:'Fighter',featureActions:[],profile:{features:[]}};
 assert.equal(detectCharacterEdition(c).edition,'uncertain');
 assert.equal(playableCharacter(c).character.attacks.some(a=>a.mastery),false);
});
test('conflicting class evidence is reported as mixed',()=>{
 assert.equal(detectCharacterEdition({...source,rulesetId:'dnd-2024'}).edition,'mixed');
});
test('resolution profiles preserve imported data, feature grants, spells and resources',()=>{
 const before=JSON.stringify(source), p=playableCharacter(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(p.character.rulesetId,'dnd-2014');
 assert.deepEqual(p.character.resources,source.resources);
 assert.deepEqual(p.character.spells,source.spells);
 assert.deepEqual(p.character.featureActions.map(f=>f.id),source.featureActions.map(f=>f.id));
 assert.ok(p.notes.some(n=>n.includes('Channel Divinity')));
 assert.equal(createPlayableEncounter(source,scenario()).combatants[0].rulesetId,'dnd-2024');
});
test('Surina playable profile distinguishes an imported mastery label from a granted feature',()=>{
 const before=JSON.stringify(source), playable=playableCharacter(source).character;
 assert.match(source.attacks.find(a=>a.id==='glaive').description,/Graze/);
 assert.doesNotMatch(playable.attacks.find(a=>a.id==='glaive').description,/Graze/);
 assert.equal(playable.attacks.find(a=>a.id==='glaive').mastery,undefined);
 assert.deepEqual(buildCharacterMechanicCoverage(playable).supportSummary,{fullySupported:17,partial:0,descriptive:0,needsReview:0});
 assert.equal(JSON.stringify(source),before);
});
test('Lay on Hands uses a Bonus Action, heals Constructs, and spends the original pool',()=>{
 const f=playableCharacter(source).character.featureActions.find(f=>f.name==='Lay on Hands');
 const e=ready(); const actor=e.combatants[0];actor.creatureType='construct';actor.hitPoints.current=1;
 const r=executeFeatureAction(e,f,{targetCombatantId:actor.id,resourceAmount:3});
 assert.equal(r.legal,true);assert.equal(r.encounter.turn.action,true);assert.equal(r.encounter.turn.bonusAction,false);
 assert.equal(r.encounter.combatants[0].hitPoints.current,4);
 assert.equal(r.encounter.combatants[0].resources.find(x=>x.name===f.resourceName).current,2);
});
test('Lay on Hands removes Poisoned using five points and no longer offers disease removal',()=>{
 const f=playableCharacter(source).character.featureActions.find(f=>f.name==='Lay on Hands');
 assert.equal(f.resolution.removesAfflictions,undefined);
 const e=ready();e.combatants[0].conditions=['Poisoned'];
 const r=executeFeatureAction(e,f,{targetCombatantId:source.id,resourceAmount:0,removePoisoned:true});
 assert.equal(r.legal,true);assert.deepEqual(r.encounter.combatants[0].conditions,[]);
});
test('Divine Sense uses original uses with 2024 cost, cover and expiry',()=>{
 const f=playableCharacter(source).character.featureActions.find(f=>f.name==='Divine Sense');
 const e=ready();e.combatants[1].creatureType='undead';
 const r=executeFeatureAction(e,f);
 assert.equal(r.legal,true);assert.equal(r.encounter.turn.action,true);assert.equal(r.encounter.turn.bonusAction,false);
 const effect=r.encounter.effects.find(x=>x.name==='Divine Sense');
 assert.equal(effect.sense.blockedByTotalCover,false);assert.equal(effect.expiresAt.round,101);
 assert.equal(r.encounter.combatants[0].resources.find(x=>x.name===f.resourceName).current,2);
 const expired=expireEffectsAtTurnStart({...r.encounter,round:101},101,source.id);
 assert.equal(expired.effects.some(x=>x.name==='Divine Sense'),false);
});
test('Divine Sense ends when Incapacitated',()=>{
 const f=playableCharacter(source).character.featureActions.find(f=>f.name==='Divine Sense');
 const r=executeFeatureAction(ready(),f);
 const e=applyEffect(r.encounter,{name:'Stunned',description:'test',sourceCombatantId:source.id,targetCombatantId:source.id,conditionGranted:'Stunned'});
 assert.equal(e.effects.some(x=>x.name==='Divine Sense'),false);
});
