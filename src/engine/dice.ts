export type RollMode="normal"|"advantage"|"disadvantage";
export type D20Result={mode:RollMode;rolls:number[];kept:number;natural:number;modifier:number;total:number};
export function rollD20({mode,modifier=0,random=Math.random}:{mode:RollMode;modifier?:number;random?:()=>number}):D20Result{const die=()=>Math.floor(random()*20)+1;const rolls=mode==="normal"?[die()]:[die(),die()];const kept=mode==="advantage"?Math.max(...rolls):mode==="disadvantage"?Math.min(...rolls):rolls[0];return{mode,rolls,kept,natural:kept,modifier,total:kept+modifier}}
