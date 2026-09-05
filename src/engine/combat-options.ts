import type { CharacterAttack, CharacterSpell } from "../domain/character";
import type { EncounterState } from "../domain/combat";
import { rollD20, rollDamage, type D20Result, type DamageRoll, type RollMode } from "./dice";
import { activeWeaponDamageBonus, applyEffect, canHarmTarget, canRegainHitPoints, consumeAttackRollEffects, effectiveArmorClass, effectiveAttackModifier, effectiveDamageAmount, effectiveSavingThrowModifier, endEffectsBrokenByHarm, extendRage, nextTurnRound, outgoingAttackRollMode, savingThrowRollMode } from "./effects";
import { spendNamedResource, spendSpellSlot, validateNamedResource, validateSpellSlot } from "./resources";
import { attackInventoryAvailable, consumeAttackInventory } from "./inventory";
import { analyzeTarget, gridDistanceFeet, hasLineOfSightToPoint } from "./targeting";
import { areaTargets, pushTargetAway, validateAreaAim } from "./areas";
import { canCastSpells, effectHasStarted, isIncapacitated, reconcileConcentration } from "./effects";

export type OptionValidation = {
  legal: boolean;
  reason?: string;
  rollMode?: RollMode;
  distanceFeet?: number;
};

export type OptionResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; encounter: EncounterState; roll: D20Result | DamageRoll | null; summary: string };

export type SpellCastingResourceChoice = "free-cast" | "spell-slot";

export function spellCastingResourceOptions(encounter: EncounterState, spell: CharacterSpell): { freeCast: boolean; spellSlot: boolean } {
  const active = encounter.combatants[encounter.activeIndex];
  return {
    freeCast: Boolean(spell.freeCastResourceName && validateNamedResource(encounter, active.id, spell.freeCastResourceName, 1).legal),
    spellSlot: validateSpellSlot(encounter, active.id, spell.level).legal,
  };
}

export function validateAttackChoice(encounter: EncounterState, attack: CharacterAttack): OptionValidation {
  if (!encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (!encounter.selectedTargetId) return { legal: false, reason: "Select a target on the tactical map first." };
  const analysis = analyzeTarget(encounter, encounter.selectedTargetId);
  if (!analysis) return { legal: false, reason: "The selected target is no longer available." };
  if (analysis.target.hitPoints.current <= 0) return { legal: false, reason: `${analysis.target.name} is already defeated.` };
  const active = encounter.combatants[encounter.activeIndex];
  if (!attackInventoryAvailable(encounter, active.id, attack.id)) return { legal: false, reason: `${attack.name} is no longer in your carried inventory.` };
  if (!canHarmTarget(encounter, active.id, analysis.target.id)) return { legal: false, reason: `${active.name} is charmed and cannot attack ${analysis.target.name}.` };
  if (!analysis.lineOfSight) return { legal: false, reason: `${analysis.target.name} is outside your line of sight.` };
  const maximumRange = attack.longRangeFeet ?? attack.normalRangeFeet;
  if (analysis.distanceFeet > maximumRange) return { legal: false, reason: `${analysis.target.name} is ${analysis.distanceFeet} feet away; ${attack.name} reaches ${maximumRange} feet.` };
  const longRange = attack.kind === "ranged" && analysis.distanceFeet > attack.normalRangeFeet;
  const threatened = attack.kind === "ranged" && encounter.combatants.some((combatant) => combatant.side !== active.side
    && combatant.hitPoints.current > 0
    && gridDistanceFeet(active, combatant) <= 5);
  const situationalMode = longRange || threatened || active.weaponAttackDisadvantage ? "disadvantage" : "normal";
  return { legal: true, rollMode: outgoingAttackRollMode(encounter, active.id, analysis.target.id, situationalMode), distanceFeet: analysis.distanceFeet };
}

export function validateAttackTarget(encounter:EncounterState,attack:CharacterAttack,targetId:string):OptionValidation{
  return validateAttackChoice({...encounter,selectedTargetId:targetId},attack);
}

export type AttackRollResolution=
  |{legal:false;reason:string;encounter:EncounterState}
  |{legal:true;encounter:EncounterState;roll:D20Result;hit:boolean;critical:boolean;targetArmorClass:number;summary:string};

export function resolveAttackRoll(encounter:EncounterState,attack:CharacterAttack,random=Math.random):AttackRollResolution{
  const validation=validateAttackChoice(encounter,attack);
  if(!validation.legal)return{legal:false,reason:validation.reason??"That attack is not legal.",encounter};
  const active=encounter.combatants[encounter.activeIndex];
  const target=analyzeTarget(encounter,encounter.selectedTargetId!)!;
  const roll=rollD20({mode:validation.rollMode??"normal",modifier:attack.attackBonus+effectiveAttackModifier(encounter,active.id),random});
  const targetArmorClass=effectiveArmorClass(encounter,target.target.id)+(target.cover==="half"?2:0);
  const critical=roll.natural===20;
  const hit=critical||(roll.natural!==1&&roll.total>=targetArmorClass);
  const rangeNote=validation.rollMode==="disadvantage"?" with disadvantage":"";
  const summary=`${attack.name}${rangeNote}: ${roll.rolls.join(" / ")} ${roll.modifier>=0?"+":"−"} ${Math.abs(roll.modifier)} = ${roll.total} vs AC ${targetArmorClass} — ${critical?"critical hit":hit?"hit":"miss"}.`;
  let next=consumeAttackRollEffects(encounter,active.id,target.target.id);
  next=consumeAttackInventory(next,active.id,attack.id);
  if(active.side!==target.target.side)next=extendRage(next,active.id);
  if(hit&&attack.mastery==="sap"){
    next=applyEffect(next,{
      name:"Sap",
      description:"Disadvantage on the next attack roll before the start of the attacker's next turn.",
      sourceCombatantId:active.id,
      targetCombatantId:target.target.id,
      modifiers:{outgoingAttacks:"disadvantage"},
      expiresAt:{round:nextTurnRound(encounter,active.id),combatantId:active.id,phase:"start"},
      consumeOnAttackRoll:true,
      replaceExisting:true,
    });
  }
  if(hit&&attack.kind==="melee"&&active.side==="player"&&!next.pendingResponse){
    const triggeredSpell=active.spells.find((spell)=>spell.trigger==="after-melee-hit"
      &&validateSpellSlot(next,active.id,spell.level).legal);
    if(triggeredSpell&&next.turn.bonusAction){
      next={...next,pendingResponse:{
        type:"post-hit-spell-choice",
        sourceCombatantId:active.id,
        targetCombatantId:target.target.id,
        spellId:triggeredSpell.id,
        attackName:attack.name,
        critical,
      }};
    }
  }
  return{legal:true,roll,hit,critical,targetArmorClass,summary,encounter:{...next,turn:{...next.turn,action:false},log:[`${active.name} attacks ${target.target.name}. ${summary}`,...next.log]}};
}

export type ReactionAttackRollResolution=
  |{legal:false;reason:string;encounter:EncounterState}
  |{legal:true;encounter:EncounterState;roll:D20Result;hit:boolean;critical:boolean;targetArmorClass:number;summary:string};

export function resolveReactionAttackRoll(encounter:EncounterState,attackerId:string,targetId:string,attack:CharacterAttack,random=Math.random):ReactionAttackRollResolution{
  const attacker=encounter.combatants.find((combatant)=>combatant.id===attackerId);
  const target=encounter.combatants.find((combatant)=>combatant.id===targetId);
  if(!attacker||!target)return{legal:false,reason:"The opportunity attack can no longer be resolved.",encounter};
  if(!canHarmTarget(encounter,attackerId,targetId))return{legal:false,reason:`${attacker.name} is charmed and cannot attack ${target.name}.`,encounter};
  if(!attacker.reactionAvailable)return{legal:false,reason:`${attacker.name}'s reaction is unavailable.`,encounter};
  if(attack.kind!=="melee")return{legal:false,reason:"Opportunity attacks require a melee attack.",encounter};
  if(gridDistanceFeet(attacker,target)>attack.normalRangeFeet)return{legal:false,reason:`${target.name} is outside ${attack.name}'s reach.`,encounter};
  const rollMode=outgoingAttackRollMode(encounter,attacker.id,target.id,attacker.weaponAttackDisadvantage?"disadvantage":"normal");
  const roll=rollD20({mode:rollMode,modifier:attack.attackBonus+effectiveAttackModifier(encounter,attacker.id),random});
  const targetArmorClass=effectiveArmorClass(encounter,target.id);
  const critical=roll.natural===20;
  const hit=critical||(roll.natural!==1&&roll.total>=targetArmorClass);
  const summary=`Opportunity attack with ${attack.name}${rollMode==="disadvantage"?" with disadvantage":""}: ${roll.rolls.join(" / ")} ${roll.modifier>=0?"+":"−"} ${Math.abs(roll.modifier)} = ${roll.total} vs AC ${targetArmorClass} — ${critical?"critical hit":hit?"hit":"miss"}.`;
  let next=consumeAttackRollEffects(encounter,attacker.id,target.id);
  if(attacker.side!==target.side)next=extendRage(next,attacker.id);
  if(hit&&attack.mastery==="sap"){
    next=applyEffect(next,{
      name:"Sap",
      description:"Disadvantage on the next attack roll before the start of the attacker's next turn.",
      sourceCombatantId:attacker.id,
      targetCombatantId:target.id,
      modifiers:{outgoingAttacks:"disadvantage"},
      expiresAt:{round:nextTurnRound(encounter,attacker.id),combatantId:attacker.id,phase:"start"},
      consumeOnAttackRoll:true,
      replaceExisting:true,
    });
  }
  return{legal:true,roll,hit,critical,targetArmorClass,summary,encounter:{
    ...next,
    combatants:next.combatants.map((combatant)=>combatant.id===attacker.id?{...combatant,reactionAvailable:false}:combatant),
    log:[`${attacker.name} reacts as ${target.name} leaves its reach. ${summary}`,...next.log],
  }};
}

export type DamageResolution=
  |{legal:false;reason:string;encounter:EncounterState}
  |{legal:true;encounter:EncounterState;roll:DamageRoll;alternateRoll?:DamageRoll;damageApplied:number;summary:string};

export function applyDamageToCombatant(encounter:EncounterState,targetId:string,amount:number,{critical=false,allowDamageReduction=true,damageType,sourceCombatantId}:{critical?:boolean;allowDamageReduction?:boolean;damageType?:string;sourceCombatantId?:string}={}):EncounterState{
  if(sourceCombatantId&&amount>0){
    const afterBrokenEffects=endEffectsBrokenByHarm(encounter,sourceCombatantId,targetId);
    if(afterBrokenEffects!==encounter)return applyDamageToCombatant(afterBrokenEffects,targetId,amount,{critical,allowDamageReduction,damageType,sourceCombatantId});
  }
  const target=encounter.combatants.find((combatant)=>combatant.id===targetId);
  if(!target)return encounter;
  const reduction=allowDamageReduction&&(target.triggeredFeatures??[]).find((feature)=>feature.trigger==="takes-damage"
    &&feature.resolution.type==="reduce-damage-by-roll"
    &&target.reactionAvailable
    &&Boolean(feature.resourceName)
    &&feature.resourceCost!==undefined
    &&validateNamedResource(encounter,target.id,feature.resourceName!,feature.resourceCost).legal);
  if(target.side==="player"&&amount>0&&reduction){
    const summary=`${target.name} is about to take ${amount} damage and can use ${reduction.name} to reduce it.`;
    return{
      ...encounter,
      pendingResponse:{type:"damage-reduction-reaction",targetCombatantId:target.id,featureId:reduction.id,damageTaken:amount,damageType,sourceCombatantId,critical},
      log:[summary,...encounter.log],
    };
  }
  const effectiveAmount=effectiveDamageAmount(encounter,target.id,amount,damageType);
  const absorbed=Math.min(target.temporaryHitPoints,effectiveAmount);
  const hitPointDamage=effectiveAmount-absorbed;
  const reducedToZero=target.hitPoints.current>0&&hitPointDamage>=target.hitPoints.current;
  const killedOutright=reducedToZero&&hitPointDamage-target.hitPoints.current>=target.hitPoints.maximum;
  const replacement=(target.triggeredFeatures??[]).find((feature)=>feature.trigger==="reduced-to-zero-hit-points"
    &&Boolean(feature.resourceName)
    &&feature.resourceCost!==undefined
    &&validateNamedResource(encounter,target.id,feature.resourceName!,feature.resourceCost).legal);
  const shouldOfferReplacement=target.side==="player"&&reducedToZero&&!killedOutright&&Boolean(replacement);
  let combatants=encounter.combatants.map((combatant)=>{
    if(combatant.id!==targetId)return combatant;
    if(combatant.side==="player"&&combatant.hitPoints.current===0&&hitPointDamage>0){
      return{...combatant,temporaryHitPoints:combatant.temporaryHitPoints-absorbed,deathSaves:{...combatant.deathSaves,failures:Math.min(3,combatant.deathSaves.failures+(critical?2:1))}};
    }
    return{...combatant,temporaryHitPoints:combatant.temporaryHitPoints-absorbed,hitPoints:{...combatant.hitPoints,current:Math.max(0,combatant.hitPoints.current-hitPointDamage)},stabilized:false};
  });
  const source=sourceCombatantId?encounter.combatants.find((combatant)=>combatant.id===sourceCombatantId):undefined;
  const defeatTrigger=source&&source.side!==target.side&&reducedToZero
    ?source.triggeredFeatures.find((feature)=>feature.trigger==="reduces-hostile-to-zero-hit-points"&&feature.resolution.type==="gain-temporary-hit-points")
    :undefined;
  let defeatSummary:string|null=null;
  if(source&&defeatTrigger?.resolution.type==="gain-temporary-hit-points"){
    const temporaryHitPoints=defeatTrigger.resolution.amount;
    combatants=combatants.map((combatant)=>combatant.id===source.id&&temporaryHitPoints>combatant.temporaryHitPoints
      ?{...combatant,temporaryHitPoints,temporaryHitPointsSourceEffectId:undefined}
      :combatant);
    defeatSummary=`${source.name}'s ${defeatTrigger.name} grants ${temporaryHitPoints} temporary hit points.`;
  }
  if(shouldOfferReplacement&&replacement){
    const summary=`${target.name} was reduced to 0 HP and can use ${replacement.name} to drop to 1 HP instead.`;
    return{
      ...encounter,
      combatants,
      pendingResponse:{type:"zero-hit-point-replacement",targetCombatantId:target.id,featureId:replacement.id,damageTaken:hitPointDamage},
      log:[summary,...(defeatSummary?[defeatSummary]:[]),...encounter.log],
    };
  }
  const resistanceSummary=effectiveAmount<amount
    ?`${target.name}'s damage resistance reduces ${amount} ${damageType} damage to ${effectiveAmount}.`
    :null;
  return reconcileConcentration({
    ...encounter,
    combatants,
    log:[...(defeatSummary?[defeatSummary]:[]),...(resistanceSummary?[resistanceSummary]:[]),...encounter.log],
  });
}

function attackSourceId(encounter:EncounterState,attack:CharacterAttack,targetId:string):string|undefined{
  const active=encounter.combatants[encounter.activeIndex];
  if(active&&active.id!==targetId&&(active.attacks.some((candidate)=>candidate.id===attack.id)||!encounter.combatants.some((combatant)=>combatant.attacks.some((candidate)=>candidate.id===attack.id))))return active.id;
  return encounter.combatants.find((combatant)=>combatant.id!==targetId&&combatant.attacks.some((candidate)=>candidate.id===attack.id))?.id;
}

export function resolveAttackDamage(encounter:EncounterState,attack:CharacterAttack,targetId:string,critical=false,random=Math.random,sourceCombatantId=attackSourceId(encounter,attack,targetId),options:{weaponDamageRerollChoice?:"first"|"second"|"higher"|"skip"}={}):DamageResolution{
  let roll=rollDamage(attack.damage,{critical,random});
  if(!roll)return{legal:false,reason:`ADaM could not read the damage formula “${attack.damage}”.`,encounter};
  const target=encounter.combatants.find((combatant)=>combatant.id===targetId);
  if(!target)return{legal:false,reason:"The target is no longer available.",encounter};
  const sourceBefore=sourceCombatantId?encounter.combatants.find((combatant)=>combatant.id===sourceCombatantId):undefined;
  const rageDamageBonus=sourceBefore?activeWeaponDamageBonus(encounter,sourceBefore.id,attack.ability):0;
  const featureId=sourceBefore?.weaponDamageRerollFeatureId;
  const canReroll=Boolean(featureId&&attack.id!=="unarmed-strike"&&roll.formula.diceCount>0&&sourceBefore?.attacks.some((candidate)=>candidate.id===attack.id)&&!encounter.turn.usedFeatureIds.includes(featureId));
  let alternateRoll:DamageRoll|undefined;
  if(canReroll&&options.weaponDamageRerollChoice&&options.weaponDamageRerollChoice!=="skip"){
    alternateRoll=rollDamage(attack.damage,{critical,random})??undefined;
    if(alternateRoll&&(options.weaponDamageRerollChoice==="second"||(options.weaponDamageRerollChoice==="higher"&&alternateRoll.total>roll.total)))roll=alternateRoll;
    encounter={...encounter,turn:{...encounter.turn,usedFeatureIds:[...encounter.turn.usedFeatureIds,featureId!]}};
  }
  // The choice concerns weapon dice. Apply the same static Rage bonus after either choice.
  if(rageDamageBonus)roll={...roll,modifier:roll.modifier+rageDamageBonus,total:roll.total+rageDamageBonus};
  let damaged=applyDamageToCombatant(encounter,targetId,roll.total,{critical,damageType:roll.formula.damageType,sourceCombatantId});
  const damageApplied=damaged.pendingResponse?.type==="damage-reduction-reaction"
    ?roll.total
    :effectiveDamageAmount(encounter,targetId,roll.total,roll.formula.damageType);
  const dice=`${roll.rolls.join(" + ")}${roll.modifier===0?"":` ${roll.modifier>0?"+":"−"} ${Math.abs(roll.modifier)}`}`;
  const resistanceCopy=damageApplied<roll.total?`; ${damageApplied} applied after resistance`:"";
  const rerollCopy=alternateRoll?` Savage Attacker rolled ${alternateRoll.total} as the alternative.`:"";
  const summary=`${critical?"Critical damage":`${attack.name} damage`}: ${dice} = ${roll.total} ${roll.formula.damageType} to ${target.name}${resistanceCopy}.${rerollCopy}`;
  const source=sourceCombatantId?encounter.combatants.find((combatant)=>combatant.id===sourceCombatantId):undefined;
  const updatedTarget=damaged.combatants.find((combatant)=>combatant.id===targetId);
  if((attack.mastery==="slow"||attack.mastery==="topple")&&source?.side==="player"&&(attack.mastery==="topple"||damageApplied>0)&&(updatedTarget?.hitPoints.current??0)>0&&!damaged.pendingResponse){
    damaged={...damaged,pendingResponse:{
      type:"weapon-mastery-choice",
      mastery:attack.mastery,
      sourceCombatantId:source.id,
      targetCombatantId:targetId,
      attackName:attack.name,
      expiresAt:attack.mastery==="slow"?{round:nextTurnRound(encounter,source.id),combatantId:source.id,phase:"start"}:undefined,
      saveDc:attack.mastery==="topple"?8+(source.abilityModifiers[attack.ability??"strength"]??0)+source.proficiencyBonus:undefined,
    }};
  }
  return{legal:true,roll,alternateRoll,damageApplied,summary,encounter:{...damaged,log:[summary,...damaged.log]}};
}

export function executeAttackChoice(encounter: EncounterState, attack: CharacterAttack, random = Math.random): OptionResolution {
  const validation = validateAttackChoice(encounter, attack);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That attack is not legal.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const target = analyzeTarget(encounter, encounter.selectedTargetId!)!;
  const roll = rollD20({ mode: validation.rollMode ?? "normal", modifier: attack.attackBonus + effectiveAttackModifier(encounter, active.id), random });
  const rangeNote = validation.rollMode === "disadvantage" ? " with disadvantage" : "";
  const summary = `${attack.name} against ${target.target.name}${rangeNote}: ${roll.total} (${roll.kept} + ${roll.modifier}).`;
  const next = consumeAttackInventory(encounter, active.id, attack.id);
  return {
    legal: true,
    roll,
    summary,
    encounter: {
      ...next,
      turn: { ...next.turn, action: false },
      log: [`${active.name}: ${summary}`, ...next.log],
    },
  };
}

export function validateSpellAvailability(encounter: EncounterState, spell: CharacterSpell): OptionValidation {
  const active = encounter.combatants[encounter.activeIndex];
  if (active?.spellcastingBlockedByArmor) return { legal: false, reason: `${active.name} cannot cast spells while wearing armor without training.` };
  if (!active || !canCastSpells(encounter, active.id)) return { legal: false, reason: "Spells cannot be cast while incapacitated or while Rage is active." };
  if (spell.unsupportedReason) return { legal: false, reason: spell.unsupportedReason };
  if (spell.trigger === "after-melee-hit") return { legal: false, reason: `${spell.name} becomes available immediately after you hit with a melee weapon or Unarmed Strike.` };
  if (spell.castingTime === "reaction") return { legal: false, reason: `${spell.name} becomes available automatically when its reaction trigger occurs.` };
  if (spell.castingTime === "action" && !encounter.turn.action) return { legal: false, reason: "Your Action has already been used this turn." };
  if (spell.castingTime === "bonus-action" && !encounter.turn.bonusAction) return { legal: false, reason: "Your Bonus Action has already been used this turn." };
  const choices = spellCastingResourceOptions(encounter, spell);
  if (!choices.freeCast && !choices.spellSlot) {
    const slot = validateSpellSlot(encounter, active.id, spell.level);
    return { legal: false, reason: spell.freeCastResourceName ? `${spell.freeCastResourceName} and level ${spell.level} spell slots are both unavailable.` : !slot.legal ? slot.reason : "No casting resource is available." };
  }
  return { legal: true, rollMode: "normal", distanceFeet: 0 };
}

export function validateSpellChoice(encounter: EncounterState, spell: CharacterSpell): OptionValidation {
  const availability = validateSpellAvailability(encounter, spell);
  if (!availability.legal) return availability;
  if (spell.target === "point") return { legal: false, reason: `Choose one or more map points for ${spell.name}.` };
  if (spell.target === "area") {
    if (!spell.area) return { legal: false, reason: `${spell.name} has no registered area.` };
    if (!encounter.selectedTargetId) return { legal: false, reason: "Select a creature to set the area's direction." };
    const active = encounter.combatants[encounter.activeIndex];
    const aim = encounter.combatants.find((combatant) => combatant.id === encounter.selectedTargetId);
    if (spell.targetSide === "hostile" && aim?.side === active.side) return { legal: false, reason: `${spell.name} requires a hostile creature to set its direction.` };
    return validateAreaAim(encounter, active.id, encounter.selectedTargetId, spell.area);
  }
  if (spell.target === "single" || spell.target === "self-or-single") {
    if (!encounter.selectedTargetId) return { legal: false, reason: "Select a target on the tactical map first." };
    const active = encounter.combatants[encounter.activeIndex];
    if (encounter.selectedTargetId === active.id) {
      if (spell.target !== "self-or-single" || spell.targetSide === "hostile") return { legal: false, reason: `${spell.name} cannot target the caster.` };
      if (spell.healing && !canRegainHitPoints(encounter, active.id)) return { legal: false, reason: `${active.name} cannot regain Hit Points right now.` };
      return { legal: true, rollMode: "normal", distanceFeet: 0 };
    }
    const analysis = analyzeTarget(encounter, encounter.selectedTargetId);
    if (!analysis) return { legal: false, reason: "The selected target is no longer available." };
    const harmful = Boolean(spell.damage || spell.attackBonus !== undefined || spell.save || spell.targetSide === "hostile");
    if (harmful && !canHarmTarget(encounter, active.id, analysis.target.id)) return { legal: false, reason: "A Charmed creature cannot target its charmer with harmful magic." };
    if (spell.requiresTargetHearing && analysis.target.conditions.some((condition) => condition.toLowerCase() === "deafened")) return { legal: false, reason: `${analysis.target.name} cannot hear ${spell.name}.` };
    if (analysis.target.hitPoints.current <= 0 && !spell.healing) return { legal: false, reason: `${analysis.target.name} is already defeated.` };
    if (spell.requiresLineOfSight && !analysis.lineOfSight) return { legal: false, reason: `${analysis.target.name} is outside your line of sight.` };
    if (analysis.distanceFeet > spell.rangeFeet) return { legal: false, reason: `${analysis.target.name} is ${analysis.distanceFeet} feet away; ${spell.name} reaches ${spell.rangeFeet} feet.` };
    if (spell.targetSide === "hostile" && analysis.target.side === active.side) return { legal: false, reason: `${spell.name} requires a hostile target.` };
    if (spell.targetSide === "friendly" && analysis.target.side !== active.side) return { legal: false, reason: `${spell.name} requires a friendly target.` };
    if (spell.healing && !canRegainHitPoints(encounter, analysis.target.id)) return { legal: false, reason: `${analysis.target.name} cannot regain Hit Points right now.` };
    if (spell.targetCreatureTypes?.length && !spell.targetCreatureTypes.some((creatureType) => creatureType.toLowerCase() === analysis.target.creatureType?.toLowerCase())) {
      return { legal: false, reason: `${spell.name} can target only ${spell.targetCreatureTypes.join(" or ")}, not ${analysis.target.creatureType ?? "an unknown creature type"}.` };
    }
    const threatened = spell.attackBonus !== undefined && encounter.combatants.some((combatant) => combatant.side !== active.side
      && combatant.hitPoints.current > 0
      && gridDistanceFeet(active, combatant) <= 5);
    return { legal: true, rollMode: outgoingAttackRollMode(encounter, active.id, analysis.target.id, threatened ? "disadvantage" : "normal"), distanceFeet: analysis.distanceFeet };
  }
  return { legal: true, rollMode: "normal", distanceFeet: 0 };
}

export function validateSpellTarget(encounter: EncounterState, spell: CharacterSpell, targetId: string): OptionValidation {
  return validateSpellChoice({ ...encounter, selectedTargetId: targetId }, spell);
}

export type SpellAttackRollResolution =
  | { legal: false; reason: string; encounter: EncounterState }
  | { legal: true; encounter: EncounterState; roll: D20Result; hit: boolean; critical: boolean; targetArmorClass: number; summary: string };

export function resolveSpellAttackRoll(encounter: EncounterState, spell: CharacterSpell, random = Math.random): SpellAttackRollResolution {
  const validation = validateSpellChoice(encounter, spell);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That spell attack is not legal.", encounter };
  if (spell.attackBonus === undefined) return { legal: false, reason: `${spell.name} does not require an attack roll.`, encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const target = analyzeTarget(encounter, encounter.selectedTargetId!)!;
  const rollMode = validation.rollMode ?? outgoingAttackRollMode(encounter, active.id, target.target.id);
  const roll = rollD20({ mode: rollMode, modifier: spell.attackBonus + effectiveAttackModifier(encounter, active.id), random });
  const targetArmorClass = effectiveArmorClass(encounter, target.target.id) + (target.cover === "half" ? 2 : 0);
  const critical = roll.natural === 20;
  const hit = critical || (roll.natural !== 1 && roll.total >= targetArmorClass);
  let next = consumeAttackRollEffects(encounter, active.id, target.target.id);
  next = spendSpellSlot(next, active.id, spell.level);
  next = {
    ...next,
    turn: {
      ...next.turn,
      action: spell.castingTime === "action" ? false : next.turn.action,
      bonusAction: spell.castingTime === "bonus-action" ? false : next.turn.bonusAction,
      reaction: spell.castingTime === "reaction" ? false : next.turn.reaction,
    },
  };
  const rangeNote = rollMode === "disadvantage" ? " with disadvantage" : "";
  const summary = `${spell.name}${rangeNote}: ${roll.rolls.join(" / ")} ${roll.modifier >= 0 ? "+" : "−"} ${Math.abs(roll.modifier)} = ${roll.total} vs AC ${targetArmorClass} — ${critical ? "critical hit" : hit ? "hit" : "miss"}.`;
  return { legal: true, roll, hit, critical, targetArmorClass, summary, encounter: { ...next, log: [`${active.name} casts ${spell.name} at ${target.target.name}. ${summary}`, ...next.log] } };
}

export function resolveSpellDamage(encounter: EncounterState, spell: CharacterSpell, targetId: string, critical = false, random = Math.random): DamageResolution {
  if (!spell.damage) return { legal: false, reason: `${spell.name} does not have a damage roll.`, encounter };
  const result = resolveAttackDamage(encounter, {
    id: spell.id,
    name: spell.name,
    kind: "ranged",
    attackBonus: spell.attackBonus ?? 0,
    damage: spell.damage,
    normalRangeFeet: spell.rangeFeet,
  }, targetId, critical, random);
  if (!result.legal || !spell.onHitEffect) return result;
  const source = encounter.combatants[encounter.activeIndex];
  const target = result.encounter.combatants.find((combatant) => combatant.id === targetId);
  if (!source || !target) return result;
  let next = result.encounter;
  if (spell.onHitEffect.preventsHealing) {
    next = applyEffect(next, {
      name: `${spell.name}: Healing Prevention`,
      magical: true,
      description: `The target cannot regain Hit Points until the start of ${source.name}'s next turn.`,
      sourceCombatantId: source.id,
      targetCombatantId: target.id,
      modifiers: { healingPrevented: true },
      expiresAt: { round: nextTurnRound(encounter, source.id), combatantId: source.id, phase: "start" },
      replaceExisting: true,
    });
  }
  if (spell.onHitEffect.undeadTargetDisadvantageAgainstCaster && target.creatureType?.toLowerCase() === "undead") {
    next = applyEffect(next, {
      name: `${spell.name}: Undead Disadvantage`,
      description: `The undead target has disadvantage on attack rolls against ${source.name} until the end of ${source.name}'s next turn.`,
      sourceCombatantId: source.id,
      targetCombatantId: target.id,
      attackTargetId: source.id,
      modifiers: { outgoingAttacks: "disadvantage" },
      expiresAt: { round: nextTurnRound(encounter, source.id), combatantId: source.id, phase: "end" },
      replaceExisting: true,
    });
  }
  return { ...result, encounter: next };
}

function effectExpiration(encounter: EncounterState, spell: CharacterSpell, casterId: string, targetId: string) {
  if (spell.effect?.expires === "end-of-target-next-turn") return { round: nextTurnRound(encounter, targetId), combatantId: targetId, phase: "end" as const };
  if (spell.effect?.expires === "start-of-caster-next-turn") return { round: nextTurnRound(encounter, casterId), combatantId: casterId, phase: "start" as const };
  if (spell.effect?.expires === "end-of-caster-next-turn") return { round: nextTurnRound(encounter, casterId), combatantId: casterId, phase: "end" as const };
  return undefined;
}

function applySpellEffect(encounter: EncounterState, spell: CharacterSpell, casterId: string, spellTargetId: string): EncounterState {
  if (!spell.effect) return encounter;
  const effectTargetId = spell.effect.applyTo === "caster" ? casterId : spellTargetId;
  return applyEffect(encounter, {
    ...spell.effect,
    magical: true,
    sourceCombatantId: casterId,
    targetCombatantId: effectTargetId,
    attackTargetId: spell.effect.attackTarget === "spell-target" ? spellTargetId : undefined,
    startsAt: spell.effect.starts === "start-of-caster-next-turn"
      ? { round: nextTurnRound(encounter, casterId), combatantId: casterId, phase: "start" }
      : undefined,
    durationRounds: spell.durationRounds,
    concentration: spell.concentration,
    expiresAt: effectExpiration(encounter, spell, casterId, spellTargetId),
    replaceExisting: true,
  });
}

export function executeSpellChoice(encounter: EncounterState, spell: CharacterSpell, random = Math.random, options: { castingResource?: SpellCastingResourceChoice } = {}): OptionResolution {
  const validation = validateSpellChoice(encounter, spell);
  if (!validation.legal) return { legal: false, reason: validation.reason ?? "That spell is not legal.", encounter };
  const active = encounter.combatants[encounter.activeIndex];
  const targetId = spell.target === "self" ? active.id : encounter.selectedTargetId!;
  const targetName = encounter.combatants.find((combatant) => combatant.id === targetId)?.name ?? "target";
  const resourceOptions = spellCastingResourceOptions(encounter, spell);
  const castingResource = options.castingResource
    ?? (resourceOptions.freeCast && resourceOptions.spellSlot ? undefined : resourceOptions.freeCast ? "free-cast" : "spell-slot");
  if (!castingResource) return { legal: false, reason: `Choose whether to cast ${spell.name} with ${spell.freeCastResourceName} or a level ${spell.level} spell slot.`, encounter };
  if (castingResource === "free-cast" && !resourceOptions.freeCast) return { legal: false, reason: `${spell.freeCastResourceName ?? "The free cast"} is unavailable.`, encounter };
  if (castingResource === "spell-slot" && !resourceOptions.spellSlot) return { legal: false, reason: `No level ${spell.level} spell slots remain.`, encounter };
  let next = castingResource === "free-cast"
    ? spendNamedResource(encounter, active.id, spell.freeCastResourceName!, 1)
    : spendSpellSlot(encounter, active.id, spell.level);
  next = {
    ...next,
    turn: {
      ...next.turn,
      action: spell.castingTime === "action" ? false : next.turn.action,
      bonusAction: spell.castingTime === "bonus-action" ? false : next.turn.bonusAction,
      reaction: spell.castingTime === "reaction" ? false : next.turn.reaction,
    },
  };
  if (spell.target === "area" && spell.area && spell.save && spell.damage) {
    const targets = areaTargets(next, active.id, targetId, spell.area);
    const damageRoll = rollDamage(spell.damage, { random });
    if (!damageRoll) return { legal: false, reason: `ADaM could not read the damage formula “${spell.damage}”.`, encounter };
    const results: string[] = [];
    for (const target of targets) {
      const saveMode = savingThrowRollMode(next, target.id, undefined, "normal", spell.save.ability);
      const saveRoll = rollD20({ mode: saveMode, modifier: effectiveSavingThrowModifier(next, target.id, spell.save.ability), random });
      const succeeded = saveRoll.total >= spell.save.dc;
      const damage = succeeded
        ? spell.save.damageOnSuccess === "half" ? Math.floor(damageRoll.total / 2) : 0
        : damageRoll.total;
      if (damage > 0) next = applyDamageToCombatant(next, target.id, damage, { damageType: damageRoll.formula.damageType, sourceCombatantId: active.id });
      if (!succeeded && spell.area.pushFeetOnFailedSave) next = pushTargetAway(next, active.id, target.id, spell.area.pushFeetOnFailedSave);
      results.push(`${target.name} ${succeeded ? "succeeds" : "fails"} (${saveRoll.total}) and takes ${effectiveDamageAmount(encounter, target.id, damage, damageRoll.formula.damageType)} damage`);
    }
    const sourceCopy = castingResource === "free-cast" ? spell.freeCastResourceName : `a level ${spell.level} slot`;
    const environmentalCopy = spell.name === "Thunderwave" ? " The thunderous boom is audible to 300 feet, and unsecured objects wholly inside the cube are pushed 10 feet." : "";
    const summary = `${active.name} casts ${spell.name} using ${sourceCopy}; ${damageRoll.total} ${damageRoll.formula.damageType} rolled. ${results.join(";")}.${environmentalCopy}`;
    return { legal: true, roll: damageRoll, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }
  if (spell.save) {
    const target = next.combatants.find((combatant) => combatant.id === targetId);
    if (!target) return { legal: false, reason: "The target is no longer available.", encounter };
    const situationalMode = spell.hostileSaveAdvantage && target.side !== active.side ? "advantage" : "normal";
    const saveMode = savingThrowRollMode(next, targetId, spell.effect?.conditionGranted, situationalMode, spell.save.ability);
    const saveRoll = rollD20({ mode: saveMode, modifier: effectiveSavingThrowModifier(next, targetId, spell.save.ability), random });
    const succeeded = saveRoll.total >= spell.save.dc;
    let damageCopy = "";
    if (spell.damage && (!succeeded || spell.save.damageOnSuccess === "half")) {
      const damageRoll = rollDamage(spell.damage, { random });
      if (!damageRoll) return { legal: false, reason: `ADaM could not read the damage formula “${spell.damage}”.`, encounter };
      const damage = succeeded ? Math.floor(damageRoll.total / 2) : damageRoll.total;
      const damageApplied = effectiveDamageAmount(next, targetId, damage, damageRoll.formula.damageType);
      next = applyDamageToCombatant(next, targetId, damage, { damageType: damageRoll.formula.damageType, sourceCombatantId: active.id });
      damageCopy = ` ${damageApplied} ${damageRoll.formula.damageType} damage${damageApplied < damage ? ` after resistance (${damage} rolled)` : ""}.`;
    }
    if (!succeeded && spell.effect) next = applySpellEffect(next, spell, active.id, targetId);
    const modeCopy = saveMode === "normal" ? "" : ` with ${saveMode}`;
    const summary = `${target.name} rolled ${saveRoll.total}${modeCopy} on the DC ${spell.save.dc} ${spell.save.ability} save against ${spell.name} and ${succeeded ? "succeeded" : "failed"}.${damageCopy}`;
    return { legal: true, roll: saveRoll, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }
  if (spell.healing) {
    const healingRoll = rollDamage(spell.healing, { random });
    if (!healingRoll) return { legal: false, reason: `ADaM could not read the healing formula “${spell.healing}”.`, encounter };
    next = { ...next, combatants: next.combatants.map((combatant) => combatant.id === targetId ? {
      ...combatant,
      hitPoints: { ...combatant.hitPoints, current: Math.min(combatant.hitPoints.maximum, combatant.hitPoints.current + healingRoll.total) },
      deathSaves: combatant.hitPoints.current === 0 ? { successes: 0, failures: 0 } : combatant.deathSaves,
      stabilized: false,
    } : combatant) };
    const summary = `${active.name} casts ${spell.name}; ${targetName} regains ${healingRoll.total} hit points.`;
    return { legal: true, roll: healingRoll, summary, encounter: { ...next, log: [summary, ...next.log] } };
  }
  if (spell.effect) next = applySpellEffect(next, spell, active.id, targetId);
  if (spell.effect?.dashOnCast) next = { ...next, turn: { ...next.turn, movementRemaining: next.turn.movementRemaining + next.combatants.find((combatant) => combatant.id === active.id)!.baseSpeedFeet } };
  const roll = spell.attackBonus === undefined
    ? null
    : rollD20({ mode: outgoingAttackRollMode(next, active.id, targetId), modifier: spell.attackBonus + effectiveAttackModifier(next, active.id), random });
  if (roll) next = consumeAttackRollEffects(next, active.id, targetId);
  const slotCopy = spell.level === 0 ? "cantrip" : castingResource === "free-cast" ? spell.freeCastResourceName! : `level ${spell.level} slot`;
  const rollCopy = roll ? ` Attack roll: ${roll.total} (${roll.kept} + ${roll.modifier}).` : "";
  const detectedMagic = spell.effect?.senseMagic
    ? next.map.terrain.filter((cell) => cell.magicAura
      && Math.max(Math.abs(active.position.x - cell.x), Math.abs(active.position.y - cell.y)) * 5 <= spell.effect!.senseMagic!.rangeFeet
      && (!spell.effect!.senseMagic!.blockedByTotalCover || hasLineOfSightToPoint(next, active.id, cell.x, cell.y)))
    : [];
  const detectedSpellEffect = spell.effect?.senseMagic && next.effects.some((effect) => {
    if (!effect.magical || effect.senseMagic || !effectHasStarted(next, effect)) return false;
    const target = next.combatants.find((candidate) => candidate.id === effect.targetCombatantId);
    return (effect.points ?? (target ? [target.position] : [])).some((point) => Math.max(Math.abs(active.position.x - point.x), Math.abs(active.position.y - point.y)) * 5 <= spell.effect!.senseMagic!.rangeFeet
      && (!spell.effect!.senseMagic!.blockedByTotalCover || hasLineOfSightToPoint(next, active.id, point.x, point.y)));
  });
  const detectionCopy = spell.effect?.senseMagic
    ? detectedMagic.length || detectedSpellEffect ? " Magic is present within range." : " No registered magic is present within range."
    : "";
  const summary = `${spell.name} cast on ${targetName} using ${slotCopy}.${rollCopy}${detectionCopy}`;
  return { legal: true, roll, summary, encounter: { ...next, log: [`${active.name}: ${summary}`, ...next.log] } };
}

export function revealDetectMagicAuras(encounter: EncounterState, combatantId: string): OptionResolution {
  const actor = encounter.combatants.find((combatant) => combatant.id === combatantId);
  const detectMagic = encounter.effects.find((effect) => effect.sourceCombatantId === combatantId && effect.senseMagic);
  if (!actor || encounter.combatants[encounter.activeIndex]?.id !== combatantId || !detectMagic?.senseMagic) return { legal: false, reason: "Detect Magic is not active for this character.", encounter };
  if (encounter.pendingResponse || isIncapacitated(encounter, actor.id)) return { legal: false, reason: "Resolve the pending response first; an incapacitated character cannot inspect auras.", encounter };
  if (!encounter.turn.action) return { legal: false, reason: "Revealing magical auras requires an available Action.", encounter };
  const inRange = (position: { x: number; y: number }) => Math.max(Math.abs(actor.position.x - position.x), Math.abs(actor.position.y - position.y)) * 5 <= detectMagic.senseMagic!.rangeFeet;
  const visible = (position: { x: number; y: number }) => !actor.conditions.some((condition) => condition.toLowerCase() === "blinded") && hasLineOfSightToPoint(encounter, combatantId, position.x, position.y);
  const terrainAuras = encounter.map.terrain.filter((cell) => cell.magicAura && inRange(cell) && visible(cell)).map((cell) => `${cell.magicAura} at ${String.fromCharCode(65 + cell.x)}${cell.y + 1}`);
  const effectAuras = encounter.effects.filter((effect) => {
    if (effect.id === detectMagic.id || !effect.magical || !effectHasStarted(encounter, effect)) return false;
    if (effect.points?.length) return effect.points.some((point) => inRange(point) && visible(point));
    const target = encounter.combatants.find((candidate) => candidate.id === effect.targetCombatantId);
    return Boolean(target && !target.conditions.some((condition) => condition.toLowerCase() === "invisible") && inRange(target.position) && visible(target.position));
  })
    .map((effect) => effect.points?.length ? `${effect.name} at its visible map points` : `${effect.name} on ${encounter.combatants.find((candidate) => candidate.id === effect.targetCombatantId)?.name ?? "a creature"}`);
  const auras = [...terrainAuras, ...effectAuras];
  const summary = `${actor.name} uses an Action to inspect magical auras and detects ${auras.length ? auras.join(", ") : "no visible registered auras"}.`;
  return { legal: true, roll: null, summary, encounter: { ...encounter, turn: { ...encounter.turn, action: false }, log: [summary, ...encounter.log] } };
}
