import {Character} from "../domain/character";
export type ImportFormat="json"|"fillable-pdf"|"flattened-pdf";export type ImportResult={character:Character;format:ImportFormat;warnings:string[];requiresReview?:boolean};export interface CharacterImporter{supports(file:File):boolean;import(file:File):Promise<ImportResult>}
