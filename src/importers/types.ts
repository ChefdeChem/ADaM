import {Character} from "../domain/character";
export type ImportFormat="json"|"fillable-pdf";export type ImportResult={character:Character;format:ImportFormat;warnings:string[]};export interface CharacterImporter{supports(file:File):boolean;import(file:File):Promise<ImportResult>}
