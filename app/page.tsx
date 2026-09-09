"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AbilityName, Character, CharacterAttack, CharacterEquipmentRule, CharacterFeatureAction, CharacterSpell } from "../src/domain/character";
import type { ActionCost, CombatAction, ExperienceMode } from "../src/domain/combat";
import { actionCatalog, availableActions, consumeAction, findActionFromText, validateAction, visibleActionsForMode } from "../src/engine/actions";
import { executeRitualSpell, executeSpellChoice, revealDetectMagicAuras, resolveAttackDamage, resolveAttackRoll, resolveSpellAttackRoll, resolveSpellDamage, spellCastingResourceOptions, validateAttackChoice, validateAttackTarget, validateSpellAvailability, validateSpellChoice, validateSpellTarget, type SpellCastingResourceChoice } from "../src/engine/combat-options";
import { effectiveArmorClass, effectiveSavingThrowModifier, effectsForCombatant, remainingEffectRounds, endConcentration, occupiedCells, removeEffect } from "../src/engine/effects";
import { creatureSenseSnapshot, executeFeatureAction, healingPoolTargetOption, resumeAreaDamage, extendRageWithBonusAction, validateFeatureAction } from "../src/engine/feature-actions";
import { endTurn, rollPlayerAndEnemyInitiative } from "../src/engine/encounter";
import { combatOutcome, enemyHealthLabel, resolveEnemyTurn } from "../src/engine/enemy-turns";
import { chooseOpportunityAttack, resolveAttackReaction, resolveConcentrationResponse, resolveDamageReductionReaction, resolvePostHitSpellChoice, resolveSavingThrowResponse, resolveWeaponMasteryChoice, resolveZeroHitPointReplacement, rollDeathSave, rollOpportunityAttack, rollOpportunityDamage } from "../src/engine/responses";
import { availableSpellSlotLevels } from "../src/engine/resources";
import { legalMovementDestinations, moveActiveCombatant } from "../src/engine/movement";
import { executeSkillAction, skillActionChoices } from "../src/engine/skill-actions";
import { hide, help, helpAbility, readyAttack, resolveReadiedAttack, nearbyDoors, interactWithDoor, endHiding, type ReadyAttackTrigger } from "../src/engine/interactions";
import { completeSurinaRest } from "../src/engine/rests";
import { resolveShove, validateShove, type ShoveMode } from "../src/engine/shove";
import { grappleEffectsFrom, grappleEffectsOn, releaseGrapple, resolveGrapple, resolveGrappleEscape, validateGrapple, type EscapeAbility } from "../src/engine/grappling";
import { recoverRestResources, type RestType } from "../src/engine/resources";
import { executePointSpell, resumePointHazards, resolvePointHazardResponse } from "../src/engine/point-effects";
import { executeToolCheck, toolRuleForAction } from "../src/engine/tool-actions";
import { analyzeTarget, selectTarget } from "../src/engine/targeting";
import { areaTargets } from "../src/engine/areas";
import { rollD20, type DamageRoll } from "../src/engine/dice";
import { importCharacterFile, type ImportResult } from "../src/importers";
import { rulesets } from "../src/rulesets";
import { createPlayableEncounter, DEFAULT_COMBAT_RULESET, detectCharacterEdition, editionLabel, playableCharacter } from "../src/rulesets/edition-policy";
import { handleWeapon } from "../src/engine/weapon-hands";
import { defaultScenarioSetup, generateScriptedScenario, scenarioTemplates } from "../src/scenarios/scripted-generator";
import type { ScenarioDifficulty, ScenarioEnvironment, ScenarioObjective, ScenarioSetup, ScenarioTemplate } from "../src/scenarios/types";
import { CHARACTER_ROSTER_LIMIT, CHARACTER_ROSTER_SEED_VERSION, mergeBuiltInCharacters, removeRosterCharacter, upsertRosterCharacter } from "../src/characters/roster";
import { buildCharacterMechanicCoverage } from "../src/rules-registry";
import { buildTurnGuidance } from "../src/ui/turn-guidance";
import { actionCostLabel, quickActionPresentation } from "../src/ui/action-presentation";
import { buildResolutionReceipt, type ResolutionReceipt } from "../src/ui/resolution-receipt";
import { explainD20Roll, explainDamageRoll, type RollExplanation } from "../src/ui/roll-explanation";
import { buildSurinaTacticalActions, type SurinaTacticalActionId } from "../src/ui/surina-tactical-actions";
import { buildSurinaUtilityActions, legalInfluenceTargetIds, type SurinaUtilityActionId } from "../src/ui/surina-utility-actions";

type ScenarioSetupMode = "describe" | "guided" | "combined" | "templates";
type ActionCategory = Extract<ActionCost, "action" | "bonus-action" | "movement">;
type ChoiceMode = "attack" | "spell" | null;
type AttackFlow = null | {
  attack: CharacterAttack;
  phase: "target" | "attack-roll" | "damage-roll";
  targetId?: string;
  critical?: boolean;
};
type SpellFlow = null | {
  spell: CharacterSpell;
  phase: "resource" | "option" | "target" | "point" | "attack-roll" | "damage-roll";
  targetId?: string;
  critical?: boolean;
  castingResource?: SpellCastingResourceChoice;
  utilityChoiceId?: string;
};
type FeatureFlow = null | {
  feature: CharacterFeatureAction;
  targetId?: string;
  amount: number;
  maximum: number;
  removePoisoned?: boolean;
  afflictionEffectIds?: string[];
};
type ToolFlow = null | { rule: CharacterEquipmentRule };

const actionCategoryCopy: Array<{ id: ActionCategory; label: string; detail: string }> = [
  { id: "action", label: "Action", detail: "Attacks, magic, and core actions" },
  { id: "bonus-action", label: "Bonus Action", detail: "Features with a bonus-action cost" },
  { id: "movement", label: "Movement", detail: "Positioning on the tactical grid" },
];

const surinaQuickActionCopy: Record<string, { label: string; detail: string }> = {
  attack: { label: "Attack", detail: "Choose a held weapon or an Unarmed Strike option." },
  move: { label: "Move", detail: "Choose a highlighted square and spend movement by the legal path." },
  "breath-weapon-gold": { label: "Breath Weapon", detail: "Choose Cone or Line, aim the area, and preview everyone affected." },
  "lay-on-hands": { label: "Lay on Hands", detail: "Choose a creature in touch range and decide how many points to spend." },
  dodge: { label: "Dodge", detail: "Spend the Action to defend until the start of Surina's next turn." },
};

const setupModeCopy: Record<ScenarioSetupMode, { label: string; detail: string }> = {
  describe: { label: "Describe", detail: "Write the encounter in your own words." },
  guided: { label: "Guided", detail: "Choose environment, objective, and difficulty." },
  combined: { label: "Combined", detail: "Use controls, then add custom details." },
  templates: { label: "Templates", detail: "Start from a saved scenario setup." },
};

const abilityLabels: Array<{ id: AbilityName; label: string }> = [
  { id: "strength", label: "Strength" },
  { id: "dexterity", label: "Dexterity" },
  { id: "constitution", label: "Constitution" },
  { id: "intelligence", label: "Intelligence" },
  { id: "wisdom", label: "Wisdom" },
  { id: "charisma", label: "Charisma" },
];

const sample: Character = {
  id: "sample-kael-emberward", name: "Kael Emberward", className: "Sorcerer", level: 4, armorClass: 15,
  speedFeet: 30, hitPoints: { current: 34, maximum: 34 }, proficiencyBonus: 2,
  abilities: { strength: 8, dexterity: 12, constitution: 16, intelligence: 10, wisdom: 13, charisma: 18 },
  savingThrowModifiers: { strength: -1, dexterity: 1, constitution: 5, intelligence: 0, wisdom: 1, charisma: 6 },
  resources: [
    { id: "sorcery-points", name: "Sorcery Points", kind: "generic", current: 4, maximum: 4, recovery: "long-rest" },
    { id: "spell-slot-1", name: "Level 1 Spell Slots", kind: "spell-slot", level: 1, current: 4, maximum: 4, recovery: "long-rest" },
    { id: "spell-slot-2", name: "Level 2 Spell Slots", kind: "spell-slot", level: 2, current: 3, maximum: 3, recovery: "long-rest" },
  ],
  attacks: [
    { id: "quarterstaff", name: "Quarterstaff", kind: "melee", attackBonus: 1, damage: "1d6 − 1 bludgeoning", normalRangeFeet: 5, description: "A close-range melee strike." },
    { id: "thrown-dagger", name: "Thrown Dagger", kind: "ranged", attackBonus: 3, damage: "1d4 + 1 piercing", normalRangeFeet: 20, longRangeFeet: 60, description: "Normal to 20 feet; disadvantage from 25–60 feet." },
    { id: "light-crossbow", name: "Light Crossbow", kind: "ranged", attackBonus: 3, damage: "1d8 + 1 piercing", normalRangeFeet: 80, longRangeFeet: 320, description: "Normal to 80 feet; disadvantage from 85–320 feet." },
  ],
  spells: [
    { id: "shield", name: "Shield", level: 1, castingTime: "reaction", rangeFeet: 0, target: "self", requiresLineOfSight: false, durationRounds: 1, effect: { name: "Shield", description: "+5 AC until the start of your next turn.", modifiers: { armorClass: 5 } } },
    { id: "fire-bolt", name: "Fire Bolt", level: 0, castingTime: "action", rangeFeet: 120, target: "single", requiresLineOfSight: true, attackBonus: 6, damage: "1d10 fire" },
    { id: "chromatic-orb", name: "Chromatic Orb", level: 1, castingTime: "action", rangeFeet: 90, target: "single", requiresLineOfSight: true, attackBonus: 6, damage: "3d8 chosen damage" },
    { id: "scorching-ray", name: "Scorching Ray", level: 2, castingTime: "action", rangeFeet: 120, target: "single", requiresLineOfSight: true, attackBonus: 6, damage: "2d6 fire per ray" },
    { id: "false-life", name: "False Life", level: 1, castingTime: "action", rangeFeet: 0, target: "self", requiresLineOfSight: false, durationRounds: 600, effect: { name: "False Life", description: "7 temporary hit points for 1 hour.", temporaryHitPoints: 7 } },
    { id: "blur", name: "Blur", level: 2, castingTime: "action", rangeFeet: 0, target: "self", requiresLineOfSight: false, concentration: true, durationRounds: 10, effect: { name: "Blur", description: "Incoming attacks have disadvantage while concentration lasts.", modifiers: { incomingAttacks: "disadvantage" } } },
  ],
  actions: ["Attack", "Magic", "Cast a Spell", "Dash", "Disengage", "Dodge", "Help", "Hide", "Ready", "Search", "Utilize", "Use an Object", "Study", "Influence", "Quickened Spell"],
  source: { format: "sample", importedAt: new Date().toISOString() },
};

const modeCopy: Record<ExperienceMode, { label: string; detail: string }> = {
  beginner: { label: "Beginner", detail: "Full coaching and exact enemy health; enemies use direct, predictable tactics." },
  training: { label: "Intermediate", detail: "Rules feedback and descriptive health; enemies reposition and use signature abilities." },
  advanced: { label: "Advanced", detail: "Minimal guidance and concealed health; enemies prioritize vulnerable targets, strong attacks, range, and cover." },
};

function withCombatDefaults(character: Character): Character {
  return {
    ...character,
    speedFeet: character.speedFeet ?? 30,
    resources: (character.resources ?? []).map((resource, index) => ({
      id: resource.id ?? `resource-${index}`,
      name: resource.name,
      kind: resource.kind ?? "generic",
      level: resource.level,
      current: resource.current,
      maximum: resource.maximum,
      recovery: resource.recovery ?? "long-rest",
      shortRestRecovery: resource.shortRestRecovery,
      longRestRecovery: resource.longRestRecovery,
    })),
    attacks: character.attacks?.length ? character.attacks : [{
      id: "unarmed-strike",
      name: "Unarmed Strike",
      kind: "melee",
      attackBonus: character.proficiencyBonus,
      damage: "1 + Strength modifier bludgeoning",
      normalRangeFeet: 5,
      description: "Fallback attack added because the imported sheet did not include attack data.",
    }],
    spells: character.spells ?? [],
  };
}

export default function Home() {
  const [sourceCharacter, setCharacter] = useState(sample);
  const playable = useMemo(() => playableCharacter(sourceCharacter), [sourceCharacter]);
  const character = playable.character;
  const [storedCharacters, setStoredCharacters] = useState<Character[]>([]);
  const rulesetId = DEFAULT_COMBAT_RULESET;
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>("beginner");
  const [message, setMessage] = useState("Using the built-in sample character. Import a PDF or ADaM JSON anytime.");
  const [pendingImport, setPendingImport] = useState<ImportResult | null>(null);
  const [reviewCharacter, setReviewCharacter] = useState<Character | null>(null);
  const [setupMode, setSetupMode] = useState<ScenarioSetupMode>("combined");
  const [scenarioPrompt, setScenarioPrompt] = useState(defaultScenarioSetup.prompt);
  const [environment, setEnvironment] = useState<ScenarioEnvironment>(defaultScenarioSetup.environment);
  const [objective, setObjective] = useState<ScenarioObjective>(defaultScenarioSetup.objective);
  const [difficulty, setDifficulty] = useState<ScenarioDifficulty>(defaultScenarioSetup.difficulty);
  const [scenario, setScenario] = useState(() => generateScriptedScenario(defaultScenarioSetup));
  const initialScenario = useRef(scenario);
  const [savedTemplates, setSavedTemplates] = useState<ScenarioTemplate[]>([]);
  const [encounter, setEncounter] = useState(() => createPlayableEncounter(sample, scenario));
  const [command, setCommand] = useState("");
  const [feedback, setFeedback] = useState("Roll your initiative to begin. ADaM will roll privately for the enemies.");
  const [lastRoll, setLastRoll] = useState<ReturnType<typeof rollD20> | DamageRoll | null>(null);
  const [actionCategory, setActionCategory] = useState<ActionCategory>("action");
  const [choiceMode, setChoiceMode] = useState<ChoiceMode>(null);
  const [attackFlow, setAttackFlow] = useState<AttackFlow>(null);
  const [unarmedFlow, setUnarmedFlow] = useState<"grapple" | "shove" | null>(null);
  const [spellFlow, setSpellFlow] = useState<SpellFlow>(null);
  const [featureFlow, setFeatureFlow] = useState<FeatureFlow>(null);
  const [breathFlow, setBreathFlow] = useState<CharacterFeatureAction | null>(null);
  const [interactionFlow, setInteractionFlow] = useState<"help" | "ready" | "utilize" | null>(null);
  const [utilityTargetFlow, setUtilityTargetFlow] = useState<"influence" | null>(null);
  const [assistanceConfirmed, setAssistanceConfirmed] = useState(false);
  const [doorPractice, setDoorPractice] = useState(false);
  const [skillFlow, setSkillFlow] = useState<string | null>(null);
  const [breathShape, setBreathShape] = useState<"cone" | "line">("cone");
  const [toolFlow, setToolFlow] = useState<ToolFlow>(null);
  const [enemyTurnPhase, setEnemyTurnPhase] = useState<"idle" | "resolving" | "awaiting-player" | "showing">("idle");
  const [scenarioBuilderOpen, setScenarioBuilderOpen] = useState(true);
  const [resolutionReceipt, setResolutionReceipt] = useState<ResolutionReceipt | null>(null);
  const [rollExplanation, setRollExplanation] = useState<RollExplanation | null>(null);

  const activeRuleset = rulesets.find((ruleset) => ruleset.id === rulesetId)!;
  const visibleActions = useMemo(
    () => visibleActionsForMode(character, rulesetId, experienceMode, encounter),
    [character, encounter, experienceMode, rulesetId],
  );
  const characterActions = useMemo(() => availableActions(character, rulesetId), [character, rulesetId]);
  const surinaQuickActions = useMemo(() => ["attack", "move", "breath-weapon-gold", "lay-on-hands", "dodge"]
    .map((id) => characterActions.find((action) => action.id === id))
    .filter((action): action is CombatAction => Boolean(action)), [characterActions]);
  const surinaTacticalActions = useMemo(() => buildSurinaTacticalActions(encounter), [encounter]);
  const surinaUtilityActions = useMemo(() => buildSurinaUtilityActions(encounter), [encounter]);
  const categorizedActions = useMemo(() => visibleActions.filter((action) => action.cost === actionCategory), [actionCategory, visibleActions]);
  const activeCombatant = encounter.combatants[encounter.activeIndex];
  const playerCombatant = encounter.combatants.find((combatant) => combatant.id === character.id) ?? encounter.combatants[0];
  const playerArmorClass = effectiveArmorClass(encounter, playerCombatant.id);
  const playerEffects = effectsForCombatant(encounter, playerCombatant.id);
  const targetAnalysis = useMemo(() => encounter.selectedTargetId ? analyzeTarget(encounter, encounter.selectedTargetId) : null, [encounter]);
  const initiativeReady = encounter.combatants.every((combatant) => combatant.initiativeRolled);
  const playerNeedsInitiative = encounter.combatants.find((combatant) => combatant.side === "player" && !combatant.initiativeRolled);
  const outcome = combatOutcome(encounter);
  const deathSaveRequired = initiativeReady && activeCombatant.side === "player" && activeCombatant.hitPoints.current <= 0 && !activeCombatant.stabilized && activeCombatant.deathSaves.failures < 3;
  const legalAttackTargetIds = useMemo(() => new Set(
    attackFlow?.phase === "target"
      ? encounter.combatants.filter((combatant) => combatant.side !== activeCombatant.side && combatant.hitPoints.current > 0 && validateAttackTarget(encounter, attackFlow.attack, combatant.id).legal).map((combatant) => combatant.id)
      : [],
  ), [activeCombatant.side, attackFlow, encounter]);
  const legalSpellTargetIds = useMemo(() => new Set(
    spellFlow?.phase === "target"
      ? encounter.combatants.filter((combatant) => validateSpellTarget(encounter, spellFlow.spell, combatant.id).legal).map((combatant) => combatant.id)
      : [],
  ), [encounter, spellFlow]);
  const legalUtilityTargetIds = useMemo(() => new Set(
    utilityTargetFlow === "influence" ? legalInfluenceTargetIds(encounter) : [],
  ), [encounter, utilityTargetFlow]);
  const legalMovementCells = useMemo(() => legalMovementDestinations(encounter), [encounter]);
  const legalMovementByCell = useMemo(() => new Map(legalMovementCells.map((cell) => [`${cell.x},${cell.y}`, cell])), [legalMovementCells]);
  const mechanicCoverage = useMemo(() => buildCharacterMechanicCoverage(sourceCharacter), [sourceCharacter]);
  const playableMechanicCoverage = useMemo(() => buildCharacterMechanicCoverage(character), [character]);
  const importMechanicCoverage = useMemo(() => reviewCharacter ? buildCharacterMechanicCoverage(reviewCharacter) : null, [reviewCharacter]);
  const surinaGuide = buildTurnGuidance({
    initiativeReady,
    outcome,
    activeSide: activeCombatant.side,
    hasRequiredResponse: Boolean(encounter.pendingResponse) || deathSaveRequired,
    choiceMode,
    attackPhase: attackFlow?.phase ?? null,
    spellPhase: spellFlow?.phase ?? null,
    breathActive: Boolean(breathFlow),
    healingPhase: featureFlow ? featureFlow.targetId ? "amount" : "target" : null,
    interactionActive: Boolean(interactionFlow),
    skillActive: Boolean(skillFlow),
    actionAvailable: encounter.turn.action,
    bonusActionAvailable: encounter.turn.bonusAction,
    movementRemaining: encounter.turn.movementRemaining,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem("adam-scenario-templates");
        if (stored) setSavedTemplates(JSON.parse(stored) as ScenarioTemplate[]);
        const rosterJson = localStorage.getItem("adam-character-roster");
        const roster = rosterJson ? (JSON.parse(rosterJson) as Character[]) : [];
        const validRoster = roster.filter((candidate) => candidate?.id && candidate?.name && candidate?.hitPoints && candidate?.abilities).slice(0, CHARACTER_ROSTER_LIMIT).map(withCombatDefaults);
        const seedVersion = Number(localStorage.getItem("adam-character-roster-seed-version") ?? "0");
        const nextRoster = seedVersion < CHARACTER_ROSTER_SEED_VERSION ? mergeBuiltInCharacters(validRoster) : validRoster;
        setStoredCharacters(nextRoster);
        localStorage.setItem("adam-character-roster", JSON.stringify(nextRoster));
        if (nextRoster.some((candidate) => candidate.id === "cleira-oestwilde")) localStorage.setItem("adam-character-roster-seed-version", String(CHARACTER_ROSTER_SEED_VERSION));
        const activeId = localStorage.getItem("adam-active-character-id");
        const activeCharacter = nextRoster.find((candidate) => candidate.id === activeId) ?? nextRoster[0] ?? sample;
        setCharacter(activeCharacter);
        setMessage(`${activeCharacter.name}'s stored character sheet is loaded and ready for a fresh encounter.`);
        setEncounter(createPlayableEncounter(activeCharacter, initialScenario.current));
      } catch {
        setSavedTemplates([]);
        setStoredCharacters([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!initiativeReady || activeCombatant?.side !== "enemy" || outcome !== "active") return;
    if (encounter.pendingResponse || enemyTurnPhase === "awaiting-player") return;
    const delay = enemyTurnPhase === "idle" ? 350 : enemyTurnPhase === "resolving" ? 700 : 1800;
    const timer = window.setTimeout(() => {
      if (enemyTurnPhase === "idle") {
        setFeedback(`${activeCombatant.name}'s turn. ADaM is choosing movement, target, and action.`);
        setEnemyTurnPhase("resolving");
        return;
      }
      if (enemyTurnPhase === "resolving") {
        const result = resolveEnemyTurn(encounter, experienceMode);
        setEncounter(result.encounter);
        setLastRoll(result.damageRoll ?? result.attackRoll);
        const summary = result.steps.map((step) => step.summary).join(" ");
        setFeedback(summary);
        setResolutionReceipt(buildResolutionReceipt({ kind: "enemy-turn", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary, concealEnemyHitPoints: experienceMode === "advanced" }));
        setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : "showing");
        return;
      }
      setEncounter((state) => endTurn(state));
      setEnemyTurnPhase("idle");
      setFeedback("Enemy turn complete. Initiative advances to the next living combatant.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeCombatant?.id, activeCombatant?.name, activeCombatant?.side, encounter, enemyTurnPhase, experienceMode, initiativeReady, outcome, playerCombatant.id]);

  function finishPlayerResponse(nextEncounter: typeof encounter, summary: string, playerRoll: ReturnType<typeof rollD20> | null) {
    nextEncounter = resumePointHazards(nextEncounter);
    nextEncounter = resumeAreaDamage(nextEncounter);
    if (nextEncounter.pendingTurnEnd && !nextEncounter.pendingResponse) nextEncounter = endTurn(nextEncounter);
    setEncounter(nextEncounter);
    setResolutionReceipt(buildResolutionReceipt({ kind: "defense", before: encounter, after: nextEncounter, actorId: playerCombatant.id, summary, concealEnemyHitPoints: experienceMode === "advanced" }));
    if (playerRoll) setLastRoll(playerRoll);
    setFeedback(summary);
    setEnemyTurnPhase(nextEncounter.activeIndex !== encounter.activeIndex ? "idle" : activeCombatant.side === "enemy" ? (nextEncounter.pendingResponse ? "awaiting-player" : nextEncounter.pendingEnemyPath ? "resolving" : "showing") : "idle");
  }

  function rollPendingSavingThrow() {
    const pending = encounter.pendingResponse?.type === "saving-throw" ? encounter.pendingResponse : null;
    const result = resolveSavingThrowResponse(encounter);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
    if (pending && result.playerRoll) setRollExplanation(explainD20Roll({
      kind: "saving-throw",
      title: `${pending.ability.name}: ${pending.ability.saveAbility} save`,
      roll: result.playerRoll,
      target: { label: "DC", value: pending.ability.saveDc },
      outcome: result.playerRoll.total >= pending.ability.saveDc ? "Success" : "Failure",
      nextStep: result.encounter.pendingResponse ? "Resolve the next defensive choice." : "Review the damage result, then continue the encounter.",
    }));
  }

  function rollPendingPointHazard() {
    const pending = encounter.pendingResponse?.type === "point-hazard-save" ? encounter.pendingResponse : null;
    const effect = pending ? encounter.effects.find((candidate) => candidate.id === pending.effectId) : undefined;
    const save = effect?.pointEffect?.type === "damaging-hazard" ? effect.pointEffect.save : undefined;
    const result = resolvePointHazardResponse(encounter);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
    if (pending && save && result.playerRoll) setRollExplanation(explainD20Roll({
      kind: "saving-throw",
      title: `${pending.name}: ${save.ability} save`,
      roll: result.playerRoll,
      target: { label: "DC", value: save.dc },
      outcome: result.playerRoll.total >= save.dc ? "Success" : "Failure",
      nextStep: result.encounter.pendingResponse ? "Resolve the next hazard response." : "Continue the interrupted turn or movement.",
    }));
  }

  function choosePendingReaction(reactionId: string | null) {
    const result = resolveAttackReaction(encounter, reactionId);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
  }

  function choosePendingOpportunityAttack(attackId: string | null) {
    const result = chooseOpportunityAttack(encounter, attackId);
    setEncounter(result.encounter);
    setFeedback(result.summary);
    setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : "resolving");
  }

  function rollPendingOpportunityAttack() {
    const result = rollOpportunityAttack(encounter);
    setEncounter(result.encounter);
    if (result.playerRoll) setLastRoll(result.playerRoll);
    setFeedback(result.summary);
    setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : "resolving");
  }

  function rollPendingOpportunityDamage() {
    const result = rollOpportunityDamage(encounter);
    setEncounter(result.encounter);
    if (result.damageRoll) setLastRoll(result.damageRoll);
    setFeedback(result.summary);
    setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : "resolving");
  }

  function rollPendingConcentration() {
    const pending = encounter.pendingResponse?.type === "concentration-check" ? encounter.pendingResponse : null;
    const result = resolveConcentrationResponse(encounter);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
    if (pending && result.playerRoll) setRollExplanation(explainD20Roll({
      kind: "saving-throw",
      title: "Concentration: Constitution save",
      roll: result.playerRoll,
      target: { label: "DC", value: pending.dc },
      outcome: result.playerRoll.total >= pending.dc ? "Concentration continues" : "Concentration ends",
      nextStep: result.encounter.pendingResponse ? "Resolve the next response." : "Continue the interrupted turn or movement.",
    }));
  }

  function chooseZeroHitPointReplacement(useFeature: boolean) {
    const result = resolveZeroHitPointReplacement(encounter, useFeature);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
  }

  function chooseDamageReductionReaction(useFeature: boolean) {
    const result = resolveDamageReductionReaction(encounter, useFeature);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
    if (result.damageRoll) setLastRoll(result.damageRoll);
  }

  function chooseWeaponMastery(useMastery: boolean) {
    const result = resolveWeaponMasteryChoice(encounter, useMastery);
    setEncounter(result.encounter);
    setFeedback(result.summary);
    setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : activeCombatant.side === "enemy" ? "resolving" : "idle");
  }

  function choosePostHitSpell(castSpell: boolean, slotLevel?: number) {
    const result = resolvePostHitSpellChoice(encounter, castSpell, Math.random, { slotLevel });
    setEncounter(result.encounter);
    if (result.damageRoll) setLastRoll(result.damageRoll);
    setFeedback(result.summary);
  }

  function rollPendingDeathSave() {
    const result = rollDeathSave(encounter, activeCombatant.id);
    setEncounter(result.encounter);
    if (result.playerRoll) {
      const after = result.encounter.combatants.find((combatant) => combatant.id === activeCombatant.id)!;
      const outcomeCopy = after.hitPoints.current > 0 ? "Natural 20 · 1 HP" : after.deathSaves.failures >= 3 ? "Three failures" : after.stabilized ? "Stabilized" : result.playerRoll.total >= 10 ? "Success" : "Failure";
      setLastRoll(result.playerRoll);
      setRollExplanation(explainD20Roll({ kind: "saving-throw", title: "Death saving throw", roll: result.playerRoll, target: { label: "DC", value: 10 }, outcome: outcomeCopy, nextStep: after.hitPoints.current > 0 ? "Surina is conscious and can act if her turn resources remain." : after.stabilized || after.deathSaves.failures >= 3 ? "This solo encounter is complete." : "End the turn. Surina rolls again at the start of her next turn if still unstable." }));
    }
    setFeedback(result.summary);
    setResolutionReceipt(buildResolutionReceipt({ kind: "death-save", before: encounter, after: result.encounter, actorId: activeCombatant.id, summary: result.summary }));
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setMessage(`Reading ${file.name}...`);
    try {
      const imported = await importCharacterFile(file);
      if (imported.requiresReview) {
        setPendingImport(imported);
        setReviewCharacter(imported.character);
        setMessage(`${file.name} read. Review the extracted values before using this character.`);
      } else {
        applyImportedCharacter(imported.character, imported.warnings);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The sheet could not be imported."); }
    finally { event.target.value = ""; }
  }

  function persistCharacterRoster(nextRoster: Character[]) {
    setStoredCharacters(nextRoster);
    localStorage.setItem("adam-character-roster", JSON.stringify(nextRoster));
  }

  function activateCharacter(nextCharacter: Character, announcement: string) {
    setCharacter(nextCharacter);
    setBreathFlow(null);
    setInteractionFlow(null);
    setUtilityTargetFlow(null);
    setEncounter(createPlayableEncounter(nextCharacter, scenario));
    setChoiceMode(null);
    setAttackFlow(null);
    setUnarmedFlow(null);
    setSpellFlow(null);
    setFeatureFlow(null);
    setToolFlow(null);
    setEnemyTurnPhase("idle");
    setResolutionReceipt(null);
    setRollExplanation(null);
    localStorage.setItem("adam-active-character-id", nextCharacter.id);
    setMessage(announcement);
  }

  function applyImportedCharacter(importedCharacter: Character, warnings: string[]): boolean {
    const normalized = withCombatDefaults(importedCharacter);
    const update = upsertRosterCharacter(storedCharacters, normalized);
    if (!update.stored) {
      setMessage(update.reason ?? "The character could not be stored.");
      return false;
    }
    persistCharacterRoster(update.characters);
    activateCharacter(normalized, `${normalized.name} imported and saved. ${warnings.join(" ") || "Ready for combat."} Roll your initiative to begin.`);
    return true;
  }

  function selectStoredCharacter(characterId: string) {
    const selected = storedCharacters.find((candidate) => candidate.id === characterId);
    if (!selected) return;
    activateCharacter(selected, `${selected.name}'s stored statistics are loaded into a fresh encounter. Roll initiative when ready.`);
  }

  function deleteStoredCharacter(characterId: string) {
    const nextRoster = removeRosterCharacter(storedCharacters, characterId);
    persistCharacterRoster(nextRoster);
    if (character.id === characterId) {
      const nextActive = nextRoster[0] ?? sample;
      activateCharacter(nextActive, `${nextActive.name} is now active. The removed character is no longer stored on this device.`);
    }
    else setMessage("Character removed from the stored roster.");
  }

  function recoverAfterRest(restType: RestType, spendHitDie = false) {
    if (outcome !== "victory") {
      setFeedback("Rest resource recovery is available after the hostile creatures are defeated.");
      return;
    }
    const result = sourceCharacter.id === "surina-daardendrian"
      ? completeSurinaRest(encounter, sourceCharacter, restType, spendHitDie)
      : recoverRestResources(encounter, playerCombatant.id, restType);
    if (!result.legal) {
      setFeedback(result.reason);
      return;
    }
    const recoveredPlayer = result.encounter.combatants.find((combatant) => combatant.id === playerCombatant.id)!;
    const nextCharacter: Character = {
      ...sourceCharacter,
      hitPoints: { ...recoveredPlayer.hitPoints },
      recoveryState: result.encounter.recoveryState,
      inventoryRemaining: Object.fromEntries(recoveredPlayer.inventory.map(item => [item.id, item.current])),
      resources: recoveredPlayer.resources.map((resource) => ({ ...resource })),
    };
    setEncounter(result.encounter);
    if ("roll" in result && result.roll) setLastRoll(result.roll);
    setCharacter(nextCharacter);
    if (storedCharacters.some((candidate) => candidate.id === nextCharacter.id)) {
      persistCharacterRoster(storedCharacters.map((candidate) => candidate.id === nextCharacter.id ? nextCharacter : candidate));
    }
    setFeedback(`${result.summary} The recovered totals will carry into the next encounter.`);
    setResolutionReceipt(buildResolutionReceipt({ kind: "recovery", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: `${result.summary} The recovered totals carry into the next encounter.`, concealEnemyHitPoints: experienceMode === "advanced" }));
  }

  function updateReviewNumber(field: "level" | "armorClass" | "proficiencyBonus" | "speedFeet", value: string) {
    setReviewCharacter((current) => current ? { ...current, [field]: Number(value) } : current);
  }

  function updateReviewHitPoints(field: "current" | "maximum", value: string) {
    setReviewCharacter((current) => current ? { ...current, hitPoints: { ...current.hitPoints, [field]: Number(value) } } : current);
  }

  function updateReviewAbility(ability: AbilityName, value: string) {
    setReviewCharacter((current) => current ? { ...current, abilities: { ...current.abilities, [ability]: Number(value) } } : current);
  }

  function confirmReviewedImport(event: FormEvent) {
    event.preventDefault();
    if (!reviewCharacter) return;
    if (!applyImportedCharacter(reviewCharacter, pendingImport?.warnings ?? [])) return;
    setPendingImport(null);
    setReviewCharacter(null);
  }

  function performShove(targetId: string, mode: ShoveMode) {
    if (!initiativeReady || outcome !== "active" || attackFlow?.phase === "damage-roll") { setFeedback("Finish the pending attack and use Shove during an active encounter."); return; }
    const result = resolveShove(encounter, targetId, mode);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setFeedback(result.summary);
    setChoiceMode(null); setAttackFlow(null); setUnarmedFlow(null); setSpellFlow(null); setFeatureFlow(null); setToolFlow(null); setInteractionFlow(null);
  }

  function performGrapple(targetId: string) {
    if (!initiativeReady || outcome !== "active" || attackFlow?.phase === "damage-roll") { setFeedback("Finish the pending attack and use Grapple during an active encounter."); return; }
    const result = resolveGrapple(encounter, targetId);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setFeedback(result.summary);
    setChoiceMode(null); setAttackFlow(null); setUnarmedFlow(null); setSpellFlow(null); setFeatureFlow(null); setToolFlow(null); setInteractionFlow(null);
  }

  function escapeGrapple(effectId: string, ability: EscapeAbility) {
    const dc = encounter.effects.find((effect) => effect.id === effectId)?.grapple?.escapeDc ?? 0;
    const result = resolveGrappleEscape(encounter, effectId, ability);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setRollExplanation(explainD20Roll({ kind: "ability-check", title: `Escape Grapple: ${ability}`, roll: result.roll, target: { label: "DC", value: dc }, outcome: result.roll.total >= dc ? "Escaped" : "Still Grappled", nextStep: result.roll.total >= dc ? "Surina can move with any remaining movement." : "The Action is spent and Surina's Speed remains 0." }));
    setResolutionReceipt(buildResolutionReceipt({ kind: "grapple-escape", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.summary }));
    setFeedback(result.summary);
  }

  function changeHeldWeapon(itemId: string) {
    const result = handleWeapon(encounter, playerCombatant.id, itemId);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setFeedback(result.summary);
    setResolutionReceipt(buildResolutionReceipt({ kind: "equipment", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.summary }));
  }

  function interactWithNearbyDoor(x: number, y: number) {
    const result = interactWithDoor(encounter, x, y);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setFeedback(result.summary);
    setInteractionFlow(null);
    setResolutionReceipt(buildResolutionReceipt({ kind: "object", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.summary }));
  }

  function voluntarilyReleaseGrapple(effectId: string) {
    const result = releaseGrapple(encounter, effectId, playerCombatant.id);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setFeedback(result.summary);
  }

  function focusSurface(surface: "actions" | "map" | "response" | "outcome") {
    window.requestAnimationFrame(() => {
      const selector = surface === "actions"
        ? "#action-console"
        : surface === "map"
          ? "#tactical-map"
          : surface === "outcome"
            ? "#encounter-outcome"
            : "[data-guided-step='true']";
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function followGuidePrimary() {
    if (surinaGuide.focus === "initiative") { rollInitiative(); return; }
    if (surinaGuide.phase === "finish-turn") {
      runAction(actionCatalog.find((action) => action.id === "end-turn")!);
      return;
    }
    if (surinaGuide.focus === "actions") setActionCategory("action");
    focusSurface(surinaGuide.focus);
  }

  function followGuideSecondary() {
    if (surinaGuide.phase === "finish-turn") {
      focusSurface("map");
      return;
    }
    setActionCategory("movement");
    focusSurface("map");
  }

  function openSurinaTacticalAction(id: SurinaTacticalActionId) {
    if (id === "grapple" || id === "shove") {
      setChoiceMode("attack");
      setUnarmedFlow(id);
      setAttackFlow(null);
      setSpellFlow(null);
      setFeatureFlow(null);
      setToolFlow(null);
      setInteractionFlow(null);
      setFeedback(id === "grapple" ? "Choose one of the legal adjacent targets for Grapple." : "Choose a legal adjacent target, then knock it Prone or push it 5 feet.");
      focusSurface("actions");
      return;
    }
    const action = actionCatalog.find((candidate) => candidate.id === id);
    if (!action) return;
    setUnarmedFlow(null);
    runAction(action);
    if (id === "help") setFeedback("Choose how Surina helps and who receives that help.");
    if (id === "ready") setFeedback("Select a visible enemy on the map, then choose a held weapon and trigger.");
    if (id === "ready") focusSurface("map");
  }

  function openSurinaUtilityAction(id: SurinaUtilityActionId) {
    const action = actionCatalog.find((candidate) => candidate.id === id);
    if (!action) return;
    if (id === "influence" && !validateAction(action, encounter).legal) {
      setUtilityTargetFlow("influence");
      setChoiceMode(null);
      setAttackFlow(null);
      setSpellFlow(null);
      setFeatureFlow(null);
      setBreathFlow(null);
      setInteractionFlow(null);
      setSkillFlow(null);
      setFeedback("Choose a highlighted creature within 30 feet for Influence, then select a social skill.");
      focusSurface("map");
      return;
    }
    runAction(action);
  }

  function runAction(action: CombatAction) {
    if (!initiativeReady) { setFeedback("Roll your initiative before taking actions. ADaM rolls for the enemies automatically."); return; }
    if (outcome !== "active") { setFeedback("This encounter is complete. Build a new encounter to continue training."); return; }
    if (encounter.pendingResponse) { setFeedback("Resolve the pending saving throw or reaction before continuing."); return; }
    if (activeCombatant.side !== "player") { setFeedback("ADaM is resolving the enemy turn."); return; }
    if (deathSaveRequired && encounter.turn.action) { setFeedback("Roll the required death saving throw before ending this turn."); return; }
    if (activeCombatant.hitPoints.current <= 0 && action.id !== "end-turn") { setFeedback("An unconscious character cannot take actions."); return; }
    setUtilityTargetFlow(null);
    if (action.id === "end-turn") { const nextEncounter = endTurn(encounter); setEncounter(nextEncounter); setChoiceMode(null); setAttackFlow(null); setSpellFlow(null); setFeatureFlow(null); setBreathFlow(null); setToolFlow(null); setInteractionFlow(null); setFeedback("Turn ended. Initiative advanced."); setResolutionReceipt(buildResolutionReceipt({ kind: "end-turn", before: encounter, after: nextEncounter, actorId: playerCombatant.id, summary: "Surina's turn ended and initiative advanced to the next living combatant." })); return; }
    if (action.id === "attack") {
      setChoiceMode("attack");
      setUnarmedFlow(null);
      setAttackFlow(null);
      setSpellFlow(null);
      setFeatureFlow(null);
      setToolFlow(null);
      setFeedback(`${playerCombatant.attacks.length} weapon attacks are ready. Choose a weapon to reveal its legal targets.`);
      return;
    }
    const validation = validateAction(action, encounter, character);
    if (!validation.legal) {
      setFeedback(experienceMode === "training" ? validation.reason ?? "That action is not currently legal." : "Action disallowed."); return;
    }
    if (action.id === "move") { setFeedback("Choose a highlighted adjacent square. You can split your movement before and after actions; leaving an enemy's reach may trigger an opportunity attack."); focusSurface("map"); return; }
    if (action.id === "magic" || action.id === "cast-spell") { setChoiceMode("spell"); setAttackFlow(null); setSpellFlow(null); setFeatureFlow(null); setToolFlow(null); setFeedback("Choose a spell first. ADaM will then highlight every legal target for its range and line of sight."); return; }
    if (action.id === "hide") {
      const result = hide(encounter); if (!result.legal) { setFeedback(result.reason); return; }
      const hidden = result.encounter.effects.some((effect) => effect.hidden && effect.targetCombatantId === playerCombatant.id);
      setEncounter(result.encounter); setLastRoll(result.roll); setRollExplanation(explainD20Roll({ kind: "ability-check", title: "Hide: Stealth check", roll: result.roll, target: { label: "DC", value: 15 }, outcome: hidden ? "Hidden" : "Still detectable", nextStep: hidden ? "Move carefully, stay out of unobstructed enemy view, or choose another action on a later turn." : "The Action is spent. Reposition behind Total Cover before trying again on a later turn." })); setFeedback(result.summary); return;
    }
    if (["help", "ready", "utilize", "use-object"].includes(action.id)) {
      setInteractionFlow(action.id === "use-object" ? "utilize" : action.id as "help" | "ready" | "utilize"); setChoiceMode(null); setAttackFlow(null); setSpellFlow(null); setBreathFlow(null); return;
    }
    const feature = character.featureActions?.find((candidate) => candidate.id === action.id);
    if (feature) {
      if (character.id === "surina-daardendrian" && feature.id === "breath-weapon-gold") { setBreathFlow(feature); setFeedback("Select a creature to aim through, choose your shape, then roll damage."); return; }
      if (feature.resolution.type === "healing-pool") {
        setChoiceMode(null);
        setAttackFlow(null);
        setSpellFlow(null);
        setFeatureFlow({ feature, amount: 0, maximum: 0, afflictionEffectIds: [] });
        setToolFlow(null);
        setFeedback(`Choose a creature within touch range for ${feature.name}.`);
        return;
      }
      const result = executeFeatureAction(encounter, feature);
      if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
      setEncounter(result.encounter);
      setChoiceMode(null);
      setAttackFlow(null);
      setSpellFlow(null);
      setFeatureFlow(null);
      setToolFlow(null);
      setFeedback(result.summary);
      return;
    }
    const toolRule = toolRuleForAction(character, action.id);
    if (toolRule) {
      setChoiceMode(null);
      setAttackFlow(null);
      setSpellFlow(null);
      setFeatureFlow(null);
      setToolFlow({ rule: toolRule });
      setFeedback(`Choose which ability applies to this ${toolRule.name} check. ADaM will add tool proficiency automatically when the character has it.`);
      return;
    }
    if (skillActionChoices[action.id]) { setSkillFlow(action.id); setBreathFlow(null); setChoiceMode(null); setFeedback("Choose the skill for this action. Narrative outcomes require scenario or DM adjudication."); return; }
    const next = consumeAction(action, encounter);
    setEncounter(next);
    setChoiceMode(null);
    setFeatureFlow(null);
    setToolFlow(null);
    const targetCopy = action.targeting?.mode === "single" && targetAnalysis ? ` against ${targetAnalysis.target.name}` : "";
    const tacticalCopy = action.id === "dash"
      ? ` Your available movement is now ${next.turn.movementRemaining} feet and may be split around other choices.`
      : action.id === "disengage"
        ? " Your movement will not provoke opportunity attacks for the rest of this turn."
        : "";
    if (action.id === "stand-up") setResolutionReceipt(buildResolutionReceipt({ kind: "stand-up", before: encounter, after: next, actorId: playerCombatant.id, summary: `${playerCombatant.name} stands and is no longer Prone.` }));
    setFeedback(`${action.name}${targetCopy} accepted. This action does not require a dice roll.${tacticalCopy}`);
    if (action.id === "dash" || action.id === "disengage") focusSurface("map");
  }

  function chooseAttack(attack: CharacterAttack) {
    if (!encounter.turn.action) { setFeedback("Your Action has already been used this turn."); return; }
    setEncounter((state) => selectTarget(state, null));
    setAttackFlow({ attack, phase: "target" });
    setSpellFlow(null);
    setFeatureFlow(null);
    setToolFlow(null);
    setFeedback(`${attack.name} selected. Choose one of the highlighted enemy targets on the tactical map.`);
    focusSurface("map");
  }

  function confirmFeatureChoice(event: FormEvent) {
    event.preventDefault();
    if (!featureFlow?.targetId) return;
    const result = executeFeatureAction(encounter, featureFlow.feature, { resourceAmount: featureFlow.amount, targetCombatantId: featureFlow.targetId, removePoisoned: featureFlow.removePoisoned, afflictionEffectIds: featureFlow.afflictionEffectIds });
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter);
    setResolutionReceipt(buildResolutionReceipt({ kind: "lay-on-hands", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.summary }));
    setFeatureFlow(null);
    setFeedback(result.summary);
  }

  function chooseHealingTarget(targetId: string) {
    if (!featureFlow || featureFlow.feature.resolution.type !== "healing-pool") return;
    const option = healingPoolTargetOption(encounter, featureFlow.feature, targetId);
    if (!option.legal) { setFeedback(option.reason ?? "That creature cannot receive this feature now."); return; }
    const defaultPoison = option.maximumHealing === 0 && option.canRemovePoisoned;
    const defaultAfflictions = option.maximumHealing === 0 && !defaultPoison ? option.afflictionEffectIds.slice(0, 1) : [];
    setFeatureFlow({ ...featureFlow, targetId, amount: option.maximumHealing, maximum: option.maximumHealing, removePoisoned: defaultPoison, afflictionEffectIds: defaultAfflictions });
    const target = encounter.combatants.find((combatant) => combatant.id === targetId)!;
    setFeedback(`Choose healing and recovery for ${target.name}.`);
  }

  function chooseToolAbility(ability: AbilityName) {
    if (!toolFlow) return;
    const result = executeToolCheck(encounter, toolFlow.rule, ability);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setRollExplanation(explainD20Roll({
      kind: "ability-check",
      title: `${toolFlow.rule.name}: ${ability} check`,
      roll: result.roll,
      outcome: result.proficient ? "Tool proficiency included" : "No tool proficiency",
      nextStep: "Use this total to resolve the attempted task with the scenario or DM.",
    }));
    setToolFlow(null);
    setFeedback(result.summary);
  }

  function releaseConcentration() {
    let next = endConcentration(encounter, playerCombatant.id, `${playerCombatant.name} chose to stop`);
    if (next.pendingResponse?.type === "concentration-check" && next.pendingResponse.targetCombatantId === playerCombatant.id) {
      next = resolveConcentrationResponse(next).encounter;
    }
    setEncounter(next);
    setFeedback("Concentration ended. No Action was spent.");
  }

  function extendRageNow() {
    const result = extendRageWithBonusAction(encounter, playerCombatant.id);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setFeedback(result.summary);
  }

  function endLargeForm(effectId: string) {
    setEncounter(removeEffect(encounter, effectId, `${playerCombatant.name} chose to return to normal size`));
    setFeedback("Large Form ended. No Action was spent.");
  }

  function inspectMagicAuras() {
    const result = revealDetectMagicAuras(encounter, playerCombatant.id);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setFeedback(result.summary);
  }

  function rollInitiative() {
    if (!playerNeedsInitiative) return;
    const result = rollPlayerAndEnemyInitiative(encounter, playerNeedsInitiative.id);
    setEncounter(result.encounter);
    setLastRoll(result.playerRoll);
    setRollExplanation(explainD20Roll({
      kind: "initiative",
      title: `${playerNeedsInitiative.name}'s initiative`,
      roll: result.playerRoll,
      outcome: `Turn order position ${result.encounter.combatants.findIndex((combatant) => combatant.id === playerNeedsInitiative.id) + 1}`,
      nextStep: result.encounter.combatants[0].side === "player" ? "Choose Surina's movement or Action." : "Watch ADaM resolve the first enemy turn.",
    }));
    setScenarioBuilderOpen(false);
    const summary = `You rolled ${result.playerRoll.total}. ADaM rolled initiative for ${result.enemyRolls.length} ${result.enemyRolls.length === 1 ? "enemy" : "enemies"}. ${result.encounter.combatants[0].name} acts first.`;
    setFeedback(summary);
    setResolutionReceipt(buildResolutionReceipt({ kind: "initiative", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary, concealEnemyHitPoints: experienceMode === "advanced" }));
  }

  function castRitualBeforeInitiative(spell: CharacterSpell) {
    const result = executeRitualSpell(encounter, spell);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setFeedback(result.summary);
  }

  function rollSelectedAttack() {
    if (!attackFlow || attackFlow.phase !== "attack-roll") return;
    const result = resolveAttackRoll(encounter, attackFlow.attack);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    const attackTarget = encounter.combatants.find((combatant) => combatant.id === attackFlow.targetId);
    setRollExplanation(explainD20Roll({
      kind: "attack",
      title: `${attackFlow.attack.name} against ${attackTarget?.name ?? "target"}`,
      roll: result.roll,
      target: experienceMode === "advanced" || !attackTarget ? undefined : { label: `${attackTarget.name} AC`, value: effectiveArmorClass(encounter, attackTarget.id) },
      hiddenTargetLabel: experienceMode === "advanced" ? "Target AC" : undefined,
      outcome: result.hit ? "Hit" : "Miss",
      nextStep: result.hit ? "Roll damage to complete the attack." : "Move, choose another available option, or end the turn.",
    }));
    const updatedTarget = result.encounter.combatants.find((combatant) => combatant.id === attackFlow.targetId);
    const healthCopy = updatedTarget?.side === "enemy" && experienceMode !== "advanced" ? ` ${updatedTarget.name}: ${enemyHealthLabel(updatedTarget, experienceMode)}.` : "";
    setFeedback(`${result.summary}${healthCopy}`);
    setResolutionReceipt(buildResolutionReceipt({ kind: "attack", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.hit ? `${result.summary} Roll damage next.` : `${result.summary}${healthCopy}`, concealEnemyHitPoints: experienceMode === "advanced" }));
    if (result.hit) setAttackFlow({ ...attackFlow, phase: "damage-roll", critical: result.critical });
    else { setAttackFlow(null); setChoiceMode(null); }
  }

  function rollSelectedDamage(useSavageAttacker = false) {
    if (!attackFlow || attackFlow.phase !== "damage-roll" || !attackFlow.targetId || encounter.pendingResponse) return;
    const result = resolveAttackDamage(encounter, attackFlow.attack, attackFlow.targetId, attackFlow.critical, Math.random, undefined, { weaponDamageRerollChoice: useSavageAttacker ? "higher" : "skip" });
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    const damageTarget = encounter.combatants.find((combatant) => combatant.id === attackFlow.targetId);
    setRollExplanation(explainDamageRoll({
      title: `${attackFlow.attack.name} damage`,
      roll: result.roll,
      targetName: damageTarget?.name ?? "The target",
      nextStep: result.encounter.pendingResponse ? "Resolve the pending response before continuing." : "Use remaining movement or end the turn.",
    }));
    setFeedback(`${result.summary} You still have ${result.encounter.turn.movementRemaining} feet of movement and may use it before ending your turn.`);
    setResolutionReceipt(buildResolutionReceipt({ kind: "attack", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.summary, concealEnemyHitPoints: experienceMode === "advanced" }));
    setAttackFlow(null);
    setChoiceMode(null);
  }

  function chooseSpell(spell: CharacterSpell) {
    const availability = validateSpellAvailability(encounter, spell);
    if (!availability.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : availability.reason ?? "That spell is not available."); return; }
    setToolFlow(null);
    const resources = spellCastingResourceOptions(encounter, spell);
    if (resources.freeCast && resources.spellSlot) {
      setSpellFlow({ spell, phase: "resource" });
      setFeedback(`Choose whether to cast ${spell.name} with its free use or a spell slot.`);
      return;
    }
    continueSpellChoice(spell);
  }

  function continueSpellChoice(spell: CharacterSpell, castingResource?: SpellCastingResourceChoice) {
    const hasOtherFriendlyTarget = encounter.combatants.some((combatant) => combatant.id !== activeCombatant.id && combatant.side === activeCombatant.side && combatant.hitPoints.current > 0);
    if (spell.utilityChoices?.length) {
      setSpellFlow({ spell, phase: "option", castingResource });
      setAttackFlow(null);
      setToolFlow(null);
      setFeedback(`Choose the ${spell.name} effect you want to create.`);
      return;
    }
    if (spell.target === "point") {
      setSpellFlow({ spell, phase: "point", castingResource });
      setAttackFlow(null);
      setFeedback(`${spell.name} selected. Choose a point on the tactical map.`);
      focusSurface("map");
      return;
    }
    if (spell.target === "self-or-single" && spell.targetSide === "friendly" && !hasOtherFriendlyTarget) {
      const result = executeSpellChoice({ ...encounter, selectedTargetId: activeCombatant.id }, spell, Math.random, { castingResource });
      if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
      setEncounter(result.encounter); setLastRoll(result.roll); setChoiceMode(null); setSpellFlow(null); setFeedback(result.summary);
      return;
    }
    if (spell.target === "single" || spell.target === "self-or-single" || spell.target === "area") {
      setEncounter((state) => selectTarget(state, null));
      setSpellFlow({ spell, phase: "target", castingResource });
      setAttackFlow(null);
      setFeedback(`${spell.name} selected. Choose one of the highlighted legal targets on the tactical map.`);
      focusSurface("map");
      return;
    }
    const result = executeSpellChoice(encounter, spell, Math.random, { castingResource });
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter); setLastRoll(result.roll); setChoiceMode(null); setSpellFlow(null); setFeedback(result.summary);
  }

  function chooseSpellCastingResource(castingResource: SpellCastingResourceChoice) {
    if (!spellFlow || spellFlow.phase !== "resource") return;
    continueSpellChoice(spellFlow.spell, castingResource);
  }

  function chooseUtilitySpellChoice(utilityChoiceId: string) {
    if (!spellFlow || spellFlow.phase !== "option") return;
    const choice = spellFlow.spell.utilityChoices?.find((candidate) => candidate.id === utilityChoiceId);
    if (!choice) return;
    setSpellFlow({ ...spellFlow, phase: "point", utilityChoiceId });
    setFeedback(`${choice.name} selected. Choose a point within ${spellFlow.spell.rangeFeet} feet on the tactical map.`);
    focusSurface("map");
  }

  function rollSelectedSpellAttack() {
    if (!spellFlow || spellFlow.phase !== "attack-roll") return;
    const result = resolveSpellAttackRoll(encounter, spellFlow.spell);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setFeedback(result.summary);
    if (result.hit && spellFlow.spell.damage) setSpellFlow({ ...spellFlow, phase: "damage-roll", critical: result.critical });
    else { setSpellFlow(null); setChoiceMode(null); }
  }

  function rollSelectedSpellDamage() {
    if (!spellFlow || spellFlow.phase !== "damage-roll" || !spellFlow.targetId) return;
    const result = resolveSpellDamage(encounter, spellFlow.spell, spellFlow.targetId, spellFlow.critical);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setFeedback(`${result.summary} You still have ${result.encounter.turn.movementRemaining} feet of movement and may use it before ending your turn.`);
    setSpellFlow(null);
    setChoiceMode(null);
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const action = findActionFromText(command, rulesetId, character);
    if (!action) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : "I could not match that request to a supported action yet. Try naming the action directly."); return; }
    runAction(action); setCommand("");
  }

  function buildScenario(event: FormEvent) {
    event.preventDefault();
    const setup: ScenarioSetup = { prompt: setupMode === "guided" ? "" : scenarioPrompt, environment, objective, difficulty };
    const next = generateScriptedScenario(setupMode === "describe" ? scenarioPrompt : setup);
    if (doorPractice) next.grid = { ...next.grid, terrain: [...next.grid.terrain.filter(c => c.x !== 2 || c.y < 5), { x: 2, y: 5, kind: "wall", label: "Door frame" }, { x: 2, y: 7, kind: "wall", label: "Door frame" }, { x: 2, y: 6, kind: "wall", label: "Squeaky practice door", door: { locked: false, noisy: true } }] };
    const nextEncounter = createPlayableEncounter(sourceCharacter, next);
    setInteractionFlow(null); setUtilityTargetFlow(null); setSkillFlow(null); setBreathFlow(null); setScenario(next); setEncounter(nextEncounter); setAttackFlow(null); setSpellFlow(null); setFeatureFlow(null); setToolFlow(null); setChoiceMode(null); setEnemyTurnPhase("idle"); setFeedback(`${next.opening} Roll your initiative to begin.`); setRollExplanation(null); setResolutionReceipt(buildResolutionReceipt({ kind: "new-encounter", before: encounter, after: nextEncounter, actorId: sourceCharacter.id, summary: `${next.opening} The encounter is reset and ready for initiative.` }));
    setScenarioBuilderOpen(false);
  }

  function loadTemplate(template: ScenarioTemplate) {
    setScenarioPrompt(template.setup.prompt);
    setEnvironment(template.setup.environment);
    setObjective(template.setup.objective);
    setDifficulty(template.setup.difficulty);
    const next = generateScriptedScenario(template.setup);
    if (doorPractice) next.grid = { ...next.grid, terrain: [...next.grid.terrain.filter(c => c.x !== 2 || c.y < 5), { x: 2, y: 5, kind: "wall", label: "Door frame" }, { x: 2, y: 7, kind: "wall", label: "Door frame" }, { x: 2, y: 6, kind: "wall", label: "Squeaky practice door", door: { locked: false, noisy: true } }] };
    const nextEncounter = createPlayableEncounter(sourceCharacter, next);
    setInteractionFlow(null); setUtilityTargetFlow(null); setSkillFlow(null); setBreathFlow(null); setScenario(next); setEncounter(nextEncounter); setAttackFlow(null); setSpellFlow(null); setFeatureFlow(null); setToolFlow(null); setChoiceMode(null); setEnemyTurnPhase("idle"); setFeedback(`${template.name} loaded. ${next.opening} Roll your initiative to begin.`); setRollExplanation(null); setResolutionReceipt(buildResolutionReceipt({ kind: "new-encounter", before: encounter, after: nextEncounter, actorId: sourceCharacter.id, summary: `${template.name} loaded. The encounter is reset and ready for initiative.` }));
    setScenarioBuilderOpen(false);
  }

  function saveTemplate() {
    const template: ScenarioTemplate = {
      id: `saved-${Date.now()}`,
      name: `${scenario.title} · ${scenario.difficulty}`,
      description: scenarioPrompt || `${scenario.objective} in ${scenario.environment}`,
      setup: { prompt: scenarioPrompt, environment, objective, difficulty },
    };
    const next = [...savedTemplates, template];
    setSavedTemplates(next);
    localStorage.setItem("adam-scenario-templates", JSON.stringify(next));
    setFeedback("Scenario setup saved on this device.");
  }

  function handleGridMove(x: number, y: number) {
    const result = moveActiveCombatant(encounter, x, y);
    if (result.legal) {
      setEncounter(result.encounter);
      setResolutionReceipt(buildResolutionReceipt({ kind: "movement", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.reason, concealEnemyHitPoints: experienceMode === "advanced" }));
    }
    if (result.damageRoll ?? result.attackRoll) setLastRoll(result.damageRoll ?? result.attackRoll);
    setFeedback(result.reason);
  }

  function handleGridInteraction(x: number, y: number, occupantId?: string) {
    if (!initiativeReady) { setFeedback("Finish rolling initiative before interacting with the map."); return; }
    if (activeCombatant.side !== "player") { setFeedback("ADaM controls targeting and movement during enemy turns."); return; }
    if (utilityTargetFlow === "influence") {
      if (!occupantId || !legalUtilityTargetIds.has(occupantId)) { setFeedback("Choose a highlighted creature within 30 feet and clear line of sight for Influence."); return; }
      const targetedEncounter = selectTarget(encounter, occupantId);
      setEncounter(targetedEncounter);
      setUtilityTargetFlow(null);
      setSkillFlow("influence");
      setFeedback(`Influence target selected: ${targetedEncounter.combatants.find((combatant) => combatant.id === occupantId)?.name}. Choose the social skill that matches Surina's approach.`);
      focusSurface("actions");
      return;
    }
    if (spellFlow?.phase === "point") {
      const result = executePointSpell(encounter, spellFlow.spell, [{ x, y }], Math.random, spellFlow.utilityChoiceId);
      if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Point disallowed." : result.reason); return; }
      setEncounter(result.encounter);
      if (result.damageRoll) setLastRoll(result.damageRoll);
      setSpellFlow(null);
      setChoiceMode(null);
      setFeedback(result.summary);
      return;
    }
    if (attackFlow?.phase === "target") {
      if (!occupantId) { setFeedback(`Choose a highlighted creature for ${attackFlow.attack.name}.`); return; }
      const validation = validateAttackTarget(encounter, attackFlow.attack, occupantId);
      if (!validation.legal) { setFeedback(experienceMode === "advanced" ? "Target disallowed." : validation.reason ?? "That target is not legal."); return; }
      const analysis = analyzeTarget(encounter, occupantId)!;
      const rollMode = validation.rollMode === "disadvantage" ? " Roll two d20s and use the lower result because the attack is at long range or a hostile creature is within 5 feet." : "";
      setEncounter((state) => selectTarget(state, occupantId));
      setAttackFlow({ ...attackFlow, phase: "attack-roll", targetId: occupantId });
      setFeedback(`${analysis.target.name} selected at ${analysis.distanceFeet} feet. Click to roll the attack: d20 ${attackFlow.attack.attackBonus >= 0 ? "+" : "−"} ${Math.abs(attackFlow.attack.attackBonus)}.${rollMode}`);
      focusSurface("response");
      return;
    }
    if (spellFlow?.phase === "target") {
      if (!occupantId) { setFeedback(`Choose a highlighted creature for ${spellFlow.spell.name}.`); return; }
      const validation = validateSpellTarget(encounter, spellFlow.spell, occupantId);
      if (!validation.legal || !legalSpellTargetIds.has(occupantId)) { setFeedback(experienceMode === "advanced" ? "Target disallowed." : validation.reason ?? "That target is not legal for this spell."); return; }
      const analysis = analyzeTarget(encounter, occupantId)!;
      const targetedEncounter = selectTarget(encounter, occupantId);
      setEncounter(targetedEncounter);
      if (spellFlow.spell.attackBonus !== undefined) {
        const rollMode = validation.rollMode === "disadvantage" ? " Roll two d20s and use the lower result because a hostile creature is within 5 feet." : "";
        setSpellFlow({ ...spellFlow, phase: "attack-roll", targetId: occupantId });
        setFeedback(`${analysis.target.name} selected at ${analysis.distanceFeet} feet. Click to roll the spell attack: d20 ${spellFlow.spell.attackBonus >= 0 ? "+" : "−"} ${Math.abs(spellFlow.spell.attackBonus)}.${rollMode}`);
        focusSurface("response");
        return;
      }
      const result = executeSpellChoice(targetedEncounter, spellFlow.spell, Math.random, { castingResource: spellFlow.castingResource });
      if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
      setEncounter(result.encounter);
      setLastRoll(result.roll);
      setSpellFlow(null);
      setChoiceMode(null);
      setFeedback(result.summary);
      return;
    }
    if (!occupantId) { handleGridMove(x, y); return; }
    if (occupantId === activeCombatant.id) {
      setEncounter((state) => selectTarget(state, null));
      setFeedback("Target cleared. Select another creature before choosing a targeted action.");
      return;
    }
    const analysis = analyzeTarget(encounter, occupantId);
    if (!analysis) return;
    setEncounter((state) => selectTarget(state, occupantId));
    setFeedback(`${analysis.target.name} selected at ${analysis.distanceFeet} feet. Line of sight: ${analysis.lineOfSight ? "clear" : "blocked"}. Cover: ${analysis.cover}.`);
  }

  return <main className="app-shell">
    <header className="topbar"><div><span className="eyebrow">ADaM · Automated Dungeon & Mechanics</span><h1>Combat Trainer</h1></div><div className="status"><span />Rules engine active</div></header>
    {pendingImport && reviewCharacter && <div className="import-review-backdrop">
      <form className="import-review" onSubmit={confirmReviewedImport} role="dialog" aria-modal="true" aria-labelledby="import-review-title">
        <div className="import-review-heading"><div><span className="eyebrow">Flattened PDF detected</span><h2 id="import-review-title">Review imported character</h2></div><span className="import-count">{reviewCharacter.attacks?.length ?? 0} attacks found</span></div>
        <p className="import-review-note">{pendingImport.warnings.join(" ")} Correct anything that does not match the PDF, then load the character into combat.</p>
        <div className="import-core-grid">
          <label>Character name<input required value={reviewCharacter.name} onChange={(event) => setReviewCharacter({ ...reviewCharacter, name: event.target.value })} /></label>
          <label>Class<input required value={reviewCharacter.className} onChange={(event) => setReviewCharacter({ ...reviewCharacter, className: event.target.value })} /></label>
          <label>Level<input required min="1" max="20" type="number" value={reviewCharacter.level} onChange={(event) => updateReviewNumber("level", event.target.value)} /></label>
          <label>Armor class<input required min="1" type="number" value={reviewCharacter.armorClass} onChange={(event) => updateReviewNumber("armorClass", event.target.value)} /></label>
          <label>Current HP<input required min="0" type="number" value={reviewCharacter.hitPoints.current} onChange={(event) => updateReviewHitPoints("current", event.target.value)} /></label>
          <label>Maximum HP<input required min="1" type="number" value={reviewCharacter.hitPoints.maximum} onChange={(event) => updateReviewHitPoints("maximum", event.target.value)} /></label>
          <label>Proficiency bonus<input required min="0" type="number" value={reviewCharacter.proficiencyBonus} onChange={(event) => updateReviewNumber("proficiencyBonus", event.target.value)} /></label>
          <label>Walking speed<input required min="0" step="5" type="number" value={reviewCharacter.speedFeet ?? 30} onChange={(event) => updateReviewNumber("speedFeet", event.target.value)} /></label>
        </div>
        <div className="import-ability-grid">{abilityLabels.map((ability) => <label key={ability.id}>{ability.label}<input required min="1" max="30" type="number" value={reviewCharacter.abilities[ability.id]} onChange={(event) => updateReviewAbility(ability.id, event.target.value)} /></label>)}</div>
        {(reviewCharacter.attacks?.length ?? 0) > 0 && <div className="import-attacks"><span>Imported attacks</span><p>{reviewCharacter.attacks?.map((attack) => `${attack.name} (${attack.attackBonus >= 0 ? "+" : ""}${attack.attackBonus}, ${attack.damage}, ${attack.normalRangeFeet}${attack.longRangeFeet ? `/${attack.longRangeFeet}` : ""} ft.)`).join(" · ")}</p></div>}
        {importMechanicCoverage && <div className="mechanic-coverage import-coverage"><div><span>Mechanic coverage</span><strong>{importMechanicCoverage.supportSummary.fullySupported}/{importMechanicCoverage.total} fully supported</strong></div><p><b>{importMechanicCoverage.supportSummary.fullySupported}</b> supported · <b>{importMechanicCoverage.supportSummary.partial}</b> partial · <b>{importMechanicCoverage.supportSummary.descriptive}</b> descriptive</p><small>Detected edition: {editionLabel(detectCharacterEdition(reviewCharacter).edition)} · Source: {reviewCharacter.source.fileName ?? "ADaM sample"} · {editionLabel(detectCharacterEdition(reviewCharacter).edition)} source assessment</small></div>}
        <div className="import-review-actions"><button type="button" onClick={() => { setPendingImport(null); setReviewCharacter(null); setMessage("Import canceled; the previous character remains active."); }}>Cancel</button><button type="submit">Use this character</button></div>
      </form>
    </div>}
    <section className="workspace">
      <aside className="sidebar">
        <div className="panel"><div className="panel-heading"><span>01</span><h2>Character</h2></div><label className="file-button">Import character sheet<input type="file" accept="application/pdf,application/json,.json,.pdf" onChange={handleImport} /></label><p className="helper">{message}</p></div>
        <section className="character-roster" aria-label="Stored character roster">
          <div className="roster-heading"><div><span>Stored characters</span><strong>Encounter roster</strong></div><em>{storedCharacters.length}/{CHARACTER_ROSTER_LIMIT}</em></div>
          {storedCharacters.length ? <div className="roster-list">{storedCharacters.map((storedCharacter) => <div key={storedCharacter.id} className={`roster-entry ${character.id === storedCharacter.id ? "active" : ""}`}>
            <button type="button" className="roster-select" onClick={() => selectStoredCharacter(storedCharacter.id)} aria-label={`Load ${storedCharacter.name} into the encounter`}>
              <span>{storedCharacter.name[0]?.toUpperCase()}</span><div><strong>{storedCharacter.name}</strong><small>{storedCharacter.className} {storedCharacter.level} · AC {storedCharacter.armorClass} · HP {storedCharacter.hitPoints.maximum} · {storedCharacter.attacks?.length ?? 0} attacks · {storedCharacter.spells?.length ?? 0} spells</small></div>
            </button>
            <button type="button" className="roster-remove" onClick={() => deleteStoredCharacter(storedCharacter.id)} aria-label={`Remove ${storedCharacter.name} from stored characters`}>Remove</button>
          </div>)}</div> : <div className="roster-empty"><strong>Five upload slots available</strong><p>Import and review a character sheet to save it here for future encounters.</p></div>}
        </section>
        <div className="character-card"><div className="portrait">{character.name[0]?.toUpperCase()}</div><div><p className="character-name">{character.name}</p><p>{character.className} · Level {character.level}</p></div></div>
        <div className="stats"><div><span>AC</span><strong>{playerArmorClass}</strong>{playerArmorClass !== character.armorClass && <small>base {character.armorClass}</small>}</div><div><span>HP</span><strong>{playerCombatant.hitPoints.current}/{playerCombatant.hitPoints.maximum}</strong>{playerCombatant.temporaryHitPoints > 0 && <small>+{playerCombatant.temporaryHitPoints} temp</small>}</div><div><span>PROF</span><strong>+{character.proficiencyBonus}</strong></div></div>
        <div className="weapon-summary"><span>Weapon attacks</span><strong>{character.attacks?.length ?? 0} ready</strong><p>{character.attacks?.map((attack) => attack.name).join(" · ") || "No weapon attacks imported."}</p></div>
        <div className="mechanic-coverage"><div><span>Source mechanic coverage</span><strong>{mechanicCoverage.supportSummary.fullySupported}/{mechanicCoverage.total} fully supported</strong></div><p><b>{mechanicCoverage.supportSummary.fullySupported}</b> supported · <b>{mechanicCoverage.supportSummary.partial}</b> partial · <b>{mechanicCoverage.supportSummary.descriptive}</b> descriptive</p>{playableMechanicCoverage.total !== mechanicCoverage.total || playableMechanicCoverage.supportSummary.fullySupported !== mechanicCoverage.supportSummary.fullySupported ? <p><b>Trainer profile: {playableMechanicCoverage.supportSummary.fullySupported}/{playableMechanicCoverage.total} fully supported.</b> Derived resolution can add a verified weapon mode or exclude a label that was not actually granted, without rewriting the source.</p> : null}<small>{mechanicCoverage.sourceId === "user-imported" ? character.source.fileName ?? "Imported sheet" : "ADaM original"} · {editionLabel(playable.assessment.edition)}</small></div>
        <div className="panel"><div className="panel-heading"><span>02</span><h2>Experience</h2></div><div className="mode-list">{(Object.keys(modeCopy) as ExperienceMode[]).map((mode) => <button key={mode} className={experienceMode === mode ? "selected" : ""} onClick={() => { setExperienceMode(mode); setFeedback(modeCopy[mode].detail); }}><strong>{modeCopy[mode].label}</strong><small>{modeCopy[mode].detail}</small></button>)}</div></div>
        <div className="panel"><div className="panel-heading"><span>03</span><h2>Character &amp; combat rules</h2></div><p><strong>Character source: {editionLabel(playable.assessment.edition)}</strong> · {playable.assessment.confidence} confidence</p><p><strong>Combat resolution: 2024</strong></p>{playable.assessment.evidence.length > 0 && <details><summary>Edition evidence</summary><ul>{playable.assessment.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details>}{playable.notes.map((note) => <p key={note}>{note}</p>)}<small>Separate 2014 and 2024 combat settings are planned. Compatibility coverage is still being audited; this is not a complete conversion of every legacy mechanic.</small></div>
      </aside>

      <section className="combat-area">
        <div className="combat-heading"><div><span className="eyebrow">Scripted scenario engine</span><h2>{scenario.title}</h2></div><div className="rules-badge">{activeRuleset.label}</div></div>
        <div className="scenario-editor-bar"><div><span>Encounter setup</span><strong>{scenarioBuilderOpen ? "Choose or revise the training encounter" : "Setup hidden while you play"}</strong></div><button type="button" aria-expanded={scenarioBuilderOpen} onClick={() => setScenarioBuilderOpen((open) => !open)}>{scenarioBuilderOpen ? "Hide setup" : "Edit setup"}</button></div>
        {scenarioBuilderOpen && <section className="scenario-studio">
          <div className="setup-tabs" aria-label="Scenario setup method">{(Object.keys(setupModeCopy) as ScenarioSetupMode[]).map((mode) => <button key={mode} type="button" className={setupMode === mode ? "active" : ""} onClick={() => setSetupMode(mode)}><strong>{setupModeCopy[mode].label}</strong><small>{setupModeCopy[mode].detail}</small></button>)}</div>
          <label><input type="checkbox" checked={doorPractice} onChange={event => setDoorPractice(event.target.checked)} /> Include an unlocked practice door beside the starting position</label>
          {setupMode === "templates" ? <div className="template-grid">{[...scenarioTemplates, ...savedTemplates].map((template) => <button type="button" key={template.id} onClick={() => loadTemplate(template)}><span>{template.setup.difficulty}</span><strong>{template.name}</strong><small>{template.description}</small></button>)}</div> : <form className="scenario-builder" onSubmit={buildScenario}>
            {(setupMode === "describe" || setupMode === "combined") && <label className="prompt-field">Describe the encounter you want<input value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} placeholder="A ruined crypt where I must rescue a trapped scholar" /></label>}
            {(setupMode === "guided" || setupMode === "combined") && <div className="guided-controls">
              <label>Environment<select value={environment} onChange={(event) => setEnvironment(event.target.value as ScenarioEnvironment)}><option value="crypt">Ruined crypt</option><option value="forest">Dense forest</option><option value="market">Abandoned market</option></select></label>
              <label>Objective<select value={objective} onChange={(event) => setObjective(event.target.value as ScenarioObjective)}><option value="defeat">Defeat enemies</option><option value="rescue">Rescue a civilian</option><option value="escape">Reach the exit</option><option value="hold">Hold a position</option></select></label>
              <label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as ScenarioDifficulty)}><option value="easy">Easy</option><option value="standard">Standard</option><option value="hard">Hard</option></select></label>
            </div>}
            <div className="scenario-actions"><button className="generate-button">Build encounter</button><button type="button" className="save-button" onClick={saveTemplate}>Save setup</button></div>
          </form>}
        </section>}
        <div className="scenario-summary"><div><span>Objective</span><strong>{scenario.objective}</strong></div><div><span>Terrain</span><strong>{scenario.features.join(" · ")}</strong></div><div><span>Difficulty</span><strong>{scenario.difficulty}</strong></div></div>

        {character.id === "surina-daardendrian" && <section className={`surina-play-guide phase-${surinaGuide.phase}`} aria-live="polite">
          <div className="guide-progress" aria-label={`Surina turn guide, step ${surinaGuide.step} of 4`}>
            {["Start", "Choose", "Resolve", "Finish"].map((label, index) => <div key={label} className={index + 1 === surinaGuide.step ? "current" : index + 1 < surinaGuide.step ? "complete" : ""}><span>{index + 1}</span><strong>{label}</strong></div>)}
          </div>
          <div className="guide-body"><div><span>Surina play guide · Next step</span><h3>{surinaGuide.title}</h3><p>{surinaGuide.detail}</p></div><div className="guide-actions">{surinaGuide.primaryLabel && <button type="button" onClick={followGuidePrimary}>{surinaGuide.primaryLabel}</button>}{surinaGuide.secondaryLabel && <button type="button" className="secondary" onClick={followGuideSecondary}>{surinaGuide.secondaryLabel}</button>}</div></div>
          <div className="guide-vitals"><span><b>{playerCombatant.hitPoints.current}/{playerCombatant.hitPoints.maximum}</b> HP</span><span><b>{playerArmorClass}</b> AC</span><span><b>{encounter.turn.movementRemaining} ft.</b> movement</span><span><b>{encounter.turn.action ? "Ready" : "Used"}</b> Action</span><span><b>{playerCombatant.reactionAvailable ? "Ready" : "Used"}</b> Reaction</span></div>
        </section>}

        {character.id === "surina-daardendrian" && resolutionReceipt && <section className={`resolution-receipt receipt-${resolutionReceipt.kind}`} aria-live="polite">
          <div className="receipt-heading"><div><span>{resolutionReceipt.eyebrow}</span><h3>{resolutionReceipt.title}</h3></div><button type="button" onClick={() => setResolutionReceipt(null)}>Dismiss</button></div>
          <p>{resolutionReceipt.summary}</p>
          <div className="receipt-changes" aria-label="What changed">{resolutionReceipt.changes.map((change) => <span key={change}>{change}</span>)}</div>
        </section>}

        {character.id === "surina-daardendrian" && rollExplanation && <section className={`roll-explanation roll-explanation-${rollExplanation.kind}`} aria-live="polite">
          <div className="roll-explanation-main"><span>{rollExplanation.eyebrow}</span><h3>{rollExplanation.title}</h3><p>{rollExplanation.formula} = <strong>{rollExplanation.total}</strong></p></div>
          <div className="roll-explanation-result"><span>Resolution</span><strong>{rollExplanation.comparison}</strong><p>Next: {rollExplanation.nextStep}</p></div>
          <button type="button" onClick={() => setRollExplanation(null)}>Dismiss</button>
        </section>}

        <div className="guided-response-stack" data-guided-step="true">
        {encounter.pendingResponse?.type === "point-hazard-save" && <section className="roll-coach" aria-live="polite"><div><h3>{encounter.pendingResponse.name}</h3><p>Roll your saving throw. Overlapping hazards resolve one at a time, including defensive choices and concentration.</p></div><button type="button" onClick={rollPendingPointHazard}>Roll hazard save</button></section>}
        {grappleEffectsOn(encounter, playerCombatant.id).map(effect => {
          const source = encounter.combatants.find(c => c.id === effect.sourceCombatantId);
          const canEscape = initiativeReady && activeCombatant.id === playerCombatant.id && encounter.turn.action && !encounter.pendingResponse;
          return <section className="roll-coach response-coach" aria-label="Escape grapple" key={`escape-${effect.id}`}>
            <div><span>Grappled</span><h3>Escape {source?.name ?? "grappler"}</h3><p>Your Speed is 0. Use your Action to roll Athletics or Acrobatics against DC {effect.grapple?.escapeDc}. You may attack the grappler normally; attacks against other targets have Disadvantage.</p></div>
            <div className="response-actions"><button type="button" disabled={!canEscape} onClick={() => escapeGrapple(effect.id, "athletics")}>Escape with Athletics</button><button type="button" disabled={!canEscape} onClick={() => escapeGrapple(effect.id, "acrobatics")}>Escape with Acrobatics</button></div>
          </section>;
        })}
        {playerCombatant.heldWeaponIds !== undefined && <section className="roll-coach" aria-label="Held weapons">
          <div><h3>Held weapons</h3><p>{!initiativeReady ? "Choose what you hold before rolling initiative. Unselected weapons remain carried." : "Draw or stow: first interaction is free, then uses an Action. Two-handed attacks need the other hand free."}</p>
            {playerCombatant.inventory.filter(item => item.attackIds.length && item.current > 0).map(item => <button type="button" key={item.id} disabled={Boolean(encounter.pendingResponse) || (initiativeReady && activeCombatant.id !== playerCombatant.id)} onClick={() => changeHeldWeapon(item.id)}>{playerCombatant.heldWeaponIds!.includes(item.id) ? "Stow" : "Draw"} {item.name}</button>)}
            <p>In hand: {[...playerCombatant.inventory.filter(item => playerCombatant.heldWeaponIds!.includes(item.id)).map(item => item.name), ...grappleEffectsFrom(encounter, playerCombatant.id).map(effect => `grappling ${encounter.combatants.find(c => c.id === effect.targetCombatantId)?.name ?? "creature"}`)].join(", ") || "none (Unarmed Strike available)"}</p>
            {grappleEffectsFrom(encounter, playerCombatant.id).map(effect => <button type="button" key={`release-${effect.id}`} disabled={Boolean(encounter.pendingResponse)} onClick={() => voluntarilyReleaseGrapple(effect.id)}>Release {encounter.combatants.find(c => c.id === effect.targetCombatantId)?.name ?? "grapple"} · No Action</button>)}
          </div>
        </section>}
        {!initiativeReady && playerNeedsInitiative && <section className="roll-coach initiative-coach" aria-live="polite">
          <div><span>Your initiative · Click to roll</span><h3>{playerNeedsInitiative.name}</h3><p>Roll a <strong>d20</strong> and add your initiative modifier ({playerNeedsInitiative.initiativeModifier >= 0 ? "+" : "−"}{Math.abs(playerNeedsInitiative.initiativeModifier)}). ADaM rolls enemy initiative privately and then reveals turn order.</p>{playerNeedsInitiative.spells.filter((spell) => spell.ritual).map((spell) => <button type="button" key={`ritual-${spell.id}`} onClick={() => castRitualBeforeInitiative(spell)}>Cast {spell.name} as a 10-minute ritual · No slot</button>)}</div>
          <button type="button" onClick={rollInitiative}><small>Roll your initiative</small><strong>d20 {playerNeedsInitiative.initiativeModifier >= 0 ? "+" : "−"} {Math.abs(playerNeedsInitiative.initiativeModifier)}</strong></button>
        </section>}
        {initiativeReady && activeCombatant.side === "enemy" && outcome === "active" && <section className="roll-coach enemy-coach" aria-live="polite">
          <div><span>DM-controlled turn · {modeCopy[experienceMode].label} tactics · {enemyTurnPhase}</span><h3>{activeCombatant.name}</h3><p>ADaM controls this creature&apos;s movement, targeting, action selection, attack roll, and damage roll. Tactical decision quality scales with the selected experience mode.</p></div>
          <div className="dm-turn-badge"><strong>ADaM</strong><small>resolving enemy</small></div>
        </section>}
        {encounter.pendingResponse?.type === "readied-attack" && <div className="response-panel"><h3>Readied attack</h3><p>{encounter.pendingResponse.trigger === "finishes-moving" ? "The selected enemy finished moving." : "The selected enemy became a legal target for your prepared weapon."} Release your prepared attack or ignore this trigger.</p>{[...(encounter.pendingResponse.phase === "choice" ? ["accept", "decline"] : ["roll"])].map(choice => <button type="button" key={choice} onClick={() => {
          const result = resolveReadiedAttack(encounter, choice as "accept" | "decline" | "roll");
          setEncounter(result.encounter); if ("roll" in result && result.roll) setLastRoll(result.roll); setFeedback(result.summary);
          setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : "resolving");
        }}>{choice === "accept" ? "Use Reaction" : choice === "decline" ? "Ignore trigger" : encounter.pendingResponse?.type === "readied-attack" && encounter.pendingResponse.phase === "damage-roll" ? "Roll damage" : "Roll attack"}</button>)}</div>}
        {encounter.pendingResponse?.type === "saving-throw" && (() => {
          const pending = encounter.pendingResponse;
          const modifier = effectiveSavingThrowModifier(encounter, pending.targetCombatantId, pending.ability.saveAbility);
          return <section className="roll-coach response-coach" aria-live="assertive">
            <div><span>Player response · Saving throw</span><h3>{pending.ability.name}</h3><p>Roll a <strong>d20</strong> and add your {pending.ability.saveAbility} saving throw modifier ({modifier >= 0 ? "+" : "−"}{Math.abs(modifier)}). Meet or beat DC {pending.ability.saveDc}. ADaM rolls the damage after your save.</p></div>
            <button type="button" onClick={rollPendingSavingThrow}><small>Roll {pending.ability.saveAbility} save</small><strong>d20 {modifier >= 0 ? "+" : "−"} {Math.abs(modifier)}</strong></button>
          </section>;
        })()}
        {encounter.pendingResponse?.type === "attack-reaction" && (() => {
          const pending = encounter.pendingResponse;
          const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
          return <section className="roll-coach response-coach reaction-coach" aria-live="assertive">
            <div><span>Player response · Reaction window</span><h3>ADaM rolled {pending.attackTotal} against AC {pending.targetArmorClass}</h3><p>The attack would hit. Choose an available reaction before ADaM rolls damage. Reactions reset at the start of your next turn.</p><div className="response-actions">{target.reactionOptions.filter((option) => pending.availableReactionIds.includes(option.id)).map((option) => <button type="button" key={option.id} onClick={() => choosePendingReaction(option.id)}><small>Use reaction</small><strong>{option.name}</strong><em>{option.description}</em></button>)}<button type="button" className="decline-response" onClick={() => choosePendingReaction(null)}><small>No reaction</small><strong>Take the hit</strong></button></div></div>
          </section>;
        })()}
        {encounter.pendingResponse?.type === "opportunity-attack" && (() => {
          const pending = encounter.pendingResponse;
          const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId)!;
          const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
          const attack = source.attacks.find((candidate) => candidate.id === pending.attackId);
          return <section className="roll-coach response-coach reaction-coach opportunity-coach" aria-live="assertive">
            <div><span>Player response · Opportunity attack</span><h3>{target.name} is leaving your reach</h3>
              {pending.phase === "choice" && <><p>You may spend your reaction to make one melee attack before {target.name} moves, or save the reaction for another trigger.</p><div className="response-actions">{source.attacks.filter((candidate) => pending.availableAttackIds.includes(candidate.id)).map((candidate) => <button type="button" key={candidate.id} onClick={() => choosePendingOpportunityAttack(candidate.id)}><small>Use reaction</small><strong>{candidate.name}</strong><em>{candidate.damage} · {candidate.attackBonus >= 0 ? "+" : ""}{candidate.attackBonus} to hit</em></button>)}<button type="button" className="decline-response" onClick={() => choosePendingOpportunityAttack(null)}><small>Save reaction</small><strong>Let them move</strong></button></div></>}
              {pending.phase === "attack-roll" && attack && <p>Roll a <strong>d20</strong> and add {attack.attackBonus >= 0 ? "+" : "−"}{Math.abs(attack.attackBonus)}. This reaction is separate from your Action on your own turn.</p>}
              {pending.phase === "damage-roll" && attack && <p>The opportunity attack hit. Roll <strong>{attack.damage}</strong>{pending.critical ? " with doubled damage dice for the critical hit" : ""} before movement continues.</p>}
            </div>
            {pending.phase === "attack-roll" && attack && <button type="button" onClick={rollPendingOpportunityAttack}><small>Roll opportunity attack</small><strong>d20 {attack.attackBonus >= 0 ? "+" : "−"} {Math.abs(attack.attackBonus)}</strong></button>}
            {pending.phase === "damage-roll" && attack && <button type="button" onClick={rollPendingOpportunityDamage}><small>Roll opportunity damage</small><strong>{attack.damage}</strong></button>}
          </section>;
        })()}
        {encounter.pendingResponse?.type === "concentration-check" && (() => {
          const pending = encounter.pendingResponse;
          const modifier = effectiveSavingThrowModifier(encounter, pending.targetCombatantId, "constitution");
          return <section className="roll-coach response-coach concentration-coach" aria-live="assertive">
            <div><span>Player response · Concentration</span><h3>Maintain concentration</h3><p>You took {pending.damageTaken} damage while concentrating. Roll a <strong>Constitution saving throw</strong> against DC {pending.dc}.</p></div>
            <button type="button" onClick={rollPendingConcentration}><small>Roll concentration</small><strong>d20 {modifier >= 0 ? "+" : "−"} {Math.abs(modifier)}</strong></button>
          </section>;
        })()}
        {encounter.pendingResponse?.type === "zero-hit-point-replacement" && (() => {
          const pending = encounter.pendingResponse;
          const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
          const feature = target.triggeredFeatures.find((candidate) => candidate.id === pending.featureId)!;
          return <section className="roll-coach response-coach reaction-coach" aria-live="assertive">
            <div><span>Player response · Zero HP replacement</span><h3>{feature.name}</h3><p>{target.name} was reduced to 0 HP but was not killed outright. Spend the once-per-long-rest use to drop to 1 HP instead, or save it and fall unconscious.</p><div className="response-actions"><button type="button" onClick={() => chooseZeroHitPointReplacement(true)}><small>Spend one use</small><strong>Drop to 1 HP</strong><em>This does not use your Reaction.</em></button><button type="button" className="decline-response" onClick={() => chooseZeroHitPointReplacement(false)}><small>Save the feature</small><strong>Fall unconscious</strong></button></div></div>
          </section>;
        })()}
        {encounter.pendingResponse?.type === "damage-reduction-reaction" && (() => {
          const pending = encounter.pendingResponse;
          const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
          const feature = target.triggeredFeatures.find((candidate) => candidate.id === pending.featureId)!;
          const reduction = feature.resolution.type === "reduce-damage-by-roll" ? `${feature.resolution.die} + ${feature.resolution.modifier}` : "damage reduction";
          return <section className="roll-coach response-coach reaction-coach" aria-live="assertive">
            <div><span>Player response · Damage reaction</span><h3>{feature.name}</h3><p>{target.name} is about to take {pending.damageTaken} damage. Spend a Reaction and one use to roll <strong>{reduction}</strong> and reduce it, or save the reaction and take the full damage.</p><div className="response-actions"><button type="button" onClick={() => chooseDamageReductionReaction(true)}><small>Use reaction · Spend one use</small><strong>Roll {reduction}</strong><em>The reduction can lower this damage to 0.</em></button><button type="button" className="decline-response" onClick={() => chooseDamageReductionReaction(false)}><small>Save reaction</small><strong>Take {pending.damageTaken} damage</strong></button></div></div>
          </section>;
        })()}
        {encounter.pendingResponse?.type === "weapon-mastery-choice" && (() => {
          const pending = encounter.pendingResponse;
          const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
          const slow = pending.mastery === "slow";
          return <section className="roll-coach response-coach reaction-coach" aria-live="assertive">
            <div><span>Player choice · Weapon mastery</span><h3>Apply {slow ? "Slow" : "Topple"} with {pending.attackName}?</h3><p>{slow ? `The attack damaged ${target.name}. You may reduce its Speed by 10 feet until the start of your next turn.` : `${target.name} can make a Constitution save against DC ${pending.saveDc}; on a failure it becomes Prone.`}</p><div className="response-actions"><button type="button" onClick={() => chooseWeaponMastery(true)}><small>Use {slow ? "Slow" : "Topple"}</small><strong>{slow ? "Reduce Speed by 10 feet" : `Force DC ${pending.saveDc} save`}</strong><em>This does not spend an action or resource.</em></button><button type="button" className="decline-response" onClick={() => chooseWeaponMastery(false)}><small>Skip {slow ? "Slow" : "Topple"}</small><strong>Leave the target unchanged</strong></button></div></div>
          </section>;
        })()}
        {encounter.pendingResponse?.type === "post-hit-spell-choice" && (() => {
          const pending = encounter.pendingResponse;
          const source = encounter.combatants.find((combatant) => combatant.id === pending.sourceCombatantId)!;
          const target = encounter.combatants.find((combatant) => combatant.id === pending.targetCombatantId)!;
          const spell = source.spells.find((candidate) => candidate.id === pending.spellId)!;
          const slotLevels = availableSpellSlotLevels(encounter, source.id, spell.level);
          return <section className="roll-coach response-coach reaction-coach" aria-live="assertive">
            <div><span>Player choice · After a melee hit</span><h3>Cast {spell.name}?</h3><p>{pending.attackName} hit {target.name}. Spend your Bonus Action and choose an available spell slot, or save both resources. The weapon&apos;s damage roll still follows.</p><div className="response-actions">{slotLevels.map((level) => <button type="button" key={level} onClick={() => choosePostHitSpell(true, level)}><small>Bonus Action · Level {level} slot</small><strong>Cast {spell.name}</strong><em>{level > spell.level ? `Upcast by ${level - spell.level} level${level - spell.level === 1 ? "" : "s"}. ` : ""}Roll {spell.triggeredDamage}{pending.critical ? " with doubled damage dice" : ""} now.</em></button>)}<button type="button" className="decline-response" onClick={() => choosePostHitSpell(false)}><small>Save resources</small><strong>Skip {spell.name}</strong></button></div></div>
          </section>;
        })()}
        {deathSaveRequired && encounter.turn.action && <section className="roll-coach response-coach death-save-coach" aria-live="assertive">
          <div><span>Start of turn · Death saving throw</span><h3>{activeCombatant.name} is unconscious</h3><p>Roll a <strong>d20</strong> with no modifier. A 10 or higher succeeds; a natural 1 causes two failures; a natural 20 restores 1 HP. Three successes stabilize you and three failures mean death.</p><div className="death-save-track"><span>Successes <strong>{activeCombatant.deathSaves.successes}/3</strong></span><span>Failures <strong>{activeCombatant.deathSaves.failures}/3</strong></span></div></div>
          <button type="button" onClick={rollPendingDeathSave}><small>Roll death save</small><strong>d20</strong></button>
        </section>}
        {outcome !== "active" && <section id="encounter-outcome" className={`combat-outcome ${outcome}`} aria-live="assertive"><span>Encounter complete</span><h3>{outcome === "victory" ? "Victory" : outcome === "stabilized" ? "Your character is stabilized" : "Your character is defeated"}</h3><p>{outcome === "victory" ? "All hostile creatures have been defeated." : outcome === "stabilized" ? "You are unconscious but no longer making death saving throws. This solo scenario ends here." : "Build a new encounter or import another character to try again."}</p></section>}
        {initiativeReady && attackFlow?.phase === "target" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Weapon selected · Choose target</span><h3>{attackFlow.attack.name}</h3><p>Targets highlighted in gold are within range and line of sight. Long-range targets remain legal and will roll with disadvantage.</p></div>
          <div className="target-count"><strong>{legalAttackTargetIds.size}</strong><small>legal targets</small></div>
        </section>}
        {initiativeReady && spellFlow?.phase === "target" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Spell selected · Choose target</span><h3>{spellFlow.spell.name}</h3><p>Targets highlighted in gold are legal for this spell&apos;s range, line of sight, and target type.</p></div>
          <div className="target-count"><strong>{legalSpellTargetIds.size}</strong><small>legal targets</small></div>
        </section>}
        {initiativeReady && utilityTargetFlow === "influence" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Influence · Choose target</span><h3>Select a creature to approach</h3><p>Gold rings mark conscious creatures within 30 feet and clear line of sight. Communication and the result still depend on the scene.</p></div>
          <div className="target-count"><strong>{legalUtilityTargetIds.size}</strong><small>legal targets</small></div>
        </section>}
        {initiativeReady && spellFlow?.phase === "point" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Point spell · Choose location</span><h3>{spellFlow.spell.name}</h3><p>Choose a map square within {spellFlow.spell.rangeFeet} feet and line of sight.{spellFlow.utilityChoiceId ? ` ${spellFlow.spell.utilityChoices?.find((choice) => choice.id === spellFlow.utilityChoiceId)?.description ?? ""}` : ""}</p></div>
        </section>}
        {initiativeReady && spellFlow?.phase === "option" && <section className="roll-coach response-coach utility-choice-coach" aria-live="polite">
          <div><span>Spell selected · Choose effect</span><h3>{spellFlow.spell.name}</h3><p>Select the effect first, then choose its location on the tactical map.</p><div className="response-actions">{spellFlow.spell.utilityChoices?.map((choice) => <button type="button" key={choice.id} onClick={() => chooseUtilitySpellChoice(choice.id)}><small>Spell effect</small><strong>{choice.name}</strong><em>{choice.description}</em></button>)}</div></div>
        </section>}
        {initiativeReady && spellFlow?.phase === "resource" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Spell selected · Choose resource</span><h3>{spellFlow.spell.name}</h3><p>Use the once-per-Long-Rest Magic Initiate cast or preserve it and spend a level 1 spell slot.</p></div>
          <button type="button" onClick={() => chooseSpellCastingResource("free-cast")}><small>Magic Initiate</small><strong>Use free cast</strong></button>
          <button type="button" onClick={() => chooseSpellCastingResource("spell-slot")}><small>Spellcasting</small><strong>Use level 1 slot</strong></button>
        </section>}
        {attackFlow?.phase === "attack-roll" && targetAnalysis && <section className="roll-coach attack-coach" aria-live="polite">
          <div><span>Attack roll · Click to roll</span><h3>{attackFlow.attack.name} vs. {targetAnalysis.target.name}</h3><p>Roll a <strong>d20</strong> {validateAttackChoice(encounter, attackFlow.attack).rollMode === "disadvantage" ? "twice and keep the lower result, then" : "and"} add {attackFlow.attack.attackBonus >= 0 ? "+" : "−"}{Math.abs(attackFlow.attack.attackBonus)}. Meet or beat AC {effectiveArmorClass(encounter, targetAnalysis.target.id) + (targetAnalysis.cover === "half" ? 2 : 0)}.</p></div>
          <button type="button" onClick={rollSelectedAttack}><small>Roll attack</small><strong>{validateAttackChoice(encounter, attackFlow.attack).rollMode === "disadvantage" ? "2d20 · lower" : "d20"} {attackFlow.attack.attackBonus >= 0 ? "+" : "−"} {Math.abs(attackFlow.attack.attackBonus)}</strong></button>
        </section>}
        {attackFlow?.phase === "damage-roll" && targetAnalysis && !encounter.pendingResponse && <section className="roll-coach damage-coach" aria-live="polite">
          <div><span>{attackFlow.critical ? "Critical hit · Double the damage dice" : "Hit confirmed · Click to roll damage"}</span><h3>{attackFlow.attack.damage}</h3><p>Damage is rolled separately from the attack. The total will be applied to {targetAnalysis.target.name}&apos;s hit points.</p></div>
          <button type="button" onClick={() => rollSelectedDamage(false)}><small>Roll damage</small><strong>{attackFlow.critical ? `Critical · ${attackFlow.attack.damage}` : attackFlow.attack.damage}</strong></button>
          {attackFlow.attack.id !== "unarmed-strike" && /\d+d\d+/i.test(attackFlow.attack.damage) && playerCombatant.weaponDamageRerollFeatureId && !encounter.turn.usedFeatureIds.includes(playerCombatant.weaponDamageRerollFeatureId) && <button type="button" onClick={() => rollSelectedDamage(true)}><small>Savage Attacker · Once this turn</small><strong>Roll twice · Keep higher</strong></button>}
        </section>}
        {spellFlow?.phase === "attack-roll" && targetAnalysis && spellFlow.spell.attackBonus !== undefined && <section className="roll-coach attack-coach" aria-live="polite">
          <div><span>Spell attack roll · Click to roll</span><h3>{spellFlow.spell.name} vs. {targetAnalysis.target.name}</h3><p>Roll a <strong>d20</strong> {validateSpellChoice(encounter, spellFlow.spell).rollMode === "disadvantage" ? "twice and keep the lower result, then" : "and"} add {spellFlow.spell.attackBonus >= 0 ? "+" : "−"}{Math.abs(spellFlow.spell.attackBonus)}. Meet or beat AC {effectiveArmorClass(encounter, targetAnalysis.target.id) + (targetAnalysis.cover === "half" ? 2 : 0)}.</p></div>
          <button type="button" onClick={rollSelectedSpellAttack}><small>Roll spell attack</small><strong>{validateSpellChoice(encounter, spellFlow.spell).rollMode === "disadvantage" ? "2d20 · lower" : "d20"} {spellFlow.spell.attackBonus >= 0 ? "+" : "−"} {Math.abs(spellFlow.spell.attackBonus)}</strong></button>
        </section>}
        {spellFlow?.phase === "damage-roll" && targetAnalysis && spellFlow.spell.damage && <section className="roll-coach damage-coach" aria-live="polite">
          <div><span>{spellFlow.critical ? "Critical hit · Double the damage dice" : "Spell hit confirmed · Click to roll damage"}</span><h3>{spellFlow.spell.damage}</h3><p>Roll the spell&apos;s damage separately. The total will be applied to {targetAnalysis.target.name}&apos;s hit points.</p></div>
          <button type="button" onClick={rollSelectedSpellDamage}><small>Roll spell damage</small><strong>{spellFlow.critical ? `Critical · ${spellFlow.spell.damage}` : spellFlow.spell.damage}</strong></button>
        </section>}
        </div>

        <section id="tactical-map" className="tactical-map-panel">
          <div className="map-heading"><div><span className="eyebrow">5-foot square grid</span><h3>Tactical map</h3></div><div className="map-legend"><span className="legend-player">Player</span><span className="legend-enemy">Enemy</span><span className="legend-difficult">Difficult</span><span className="legend-cover">Cover</span><span className="legend-objective">Objective</span><span className="legend-flame">Flame</span></div></div>
          <div className={`target-panel ${targetAnalysis ? "has-target" : ""}`}>
            {targetAnalysis ? <><div><span>Selected target</span><strong>{targetAnalysis.target.name}</strong><small>{targetAnalysis.target.side} · AC {effectiveArmorClass(encounter, targetAnalysis.target.id)} · {targetAnalysis.target.side === "enemy" ? enemyHealthLabel(targetAnalysis.target, experienceMode) : `${targetAnalysis.target.hitPoints.current}/${targetAnalysis.target.hitPoints.maximum} HP`}</small></div><div><span>Distance</span><strong>{targetAnalysis.distanceFeet} ft.</strong></div><div><span>Sightline</span><strong>{targetAnalysis.lineOfSight ? "Clear" : "Blocked"}</strong></div><div><span>Cover</span><strong>{targetAnalysis.cover === "half" ? "Half (+2 AC)" : "None"}</strong></div><button type="button" disabled={activeCombatant.side !== "player"} onClick={() => { setEncounter((state) => selectTarget(state, null)); setAttackFlow(attackFlow ? { ...attackFlow, phase: "target", targetId: undefined } : null); setSpellFlow(spellFlow ? { ...spellFlow, phase: "target", targetId: undefined } : null); setFeedback("Target cleared."); }}>Clear target</button></> : <div className="target-empty"><span>{attackFlow?.phase === "target" ? `Targeting · ${attackFlow.attack.name}` : spellFlow?.phase === "target" ? `Targeting · ${spellFlow.spell.name}` : utilityTargetFlow === "influence" ? "Targeting · Influence" : "Choose an action"}</span><strong>{attackFlow?.phase === "target" || spellFlow?.phase === "target" || utilityTargetFlow ? "Select a highlighted creature" : "Choose an attack, spell, or guided action first"}</strong><small>{attackFlow?.phase === "target" ? "Gold rings indicate targets within this weapon’s range and line of sight." : spellFlow?.phase === "target" ? "Gold rings indicate legal targets for the selected spell." : utilityTargetFlow === "influence" ? "Gold rings indicate conscious creatures within 30 feet and clear line of sight." : "The selected option determines which targets ADaM highlights."}</small></div>}
          </div>
          <div className="map-scroll" role="region" aria-label="Tactical combat map">
            <div className="battle-grid" style={{ gridTemplateColumns: `repeat(${encounter.map.width}, 46px)` }}>
              {Array.from({ length: encounter.map.width * encounter.map.height }, (_, index) => {
                const x = index % encounter.map.width;
                const y = Math.floor(index / encounter.map.width);
                const terrain = encounter.map.terrain.find((cell) => cell.x === x && cell.y === y);
                const pointEffect = encounter.effects.find((effect) => effect.points?.some((point) => point.x === x && point.y === y));
                const occupant = encounter.combatants.find((combatant) => occupiedCells(encounter, combatant.id).some((cell) => cell.x === x && cell.y === y));
                const occupantAnchor = occupant?.position.x === x && occupant?.position.y === y;
                const movementCell = legalMovementByCell.get(`${x},${y}`);
                const reachable = !attackFlow && !spellFlow && !utilityTargetFlow && initiativeReady && activeCombatant.side === "player" && !occupant && Boolean(movementCell);
                const coordinate = `${String.fromCharCode(65 + x)}${y + 1}`;
                const targeted = occupant?.id === encounter.selectedTargetId;
                const targetCandidate = Boolean(occupant && (attackFlow?.phase === "target" || spellFlow?.phase === "target" || utilityTargetFlow));
                const legalOptionTarget = Boolean(occupant && (legalAttackTargetIds.has(occupant.id) || legalSpellTargetIds.has(occupant.id) || legalUtilityTargetIds.has(occupant.id)));
                const targetValidation = occupant && attackFlow?.phase === "target" ? validateAttackTarget(encounter, attackFlow.attack, occupant.id) : occupant && spellFlow?.phase === "target" ? validateSpellTarget(encounter, spellFlow.spell, occupant.id) : occupant && utilityTargetFlow ? validateAction(actionCatalog.find((action) => action.id === utilityTargetFlow)!, { ...encounter, selectedTargetId: occupant.id }) : null;
                const targetOptionName = attackFlow?.attack.name ?? spellFlow?.spell.name ?? (utilityTargetFlow === "influence" ? "Influence" : undefined);
                return <button type="button" key={`${x}-${y}`} className={`grid-cell terrain-${terrain?.kind ?? "open"} ${reachable ? "reachable" : ""} ${targeted ? "targeted" : ""} ${legalOptionTarget ? "legal-target" : targetCandidate ? "illegal-target" : ""}`} onClick={() => handleGridInteraction(x, y, occupant?.id)} aria-pressed={targeted} aria-label={`${coordinate}. ${terrain?.label ?? "Open ground"}${movementCell ? `. Reachable for ${movementCell.cost} feet.` : ""}${occupant ? `. Occupied by ${occupant.name}. ${legalOptionTarget ? `Legal target for ${targetOptionName}.` : "Select as target."}` : ""}`} title={`${coordinate} · ${occupant ? legalOptionTarget ? `${occupant.name}: legal target` : targetValidation?.reason ?? `Select ${occupant.name}` : movementCell ? `${movementCell.cost} ft. by legal path` : terrain?.label ?? "Open ground"}`}>
                  <small>{coordinate}</small>
                  {terrain && <span className="terrain-mark" aria-hidden="true">{terrain.kind === "wall" ? "■" : terrain.kind === "difficult" ? "≈" : terrain.kind === "cover" ? "◩" : terrain.kind === "flame" ? terrain.flame?.lit ? "♨" : "○" : "◆"}</span>}
                  {pointEffect && <span className={`point-effect-mark point-effect-${pointEffect.pointEffect?.type ?? "effect"}`} aria-hidden="true">{pointEffect.pointEffect?.type === "illusion" ? pointEffect.pointEffect.mode === "image" ? "◇" : "◌" : pointEffect.pointEffect?.type === "utility-marker" ? pointEffect.pointEffect.kind === "bloom" ? "✦" : "☁" : "•"}</span>}
                  {occupant && occupantAnchor && <span className={`token ${occupant.side} ${occupant.hitPoints.current <= 0 ? occupant.side === "player" && !occupant.stabilized && occupant.deathSaves.failures < 3 ? "unconscious" : "defeated" : ""} ${targeted ? "selected" : ""}`} title={occupant.name}>{occupant.hitPoints.current <= 0 ? occupant.stabilized ? "S" : "0" : occupant.name.slice(0, 2).toUpperCase()}</span>}
                  {occupant && !occupantAnchor && <span className={`token-footprint ${occupant.side}`} aria-hidden="true">↖</span>}
                </button>;
              })}
            </div>
          </div>
          <div className="map-help"><span>{attackFlow?.phase === "target" || spellFlow?.phase === "target" || utilityTargetFlow ? "Gold ring: legal target for selected option" : "Creature token: inspect target"}</span><span>Highlighted empty square: tap once to move there</span><span>ADaM finds a legal path and charges terrain costs</span></div>
        </section>

        <div className="initiative-strip"><div className="round">Round <strong>{encounter.round}</strong></div>{encounter.combatants.map((combatant, index) => <div key={combatant.id} className={`initiative-card ${initiativeReady && index === encounter.activeIndex ? "active" : ""} ${combatant.hitPoints.current <= 0 ? combatant.side === "player" && !combatant.stabilized && combatant.deathSaves.failures < 3 ? "unconscious" : "defeated" : ""}`}><span>{combatant.initiativeRolled ? combatant.initiative : "—"}</span><div><strong>{combatant.name}</strong><small>{combatant.hitPoints.current <= 0 ? combatant.stabilized ? "stabilized" : combatant.deathSaves.failures >= 3 ? "defeated" : `${combatant.deathSaves.successes} saves · ${combatant.deathSaves.failures} failures` : combatant.initiativeRolled ? `initiative · ${combatant.side}` : combatant.side === "player" ? `d20 ${combatant.initiativeModifier >= 0 ? "+" : "−"}${Math.abs(combatant.initiativeModifier)} · your roll` : "ADaM rolls privately"}</small></div></div>)}</div>

        <div className="turn-dashboard"><div><span>Current turn</span><strong>{activeCombatant.name}</strong></div><div><span>Action</span><strong>{encounter.turn.action ? "Ready" : "Used"}</strong></div><div><span>Bonus action</span><strong>{encounter.turn.bonusAction ? "Ready" : "Used"}</strong></div><div><span>Movement</span><strong>{encounter.turn.movementRemaining} ft.{encounter.turn.disengaged ? " · Disengaged" : ""}</strong></div><div><span>Your reaction</span><strong>{playerCombatant.reactionAvailable ? "Ready" : "Used"}</strong></div></div>

        <section className="state-tray" aria-label="Character resources and temporary effects">
          <div className="resource-tracker"><div><span className="eyebrow">Combat resources</span><h3>Uses and carried weapons</h3></div><div className="resource-pills">{playerCombatant.resources.map((resource) => <div key={resource.id}><span>{resource.kind === "spell-slot" ? `Level ${resource.level} slots` : resource.name}</span><strong>{resource.current}/{resource.maximum}</strong></div>)}{playerCombatant.inventory.map((item) => <div key={`inventory-${item.id}`}><span>{item.name}</span><strong>{item.current}/{item.maximum}</strong></div>)}{playerCombatant.damageResistances.map((type) => <div key={`resistance-${type}`}><span>Damage resistance</span><strong>{type}</strong><small>Matching damage is halved, rounded down, and shown in the combat log.</small></div>)}{!playerCombatant.resources.length && !playerCombatant.inventory.length && !playerCombatant.damageResistances.length && <p>No tracked resources imported.</p>}</div>{outcome === "victory" && <div className="rest-recovery"><span>Post-encounter recovery</span><div><button type="button" onClick={() => recoverAfterRest("short-rest")}>Recover after Short Rest</button><button type="button" onClick={() => recoverAfterRest("long-rest")}>Recover after Long Rest</button></div>{character.id === "surina-daardendrian" ? <><button type="button" onClick={() => recoverAfterRest("short-rest", true)}>Short Rest · Roll 1d10 + CON for healing ({encounter.recoveryState?.hitDiceRemaining ?? character.recoveryState?.hitDiceRemaining ?? 1} Hit Die left)</button><small>Safe, uninterrupted downtime: Short Rest advances 1 hour; Long Rest includes 8 hours with sleep and any required 16-hour waiting period since your previous Long Rest. Long Rest restores HP and your Hit Die. Source resource recovery remains unchanged.</small></> : <small>Refreshes only resources whose registered rules recover on that rest.</small>}</div>}</div>
          <div className="effect-tracker"><div><span className="eyebrow">Derived statistics</span><h3>Active effects</h3>{encounter.effects.some((effect) => effect.concentration && effect.sourceCombatantId === playerCombatant.id) && <button type="button" onClick={releaseConcentration}>End concentration · No Action</button>}{encounter.effects.some((effect) => effect.sourceCombatantId === playerCombatant.id && effect.modifiers.rageExtension) && <button type="button" onClick={extendRageNow}>Extend Rage · Bonus Action</button>}{encounter.effects.some((effect) => effect.sourceCombatantId === playerCombatant.id && effect.senseMagic) && <button type="button" onClick={inspectMagicAuras}>Reveal magic auras · Action</button>}</div><div className="effect-pills">{playerEffects.length ? playerEffects.map((effect) => { const remaining = remainingEffectRounds(encounter, effect); return <div key={effect.id}><span>{effect.concentration ? "Concentration" : remaining === 1 ? "Until next turn" : remaining === null ? "Ongoing" : `${remaining} rounds`}</span><strong>{effect.name}</strong><small>{effect.sense ? `Live sense: ${creatureSenseSnapshot(encounter, playerCombatant.id).summary}` : effect.description}</small>{effect.modifiers.size === "large" && <button type="button" onClick={() => endLargeForm(effect.id)}>End Large Form · No Action</button>}</div>; }) : <p>Base statistics only; no temporary modifiers are active.</p>}</div></div>
        </section>

        <section id="action-console" className="action-console">
          <div className="console-heading"><div><span className="eyebrow">{modeCopy[experienceMode].label} mode</span><h3>{targetAnalysis ? `Actions against ${targetAnalysis.target.name}` : "Choose your action"}</h3></div>{lastRoll && <div className="mini-roll"><span>Last roll</span><strong>{lastRoll.total}</strong></div>}</div>
          {character.id === "surina-daardendrian" && <section className="surina-quick-actions" aria-label="Surina's primary actions">
            <div className="quick-actions-heading"><div><span>Most useful choices</span><h4>What can Surina do right now?</h4></div><small>Every card shows its cost, current availability, and any resource it spends.</small></div>
            <div className="quick-action-grid">{surinaQuickActions.map((action) => {
              const validation = validateAction(action, encounter, character);
              const workflowCanStart = action.id === "attack" && initiativeReady && outcome === "active" && activeCombatant.side === "player" && playerCombatant.hitPoints.current > 0 && encounter.turn.action && !encounter.pendingResponse;
              const presentation = quickActionPresentation({ legal: validation.legal, reason: validation.reason, workflowCanStart, workflowExplanation: "Choose a weapon first. ADaM will then show every legal target." });
              const resource = action.resourceCost ? playerCombatant.resources.find((candidate) => candidate.name.toLowerCase() === action.resourceCost!.resourceName.toLowerCase()) : null;
              const copy = surinaQuickActionCopy[action.id] ?? { label: action.name, detail: action.description };
              return <button type="button" key={`quick-${action.id}`} className={`quick-action ${presentation.tone}`} disabled={presentation.tone === "blocked"} onClick={() => runAction(action)}>
                <span className="quick-status">{presentation.status}</span><strong>{copy.label}</strong><small>{actionCostLabel(action.cost)}{resource ? ` · ${resource.current}/${resource.maximum} ${resource.name}` : ""}</small><p>{presentation.tone === "blocked" ? presentation.explanation : copy.detail}</p>
              </button>;
            })}</div>
          </section>}
          {character.id === "surina-daardendrian" && <section className="surina-tactical-actions" aria-label="Surina's tactical actions">
            <div className="quick-actions-heading"><div><span>Tactical choices</span><h4>More ways to shape the turn</h4></div><small>These options need a target, trigger, or skill choice before Surina spends her Action.</small></div>
            <div className="tactical-action-grid">{surinaTacticalActions.map((action) => <button type="button" key={`tactical-${action.id}`} data-tactical-action={action.id} className={`quick-action tactical-action ${action.tone}`} disabled={action.tone === "blocked"} onClick={() => openSurinaTacticalAction(action.id)}>
              <span className="quick-status">{action.status}</span><strong>{action.label}</strong><small>{action.cost}</small><p>{action.detail}</p>
            </button>)}</div>
          </section>}
          {character.id === "surina-daardendrian" && <section className="surina-utility-actions" aria-label="Surina's movement and roleplay actions">
            <div className="quick-actions-heading"><div><span>Movement and roleplay</span><h4>Change position or approach the scene</h4></div><small>These cards explain when cover, targets, or skill choices are required.</small></div>
            <div className="utility-action-grid">{surinaUtilityActions.map((action) => <button type="button" key={`utility-${action.id}`} data-utility-action={action.id} className={`quick-action utility-action ${action.tone}`} disabled={action.tone === "blocked"} onClick={() => openSurinaUtilityAction(action.id)}>
              <span className="quick-status">{action.status}</span><strong>{action.label}</strong><small>{action.cost}</small><p>{action.detail}</p>
            </button>)}</div>
          </section>}
          <div className="all-actions-heading"><span>Full action list</span><p>Use these categories for tactical, skill, object, and less common choices.</p></div>
          <div className="action-category-tabs" aria-label="Action economy categories">{actionCategoryCopy.map((category) => {
            const actions = visibleActions.filter((action) => action.cost === category.id);
            const legalCount = actions.filter((action) => validateAction(action, encounter, character).legal).length;
            return <button type="button" key={category.id} className={actionCategory === category.id ? "active" : ""} onClick={() => setActionCategory(category.id)}><span>{category.label}</span><strong>{legalCount}</strong><small>{category.detail}</small></button>;
          })}</div>
          {choiceMode === "attack" && character.id === "surina-daardendrian" && !unarmedFlow && <section className="choice-panel" aria-label="Unarmed Strike options"><h4>Unarmed Strike options</h4><p>Choose Damage in the attack list, or choose Shove or Grapple below. Each option uses Surina&apos;s Attack action and follows the current 2024 resolution.</p></section>}
          {choiceMode === "attack" && character.id === "surina-daardendrian" && (!unarmedFlow || unarmedFlow === "shove") && <section className="choice-panel" aria-label="Shove options">
            <h4>Unarmed Strike: Shove · Action</h4>
            <p>Choose an enemy and an outcome. ADaM chooses its Strength or Dexterity save before rolling. No weapon damage, free hand, or mastery is required.</p>
            <p>Edition note: 2014 uses contested Athletics against Athletics or Acrobatics. Applied 2024 resolution uses a target saving throw against DC {8 + playerCombatant.abilityModifiers.strength + playerCombatant.proficiencyBonus}; Surina&apos;s Athletics proficiency does not add to this DC. Her character build is unchanged.</p>
            {encounter.combatants.filter(c => c.side === "enemy" && c.hitPoints.current > 0).map(target => {
              const validation = validateShove(encounter, target.id);
              const disabled = !validation.legal || attackFlow?.phase === "damage-roll";
              return <div key={target.id}><strong>{target.name}</strong><button type="button" disabled={disabled} onClick={() => performShove(target.id, "prone")}>Knock Prone · Roll enemy save</button><button type="button" disabled={disabled} onClick={() => performShove(target.id, "push")}>Push 5 ft. · Roll enemy save</button>{!validation.legal && <small>{validation.reason}</small>}</div>;
            })}
            <small>Current surface: your-turn Shoves against enemies. Reaction Shoves are not modeled.</small>
          </section>}
          {choiceMode === "attack" && character.id === "surina-daardendrian" && (!unarmedFlow || unarmedFlow === "grapple") && <section className="choice-panel" aria-label="Grapple options">
            <h4>Unarmed Strike: Grapple · Action</h4>
            <p>Choose an enemy within 5 feet. Grapple requires a free hand and holds the target at Speed 0. Dragging normally costs one additional foot per foot moved. You can release the target at any time without an Action.</p>
            <p>Edition note: 2014 uses a contested Athletics check. Applied 2024 resolution lets the target choose a Strength or Dexterity save against DC {8 + playerCombatant.abilityModifiers.strength + playerCombatant.proficiencyBonus}; later escape attempts use Athletics or Acrobatics against that DC. Surina&apos;s character build is unchanged.</p>
            {encounter.combatants.filter(c => c.side === "enemy" && c.hitPoints.current > 0).map(target => {
              const validation = validateGrapple(encounter, target.id);
              const disabled = !validation.legal || attackFlow?.phase === "damage-roll";
              return <div key={target.id}><strong>{target.name}</strong><button type="button" disabled={disabled} onClick={() => performGrapple(target.id)}>Grapple · Roll enemy save</button>{!validation.legal && <small>{validation.reason}</small>}</div>;
            })}
          </section>}
          <div className="action-grid">{categorizedActions.length ? categorizedActions.map((action) => {
            const validation = validateAction(action, encounter, character);
            const targetingLabel = action.targeting?.mode === "single" ? `${action.targeting.rangeFeet} ft.` : action.targeting?.mode === "area" ? `${action.targeting.shape} · ${action.targeting.sizeFeet} ft.` : action.cost.replace("-", " ");
            return <button key={action.id} className={!validation.legal ? "illegal" : ""} onClick={() => runAction(action)} title={experienceMode === "training" ? (validation.legal ? action.description : validation.reason) : undefined}><strong>{action.name}</strong><span>{targetingLabel}</span>{experienceMode !== "advanced" && <small>{validation.legal || experienceMode === "beginner" ? action.description : validation.reason}</small>}</button>;
          }) : <div className="category-empty"><strong>No actions available</strong><p>Your imported sheet and current turn state do not provide an option in this category.</p></div>}</div>
          {choiceMode === "attack" && !unarmedFlow && <div className="choice-panel"><div className="choice-heading"><div><span>Step 1 · Choose attack</span><strong>Weapon and Unarmed Strike options</strong></div><button type="button" onClick={() => { setChoiceMode(null); setAttackFlow(null); setUnarmedFlow(null); }}>Cancel</button></div><div className="choice-grid">{playerCombatant.attacks.map((attack) => { const selected = attackFlow?.attack.id === attack.id; return <button type="button" key={attack.id} className={selected ? "selected" : ""} onClick={() => chooseAttack(attack)}><span>{attack.kind} · {attack.normalRangeFeet}{attack.longRangeFeet ? `/${attack.longRangeFeet}` : ""} ft.</span><strong>{attack.id === "unarmed-strike" ? "Unarmed Strike: Damage" : attack.name}</strong><small>{attack.damage} · {attack.attackBonus >= 0 ? "+" : ""}{attack.attackBonus} to hit</small><p>{selected && attackFlow?.phase === "target" ? `${legalAttackTargetIds.size} legal target${legalAttackTargetIds.size === 1 ? "" : "s"} highlighted on the map.` : attack.description}</p></button>; })}</div></div>}
          {choiceMode === "spell" && <div className="choice-panel"><div className="choice-heading"><div><span>Step 1 · Choose spell</span><strong>Spellbook and slot costs</strong></div><button type="button" onClick={() => { setChoiceMode(null); setSpellFlow(null); }}>Cancel</button></div><div className="choice-grid">{(character.spells ?? []).length ? (character.spells ?? []).map((spell) => { const validation = validateSpellAvailability(encounter, spell); const selected = spellFlow?.spell.id === spell.id; return <button type="button" key={spell.id} className={`${!validation.legal ? "illegal" : ""} ${selected ? "selected" : ""}`} onClick={() => chooseSpell(spell)}><span>{spell.level === 0 ? "Cantrip · free" : spell.freeCastResourceName ? `Level ${spell.level} · free use or slot` : `Level ${spell.level} · 1 slot`}{spell.ritual ? " · ritual" : ""}</span><strong>{spell.name}</strong><small>{spell.target === "self" ? "Self" : spell.target === "self-or-single" ? `Self or creature · ${spell.rangeFeet} ft.` : spell.target === "area" && spell.area ? `${spell.area.sizeFeet} ft. ${spell.area.shape}` : `${spell.rangeFeet} ft.`}{spell.concentration ? " · concentration" : ""}</small><p>{selected && spellFlow?.phase === "target" ? `${legalSpellTargetIds.size} legal target${legalSpellTargetIds.size === 1 ? "" : "s"} highlighted on the map.` : validation.legal ? spell.damage ?? spell.healing ?? spell.effect?.description ?? spell.description ?? "Spell ready." : validation.reason}</p></button>; }) : <div className="category-empty"><strong>No spells imported</strong><p>This character sheet does not contain spell choices yet.</p></div>}</div></div>}
          {encounter.effects.some(e => e.hidden && e.targetCombatantId === playerCombatant.id) && <button type="button" onClick={() => { setEncounter(endHiding(encounter, playerCombatant.id, "player speaks loudly")); setFeedback("You speak above a whisper and stop hiding."); }}>Speak loudly / end Hide</button>}
          {interactionFlow && <div className="choice-panel"><h3>{interactionFlow === "ready" ? "Ready a weapon attack" : interactionFlow === "help" ? "Help" : "Object interaction"}</h3>
            {interactionFlow === "ready" && <><p>Select an enemy on the map, then a weapon and a supported perceivable trigger. Range, visibility, held equipment, and the Reaction are checked when the trigger occurs.</p>{playerCombatant.attacks.flatMap(attack => ([{ id: "finishes-moving", label: "after movement" }, { id: "becomes-attackable", label: "when first attackable" }] as Array<{ id: ReadyAttackTrigger; label: string }>).map(trigger => <button key={`${attack.id}:${trigger.id}`} type="button" onClick={() => { const r = readyAttack(encounter, attack.id, encounter.selectedTargetId ?? "", trigger.id); if (!r.legal) { setFeedback(r.reason); return; } setEncounter(r.encounter); setFeedback(r.summary); setInteractionFlow(null); }}>{attack.name} · {trigger.label}</button>))}</>}
            {interactionFlow === "help" && <><p>Distract an adjacent enemy for an ally’s next attack, or roll Medicine to stabilize an adjacent ally at 0 HP. Helping yourself is not allowed.</p>{encounter.combatants.filter(c => c.id !== playerCombatant.id).map(target => <button key={target.id} type="button" onClick={() => { const r = help(encounter, target.side === playerCombatant.side ? "stabilize" : "attack", target.id); if (!r.legal) { setFeedback(r.reason); return; } setEncounter(r.encounter); if ("roll" in r && r.roll) setLastRoll(r.roll); setFeedback(r.summary); setInteractionFlow(null); }}>{target.side === playerCombatant.side ? "Stabilize" : "Distract"} {target.name}</button>)}</>}
            {interactionFlow === "help" && <><label><input type="checkbox" checked={assistanceConfirmed} onChange={e => setAssistanceConfirmed(e.target.checked)} /> The adjacent ally can understand and use my assistance</label>{encounter.combatants.filter(c => c.side === playerCombatant.side && c.id !== playerCombatant.id && c.hitPoints.current > 0).flatMap(ally => playerCombatant.skillProficiencies.map(skill => <button type="button" key={`${ally.id}:${skill}`} onClick={() => { const r = helpAbility(encounter, ally.id, skill, assistanceConfirmed); if (!r.legal) { setFeedback(r.reason); return; } setEncounter(r.encounter); setFeedback(r.summary); setInteractionFlow(null); setAssistanceConfirmed(false); }}>Help {ally.name}: {skill}</button>))}</>}
            {interactionFlow === "utilize" && <><p>The first simple door interaction on your turn is free. Another uses the Utilize Action. The squeaky practice door ends Hide. Locked doors need a supported unlocking method.</p>{nearbyDoors(encounter).map(door => <button type="button" key={`${door.x}:${door.y}`} onClick={() => interactWithNearbyDoor(door.x, door.y)}>{door.kind === "wall" ? "Open" : "Close"} {door.label}</button>)}</>}
            <button type="button" onClick={() => setInteractionFlow(null)}>Cancel</button>
          </div>}
          {skillFlow && <div className="choice-panel"><h3>{skillFlow} check</h3><p>Roll using the character’s sheet modifiers and applicable conditions. The result does not automatically reveal information or change an enemy’s behavior.</p>{skillActionChoices[skillFlow].map(skill => <button key={skill} type="button" onClick={() => {
            const result = executeSkillAction(encounter, skillFlow, skill);
            if (!result.legal) { setFeedback(result.reason); return; }
            setEncounter(result.encounter); setLastRoll(result.roll); setRollExplanation(explainD20Roll({ kind: "ability-check", title: `${skillFlow}: ${skill} check`, roll: result.roll, nextStep: "Use this total with the scenario or DM to determine what is learned or how the creature responds." })); setFeedback(result.summary); setSkillFlow(null);
          }}>Roll {skill}</button>)}<button type="button" onClick={() => setSkillFlow(null)}>Cancel</button></div>}
          {breathFlow && breathFlow.resolution.type === "area-saving-throw" && (() => {
            const feature = { ...breathFlow, resolution: { ...breathFlow.resolution, area: { ...breathFlow.resolution.area, shape: breathShape, sizeFeet: breathShape === "line" ? 30 : 15 } } };
            const candidates = encounter.combatants.filter((combatant) => combatant.id !== playerCombatant.id && combatant.hitPoints.current > 0).map((combatant) => {
              const validation = validateFeatureAction(encounter, feature, { targetCombatantId: combatant.id });
              const affected = validation.legal ? areaTargets(encounter, playerCombatant.id, combatant.id, feature.resolution.area) : [];
              return { combatant, validation, affected };
            });
            const selected = candidates.find((candidate) => candidate.combatant.id === encounter.selectedTargetId && candidate.validation.legal);
            return <div className="choice-panel"><h3>Breath Weapon</h3><label>Shape <select value={breathShape} onChange={(event) => setBreathShape(event.target.value as "cone" | "line")}><option value="cone">15-foot Cone</option><option value="line">30-foot Line, 5 feet wide</option></select></label><p>Choose a creature to set the direction. The preview names every creature that will make a save, including allies.</p>{candidates.map(({ combatant, validation, affected }) => <button type="button" key={combatant.id} disabled={!validation.legal} className={encounter.selectedTargetId === combatant.id ? "selected" : ""} onClick={() => setEncounter(selectTarget(encounter, combatant.id))}><strong>Aim through {combatant.name}</strong><small>{validation.legal ? `Affects ${affected.map((target) => target.name).join(", ")}` : validation.reason}</small></button>)}<button type="button" disabled={!selected} onClick={() => {
              if (!selected) return;
              const result = executeFeatureAction(encounter, feature, { targetCombatantId: selected.combatant.id });
              if (!result.legal) { setFeedback(result.reason); return; }
              setEncounter(result.encounter); if (result.roll) setLastRoll(result.roll); setFeedback(result.summary); setResolutionReceipt(buildResolutionReceipt({ kind: "breath-weapon", before: encounter, after: result.encounter, actorId: playerCombatant.id, summary: result.summary, concealEnemyHitPoints: experienceMode === "advanced" })); setBreathFlow(null);
            }}>Roll 1d10 fire damage</button><button type="button" onClick={() => setBreathFlow(null)}>Cancel</button></div>;
          })()}
          {featureFlow && (() => {
            const target = encounter.combatants.find((combatant) => combatant.id === featureFlow.targetId);
            if (!target) return <div className="choice-panel feature-choice"><div className="choice-heading"><div><span>Step 1 · Choose target</span><strong>{featureFlow.feature.name}</strong></div><button type="button" onClick={() => setFeatureFlow(null)}>Cancel</button></div><p>Choose yourself or another creature within touch range. A prior attack target does not become the healing target automatically.</p><div className="choice-grid">{encounter.combatants.map((combatant) => { const option = healingPoolTargetOption(encounter, featureFlow.feature, combatant.id); return <button type="button" key={combatant.id} disabled={!option.legal} onClick={() => chooseHealingTarget(combatant.id)}><strong>{combatant.name}</strong><small>{combatant.hitPoints.current}/{combatant.hitPoints.maximum} HP</small><p>{option.legal ? `${option.maximumHealing} healing available${option.canRemovePoisoned ? " · Poisoned removal available" : ""}` : option.reason}</p></button>; })}</div></div>;
            const pool = playerCombatant.resources.find((resource) => resource.name.toLowerCase() === featureFlow.feature.resourceName.toLowerCase())?.current ?? 0;
            const afflictionCost = (featureFlow.afflictionEffectIds?.length ?? 0) * 5;
            const maximum = Math.min(featureFlow.maximum, Math.max(0, pool - (featureFlow.removePoisoned ? 5 : 0) - afflictionCost));
            const poisonChoice = featureFlow.feature.resolution.type === "healing-pool" && featureFlow.feature.resolution.removesPoisoned && target.conditions.some((condition) => condition.toLowerCase() === "poisoned");
            const afflictions = featureFlow.feature.resolution.type === "healing-pool" ? encounter.effects.filter((effect) => effect.targetCombatantId === target.id && effect.afflictionKind && featureFlow.feature.resolution.type === "healing-pool" && featureFlow.feature.resolution.removesAfflictions?.includes(effect.afflictionKind)) : [];
            return <form className="choice-panel feature-choice" onSubmit={confirmFeatureChoice}><div className="choice-heading"><div><span>Choose healing and recovery</span><strong>{featureFlow.feature.name}</strong></div><button type="button" onClick={() => setFeatureFlow(null)}>Cancel</button></div><div className="feature-choice-form"><div><span>Target</span><strong>{target.name}</strong><small>{target.hitPoints.current}/{target.hitPoints.maximum} Hit Points</small></div>
              {poisonChoice && <label><input type="checkbox" checked={Boolean(featureFlow.removePoisoned)} disabled={!featureFlow.removePoisoned && pool - afflictionCost < 5} onChange={(event) => { const reserved = afflictionCost + (event.target.checked ? 5 : 0); setFeatureFlow({ ...featureFlow, removePoisoned: event.target.checked, amount: Math.min(featureFlow.amount, Math.max(0, pool - reserved)) }); }} />Remove Poisoned · 5 additional points</label>}
              {afflictions.map((effect) => { const selected = featureFlow.afflictionEffectIds?.includes(effect.id) ?? false; return <label key={effect.id}><input type="checkbox" checked={selected} disabled={!selected && pool - (featureFlow.removePoisoned ? 5 : 0) - afflictionCost < 5} onChange={(event) => { const ids = event.target.checked ? [...(featureFlow.afflictionEffectIds ?? []), effect.id] : (featureFlow.afflictionEffectIds ?? []).filter((id) => id !== effect.id); const reserved = (featureFlow.removePoisoned ? 5 : 0) + ids.length * 5; setFeatureFlow({ ...featureFlow, afflictionEffectIds: ids, amount: Math.min(featureFlow.amount, Math.max(0, pool - reserved)) }); }} />Remove {effect.name} · 5 points</label>; })}
              <label htmlFor="feature-healing-amount">Points for healing<input id="feature-healing-amount" type="number" min={featureFlow.removePoisoned || featureFlow.afflictionEffectIds?.length ? 0 : 1} max={maximum} step="1" value={featureFlow.amount} onChange={(event) => setFeatureFlow({ ...featureFlow, amount: Number(event.target.value) })} /></label><button type="submit">Spend {featureFlow.amount + (featureFlow.removePoisoned ? 5 : 0) + afflictionCost} · Restore {featureFlow.amount} HP{featureFlow.removePoisoned ? " · Remove Poisoned" : ""}{featureFlow.afflictionEffectIds?.length ? ` · Remove ${featureFlow.afflictionEffectIds.length} affliction${featureFlow.afflictionEffectIds.length === 1 ? "" : "s"}` : ""}</button></div></form>;
          })()}
          {toolFlow && toolFlow.rule.resolution.type === "tool-check" && <div className="choice-panel"><div className="choice-heading"><div><span>Choose check ability</span><strong>{toolFlow.rule.name}</strong></div><button type="button" onClick={() => setToolFlow(null)}>Cancel</button></div><div className="choice-grid">{abilityLabels.filter((ability) => toolFlow.rule.resolution.type === "tool-check" && toolFlow.rule.resolution.allowedAbilities.includes(ability.id)).map((ability) => <button type="button" key={ability.id} onClick={() => chooseToolAbility(ability.id)}><span>Ability check</span><strong>{ability.label}</strong><small>{playerCombatant.inventory.find((item) => item.id === toolFlow.rule.id)?.tool?.proficient ? `Ability modifier + ${playerCombatant.proficiencyBonus} proficiency` : "Ability modifier only"}</small></button>)}</div></div>}
          <div className="area-effect-note"><span>Area effects</span><p>Cones and cubes now find every creature in the aimed area, resolve one saving throw per target, apply shared damage, and handle forced movement.</p></div>
          <div className="turn-controls"><div><span>Turn control</span><p>{activeCombatant.side === "player" ? "End your turn and let ADaM advance initiative." : "ADaM controls and advances enemy turns automatically."}</p></div><button type="button" disabled={activeCombatant.side !== "player" || outcome !== "active"} onClick={() => runAction(actionCatalog.find((action) => action.id === "end-turn")!)}>{activeCombatant.side === "player" ? "End turn" : "Enemy acting"}</button></div>
          <form className="command-bar" onSubmit={submitCommand}><label htmlFor="command">Or describe your action</label><div><input id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Example: I cast a spell at the scout" /><button>Submit</button></div></form>
          <div className="feedback" aria-live="polite"><span>ADaM</span><p>{feedback}</p></div>
        </section>

        <section className="encounter-log"><div><span className="eyebrow">Combat log</span><h3>Encounter state</h3></div><ol>{encounter.log.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol></section>
      </section>
    </section>
  </main>;
}
