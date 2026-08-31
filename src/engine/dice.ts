export type RollMode="normal"|"advantage"|"disadvantage";
export type D20Result={mode:RollMode;rolls:number[];kept:number;natural:number;modifier:number;total:number};
export function rollD20({mode,modifier=0,random=Math.random}:{mode:RollMode;modifier?:number;random?:()=>number}):D20Result{const die=()=>Math.floor(random()*20)+1;const rolls=mode==="normal"?[die()]:[die(),die()];const kept=mode==="advantage"?Math.max(...rolls):mode==="disadvantage"?Math.min(...rolls):rolls[0];return{mode,rolls,kept,natural:kept,modifier,total:kept+modifier}}

export type DamageFormula={diceCount:number;dieSize:number;modifier:number;damageType:string};
export type DamageRoll={formula:DamageFormula;critical:boolean;rolls:number[];modifier:number;total:number};

export function parseDamageFormula(expression:string):DamageFormula|null{
  const normalized=expression.replace(/−/g,"-").replace(/\s+/g," ").trim();
  const match=normalized.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?\s*(.*)$/i);
  if(!match){
    const fixed=normalized.match(/^(\d+)\s*(.*)$/);
    if(!fixed)return null;
    return{diceCount:0,dieSize:0,modifier:Number(fixed[1]),damageType:fixed[2]?.trim()||"damage"};
  }
  const modifier=match[3]&&match[4]?(match[3]==="-"?-1:1)*Number(match[4]):0;
  return{diceCount:Number(match[1]),dieSize:Number(match[2]),modifier,damageType:match[5]?.trim()||"damage"};
}

export function rollDamage(expression:string,{critical=false,random=Math.random}:{critical?:boolean;random?:()=>number}={}):DamageRoll|null{
  const formula=parseDamageFormula(expression);
  if(!formula)return null;
  const diceCount=formula.diceCount*(critical?2:1);
  const rolls=Array.from({length:diceCount},()=>Math.floor(random()*formula.dieSize)+1);
  return{formula,critical,rolls,modifier:formula.modifier,total:Math.max(0,rolls.reduce((sum,roll)=>sum+roll,0)+formula.modifier)};
}
