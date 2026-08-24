export type AbilityName="strength"|"dexterity"|"constitution"|"intelligence"|"wisdom"|"charisma";
export type CharacterResource={name:string;current:number;maximum:number};
export type Character={id:string;name:string;className:string;level:number;armorClass:number;hitPoints:{current:number;maximum:number};proficiencyBonus:number;abilities:Record<AbilityName,number>;resources:CharacterResource[];source:{format:"json"|"fillable-pdf"|"sample";fileName?:string;importedAt:string}};
export const abilityModifier=(score:number)=>Math.floor((score-10)/2);
