"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AbilityName, Character, CharacterAttack, CharacterSpell } from "../src/domain/character";
import type { ActionCost, CombatAction, ExperienceMode } from "../src/domain/combat";
import { actionCatalog, consumeAction, findActionFromText, validateAction, visibleActionsForMode } from "../src/engine/actions";
import { executeSpellChoice, resolveAttackDamage, resolveAttackRoll, resolveSpellAttackRoll, resolveSpellDamage, validateAttackChoice, validateAttackTarget, validateSpellAvailability, validateSpellChoice, validateSpellTarget } from "../src/engine/combat-options";
import { applyEffect, effectiveArmorClass, effectiveSavingThrowModifier, effectsForCombatant, remainingEffectRounds } from "../src/engine/effects";
import { createEncounter, endTurn, rollPlayerAndEnemyInitiative } from "../src/engine/encounter";
import { combatOutcome, enemyHealthLabel, resolveEnemyTurn } from "../src/engine/enemy-turns";
import { chooseOpportunityAttack, resolveAttackReaction, resolveConcentrationResponse, resolveSavingThrowResponse, rollDeathSave, rollOpportunityAttack, rollOpportunityDamage } from "../src/engine/responses";
import { legalMovementDestinations, moveActiveCombatant } from "../src/engine/movement";
import { analyzeTarget, selectTarget } from "../src/engine/targeting";
import { rollD20, type DamageRoll } from "../src/engine/dice";
import { importCharacterFile, type ImportResult } from "../src/importers";
import { rulesets, type RulesetId } from "../src/rulesets";
import { defaultScenarioSetup, generateScriptedScenario, scenarioTemplates } from "../src/scenarios/scripted-generator";
import type { ScenarioDifficulty, ScenarioEnvironment, ScenarioObjective, ScenarioSetup, ScenarioTemplate } from "../src/scenarios/types";
import { CHARACTER_ROSTER_LIMIT, removeRosterCharacter, upsertRosterCharacter } from "../src/characters/roster";

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
  phase: "target" | "attack-roll" | "damage-roll";
  targetId?: string;
  critical?: boolean;
};

const actionCategoryCopy: Array<{ id: ActionCategory; label: string; detail: string }> = [
  { id: "action", label: "Action", detail: "Attacks, magic, and core actions" },
  { id: "bonus-action", label: "Bonus Action", detail: "Features with a bonus-action cost" },
  { id: "movement", label: "Movement", detail: "Positioning on the tactical grid" },
];

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
  const [character, setCharacter] = useState(sample);
  const [storedCharacters, setStoredCharacters] = useState<Character[]>([]);
  const [rulesetId, setRulesetId] = useState<RulesetId>("dnd-2024");
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
  const [encounter, setEncounter] = useState(() => createEncounter(sample, scenario));
  const [command, setCommand] = useState("");
  const [feedback, setFeedback] = useState("Roll your initiative to begin. ADaM will roll privately for the enemies.");
  const [lastRoll, setLastRoll] = useState<ReturnType<typeof rollD20> | DamageRoll | null>(null);
  const [actionCategory, setActionCategory] = useState<ActionCategory>("action");
  const [choiceMode, setChoiceMode] = useState<ChoiceMode>(null);
  const [attackFlow, setAttackFlow] = useState<AttackFlow>(null);
  const [spellFlow, setSpellFlow] = useState<SpellFlow>(null);
  const [enemyTurnPhase, setEnemyTurnPhase] = useState<"idle" | "resolving" | "awaiting-player" | "showing">("idle");

  const activeRuleset = rulesets.find((ruleset) => ruleset.id === rulesetId)!;
  const visibleActions = useMemo(
    () => visibleActionsForMode(character, rulesetId, experienceMode, encounter),
    [character, encounter, experienceMode, rulesetId],
  );
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
      ? encounter.combatants.filter((combatant) => combatant.id !== activeCombatant.id
        && combatant.hitPoints.current > 0
        && (spellFlow.spell.attackBonus === undefined && !spellFlow.spell.damage ? true : combatant.side !== activeCombatant.side)
        && validateSpellTarget(encounter, spellFlow.spell, combatant.id).legal).map((combatant) => combatant.id)
      : [],
  ), [activeCombatant.id, activeCombatant.side, encounter, spellFlow]);
  const legalMovementCells = useMemo(() => legalMovementDestinations(encounter), [encounter]);
  const legalMovementByCell = useMemo(() => new Map(legalMovementCells.map((cell) => [`${cell.x},${cell.y}`, cell])), [legalMovementCells]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem("adam-scenario-templates");
        if (stored) setSavedTemplates(JSON.parse(stored) as ScenarioTemplate[]);
        const rosterJson = localStorage.getItem("adam-character-roster");
        const roster = rosterJson ? (JSON.parse(rosterJson) as Character[]) : [];
        const validRoster = roster.filter((candidate) => candidate?.id && candidate?.name && candidate?.hitPoints && candidate?.abilities).slice(0, CHARACTER_ROSTER_LIMIT).map(withCombatDefaults);
        const nextRoster = validRoster;
        setStoredCharacters(nextRoster);
        localStorage.setItem("adam-character-roster", JSON.stringify(nextRoster));
        const activeId = localStorage.getItem("adam-active-character-id");
        const activeCharacter = nextRoster.find((candidate) => candidate.id === activeId) ?? nextRoster[0] ?? sample;
        setCharacter(activeCharacter);
        setEncounter(createEncounter(activeCharacter, initialScenario.current));
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
        setFeedback(result.steps.map((step) => step.summary).join(" "));
        setEnemyTurnPhase(result.encounter.pendingResponse ? "awaiting-player" : "showing");
        return;
      }
      setEncounter((state) => endTurn(state));
      setEnemyTurnPhase("idle");
      setFeedback("Enemy turn complete. Initiative advances to the next living combatant.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeCombatant?.id, activeCombatant?.name, activeCombatant?.side, encounter, enemyTurnPhase, experienceMode, initiativeReady, outcome]);

  function finishPlayerResponse(nextEncounter: typeof encounter, summary: string, playerRoll: ReturnType<typeof rollD20> | null) {
    setEncounter(nextEncounter);
    if (playerRoll) setLastRoll(playerRoll);
    setFeedback(summary);
    setEnemyTurnPhase(activeCombatant.side === "enemy" ? (nextEncounter.pendingResponse ? "awaiting-player" : "showing") : "idle");
  }

  function rollPendingSavingThrow() {
    const result = resolveSavingThrowResponse(encounter);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
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
    setEnemyTurnPhase("resolving");
  }

  function rollPendingConcentration() {
    const result = resolveConcentrationResponse(encounter);
    finishPlayerResponse(result.encounter, result.summary, result.playerRoll);
  }

  function rollPendingDeathSave() {
    const result = rollDeathSave(encounter, activeCombatant.id);
    setEncounter(result.encounter);
    if (result.playerRoll) setLastRoll(result.playerRoll);
    setFeedback(result.summary);
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
    setEncounter(createEncounter(nextCharacter, scenario));
    setChoiceMode(null);
    setAttackFlow(null);
    setSpellFlow(null);
    setEnemyTurnPhase("idle");
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

  function runAction(action: CombatAction) {
    if (!initiativeReady) { setFeedback("Roll your initiative before taking actions. ADaM rolls for the enemies automatically."); return; }
    if (outcome !== "active") { setFeedback("This encounter is complete. Build a new encounter to continue training."); return; }
    if (encounter.pendingResponse) { setFeedback("Resolve the pending saving throw or reaction before continuing."); return; }
    if (activeCombatant.side !== "player") { setFeedback("ADaM is resolving the enemy turn."); return; }
    if (deathSaveRequired && encounter.turn.action) { setFeedback("Roll the required death saving throw before ending this turn."); return; }
    if (activeCombatant.hitPoints.current <= 0 && action.id !== "end-turn") { setFeedback("An unconscious character cannot take actions."); return; }
    if (action.id === "end-turn") { setEncounter((state) => endTurn(state)); setChoiceMode(null); setAttackFlow(null); setSpellFlow(null); setFeedback("Turn ended. Initiative advanced."); return; }
    if (action.id === "attack") {
      setChoiceMode("attack");
      setAttackFlow(null);
      setSpellFlow(null);
      setFeedback(`${character.attacks?.length ?? 0} weapon attacks are ready. Choose a weapon to reveal its legal targets.`);
      return;
    }
    const validation = validateAction(action, encounter, character);
    if (!validation.legal) {
      setFeedback(experienceMode === "training" ? validation.reason ?? "That action is not currently legal." : "Action disallowed."); return;
    }
    if (action.id === "move") { setFeedback("Choose a highlighted adjacent square. You can split your movement before and after actions; leaving an enemy's reach may trigger an opportunity attack."); return; }
    if (action.id === "magic" || action.id === "cast-spell") { setChoiceMode("spell"); setAttackFlow(null); setSpellFlow(null); setFeedback("Choose a spell first. ADaM will then highlight every legal target for its range and line of sight."); return; }
    let next = consumeAction(action, encounter);
    if (action.id === "dodge") {
      next = applyEffect(next, {
        name: "Dodge",
        description: "Incoming attacks have disadvantage until the start of your next turn.",
        sourceCombatantId: activeCombatant.id,
        targetCombatantId: activeCombatant.id,
        durationRounds: 1,
        modifiers: { incomingAttacks: "disadvantage" },
      });
    }
    setEncounter(next);
    setChoiceMode(null);
    const targetCopy = action.targeting?.mode === "single" && targetAnalysis ? ` against ${targetAnalysis.target.name}` : "";
    const tacticalCopy = action.id === "dash"
      ? ` Your available movement is now ${next.turn.movementRemaining} feet and may be split around other choices.`
      : action.id === "disengage"
        ? " Your movement will not provoke opportunity attacks for the rest of this turn."
        : "";
    setFeedback(`${action.name}${targetCopy} accepted. This action does not require a dice roll.${tacticalCopy}`);
  }

  function chooseAttack(attack: CharacterAttack) {
    if (!encounter.turn.action) { setFeedback("Your Action has already been used this turn."); return; }
    setEncounter((state) => selectTarget(state, null));
    setAttackFlow({ attack, phase: "target" });
    setSpellFlow(null);
    setFeedback(`${attack.name} selected. Choose one of the highlighted enemy targets on the tactical map.`);
  }

  function rollInitiative() {
    if (!playerNeedsInitiative) return;
    const result = rollPlayerAndEnemyInitiative(encounter, playerNeedsInitiative.id);
    setEncounter(result.encounter);
    setLastRoll(result.playerRoll);
    setFeedback(`You rolled ${result.playerRoll.total}. ADaM rolled initiative for ${result.enemyRolls.length} ${result.enemyRolls.length === 1 ? "enemy" : "enemies"}. ${result.encounter.combatants[0].name} acts first.`);
  }

  function rollSelectedAttack() {
    if (!attackFlow || attackFlow.phase !== "attack-roll") return;
    const result = resolveAttackRoll(encounter, attackFlow.attack);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    const updatedTarget = result.encounter.combatants.find((combatant) => combatant.id === attackFlow.targetId);
    const healthCopy = updatedTarget?.side === "enemy" && experienceMode !== "advanced" ? ` ${updatedTarget.name}: ${enemyHealthLabel(updatedTarget, experienceMode)}.` : "";
    setFeedback(`${result.summary}${healthCopy}`);
    if (result.hit) setAttackFlow({ ...attackFlow, phase: "damage-roll", critical: result.critical });
    else { setAttackFlow(null); setChoiceMode(null); }
  }

  function rollSelectedDamage() {
    if (!attackFlow || attackFlow.phase !== "damage-roll" || !attackFlow.targetId) return;
    const result = resolveAttackDamage(encounter, attackFlow.attack, attackFlow.targetId, attackFlow.critical);
    if (!result.legal) { setFeedback(result.reason); return; }
    setEncounter(result.encounter);
    setLastRoll(result.roll);
    setFeedback(`${result.summary} You still have ${result.encounter.turn.movementRemaining} feet of movement and may use it before ending your turn.`);
    setAttackFlow(null);
    setChoiceMode(null);
  }

  function chooseSpell(spell: CharacterSpell) {
    const availability = validateSpellAvailability(encounter, spell);
    if (!availability.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : availability.reason); return; }
    if (spell.target === "single") {
      setEncounter((state) => selectTarget(state, null));
      setSpellFlow({ spell, phase: "target" });
      setAttackFlow(null);
      setFeedback(`${spell.name} selected. Choose one of the highlighted legal targets on the tactical map.`);
      return;
    }
    const result = executeSpellChoice(encounter, spell);
    if (!result.legal) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : result.reason); return; }
    setEncounter(result.encounter); setLastRoll(result.roll); setChoiceMode(null); setSpellFlow(null); setFeedback(result.summary);
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
    const action = findActionFromText(command, rulesetId);
    if (!action) { setFeedback(experienceMode === "advanced" ? "Action disallowed." : "I could not match that request to a supported action yet. Try naming the action directly."); return; }
    runAction(action); setCommand("");
  }

  function buildScenario(event: FormEvent) {
    event.preventDefault();
    const setup: ScenarioSetup = { prompt: setupMode === "guided" ? "" : scenarioPrompt, environment, objective, difficulty };
    const next = generateScriptedScenario(setupMode === "describe" ? scenarioPrompt : setup);
    setScenario(next); setEncounter(createEncounter(character, next)); setAttackFlow(null); setSpellFlow(null); setChoiceMode(null); setEnemyTurnPhase("idle"); setFeedback(`${next.opening} Roll your initiative to begin.`);
  }

  function loadTemplate(template: ScenarioTemplate) {
    setScenarioPrompt(template.setup.prompt);
    setEnvironment(template.setup.environment);
    setObjective(template.setup.objective);
    setDifficulty(template.setup.difficulty);
    const next = generateScriptedScenario(template.setup);
    setScenario(next); setEncounter(createEncounter(character, next)); setAttackFlow(null); setSpellFlow(null); setChoiceMode(null); setEnemyTurnPhase("idle"); setFeedback(`${template.name} loaded. ${next.opening} Roll your initiative to begin.`);
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
    if (result.legal) setEncounter(result.encounter);
    if (result.damageRoll ?? result.attackRoll) setLastRoll(result.damageRoll ?? result.attackRoll);
    setFeedback(result.reason);
  }

  function handleGridInteraction(x: number, y: number, occupantId?: string) {
    if (!initiativeReady) { setFeedback("Finish rolling initiative before interacting with the map."); return; }
    if (activeCombatant.side !== "player") { setFeedback("ADaM controls targeting and movement during enemy turns."); return; }
    if (attackFlow?.phase === "target") {
      if (!occupantId) { setFeedback(`Choose a highlighted creature for ${attackFlow.attack.name}.`); return; }
      const validation = validateAttackTarget(encounter, attackFlow.attack, occupantId);
      if (!validation.legal) { setFeedback(experienceMode === "advanced" ? "Target disallowed." : validation.reason ?? "That target is not legal."); return; }
      const analysis = analyzeTarget(encounter, occupantId)!;
      const rollMode = validation.rollMode === "disadvantage" ? " Roll two d20s and use the lower result because the attack is at long range or a hostile creature is within 5 feet." : "";
      setEncounter((state) => selectTarget(state, occupantId));
      setAttackFlow({ ...attackFlow, phase: "attack-roll", targetId: occupantId });
      setFeedback(`${analysis.target.name} selected at ${analysis.distanceFeet} feet. Click to roll the attack: d20 ${attackFlow.attack.attackBonus >= 0 ? "+" : "−"} ${Math.abs(attackFlow.attack.attackBonus)}.${rollMode}`);
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
        return;
      }
      const result = executeSpellChoice(targetedEncounter, spellFlow.spell);
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
        <div className="panel"><div className="panel-heading"><span>02</span><h2>Experience</h2></div><div className="mode-list">{(Object.keys(modeCopy) as ExperienceMode[]).map((mode) => <button key={mode} className={experienceMode === mode ? "selected" : ""} onClick={() => { setExperienceMode(mode); setFeedback(modeCopy[mode].detail); }}><strong>{modeCopy[mode].label}</strong><small>{modeCopy[mode].detail}</small></button>)}</div></div>
        <div className="panel"><div className="panel-heading"><span>03</span><h2>Ruleset</h2></div><div className="ruleset-list">{rulesets.map((ruleset) => <button key={ruleset.id} className={ruleset.id === rulesetId ? "selected" : ""} onClick={() => setRulesetId(ruleset.id)}><strong>{ruleset.name}</strong><small>{ruleset.description}</small></button>)}</div></div>
      </aside>

      <section className="combat-area">
        <div className="combat-heading"><div><span className="eyebrow">Scripted scenario engine</span><h2>{scenario.title}</h2></div><div className="rules-badge">{activeRuleset.label}</div></div>
        <section className="scenario-studio">
          <div className="setup-tabs" aria-label="Scenario setup method">{(Object.keys(setupModeCopy) as ScenarioSetupMode[]).map((mode) => <button key={mode} type="button" className={setupMode === mode ? "active" : ""} onClick={() => setSetupMode(mode)}><strong>{setupModeCopy[mode].label}</strong><small>{setupModeCopy[mode].detail}</small></button>)}</div>
          {setupMode === "templates" ? <div className="template-grid">{[...scenarioTemplates, ...savedTemplates].map((template) => <button type="button" key={template.id} onClick={() => loadTemplate(template)}><span>{template.setup.difficulty}</span><strong>{template.name}</strong><small>{template.description}</small></button>)}</div> : <form className="scenario-builder" onSubmit={buildScenario}>
            {(setupMode === "describe" || setupMode === "combined") && <label className="prompt-field">Describe the encounter you want<input value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} placeholder="A ruined crypt where I must rescue a trapped scholar" /></label>}
            {(setupMode === "guided" || setupMode === "combined") && <div className="guided-controls">
              <label>Environment<select value={environment} onChange={(event) => setEnvironment(event.target.value as ScenarioEnvironment)}><option value="crypt">Ruined crypt</option><option value="forest">Dense forest</option><option value="market">Abandoned market</option></select></label>
              <label>Objective<select value={objective} onChange={(event) => setObjective(event.target.value as ScenarioObjective)}><option value="defeat">Defeat enemies</option><option value="rescue">Rescue a civilian</option><option value="escape">Reach the exit</option><option value="hold">Hold a position</option></select></label>
              <label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as ScenarioDifficulty)}><option value="easy">Easy</option><option value="standard">Standard</option><option value="hard">Hard</option></select></label>
            </div>}
            <div className="scenario-actions"><button className="generate-button">Build encounter</button><button type="button" className="save-button" onClick={saveTemplate}>Save setup</button></div>
          </form>}
        </section>
        <div className="scenario-summary"><div><span>Objective</span><strong>{scenario.objective}</strong></div><div><span>Terrain</span><strong>{scenario.features.join(" · ")}</strong></div><div><span>Difficulty</span><strong>{scenario.difficulty}</strong></div></div>

        {!initiativeReady && playerNeedsInitiative && <section className="roll-coach initiative-coach" aria-live="polite">
          <div><span>Your initiative · Click to roll</span><h3>{playerNeedsInitiative.name}</h3><p>Roll a <strong>d20</strong> and add your initiative modifier ({playerNeedsInitiative.initiativeModifier >= 0 ? "+" : "−"}{Math.abs(playerNeedsInitiative.initiativeModifier)}). ADaM rolls enemy initiative privately and then reveals turn order.</p></div>
          <button type="button" onClick={rollInitiative}><small>Roll your initiative</small><strong>d20 {playerNeedsInitiative.initiativeModifier >= 0 ? "+" : "−"} {Math.abs(playerNeedsInitiative.initiativeModifier)}</strong></button>
        </section>}
        {initiativeReady && activeCombatant.side === "enemy" && outcome === "active" && <section className="roll-coach enemy-coach" aria-live="polite">
          <div><span>DM-controlled turn · {modeCopy[experienceMode].label} tactics · {enemyTurnPhase}</span><h3>{activeCombatant.name}</h3><p>ADaM controls this creature&apos;s movement, targeting, action selection, attack roll, and damage roll. Tactical decision quality scales with the selected experience mode.</p></div>
          <div className="dm-turn-badge"><strong>ADaM</strong><small>resolving enemy</small></div>
        </section>}
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
        {deathSaveRequired && encounter.turn.action && <section className="roll-coach response-coach death-save-coach" aria-live="assertive">
          <div><span>Start of turn · Death saving throw</span><h3>{activeCombatant.name} is unconscious</h3><p>Roll a <strong>d20</strong> with no modifier. A 10 or higher succeeds; a natural 1 causes two failures; a natural 20 restores 1 HP. Three successes stabilize you and three failures mean death.</p><div className="death-save-track"><span>Successes <strong>{activeCombatant.deathSaves.successes}/3</strong></span><span>Failures <strong>{activeCombatant.deathSaves.failures}/3</strong></span></div></div>
          <button type="button" onClick={rollPendingDeathSave}><small>Roll death save</small><strong>d20</strong></button>
        </section>}
        {outcome !== "active" && <section className={`combat-outcome ${outcome}`} aria-live="assertive"><span>Encounter complete</span><h3>{outcome === "victory" ? "Victory" : outcome === "stabilized" ? "Your character is stabilized" : "Your character is defeated"}</h3><p>{outcome === "victory" ? "All hostile creatures have been defeated." : outcome === "stabilized" ? "You are unconscious but no longer making death saving throws. This solo scenario ends here." : "Build a new encounter or import another character to try again."}</p></section>}
        {initiativeReady && attackFlow?.phase === "target" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Weapon selected · Choose target</span><h3>{attackFlow.attack.name}</h3><p>Targets highlighted in gold are within range and line of sight. Long-range targets remain legal and will roll with disadvantage.</p></div>
          <div className="target-count"><strong>{legalAttackTargetIds.size}</strong><small>legal targets</small></div>
        </section>}
        {initiativeReady && spellFlow?.phase === "target" && <section className="roll-coach target-coach" aria-live="polite">
          <div><span>Spell selected · Choose target</span><h3>{spellFlow.spell.name}</h3><p>Targets highlighted in gold are legal for this spell&apos;s range, line of sight, and target type.</p></div>
          <div className="target-count"><strong>{legalSpellTargetIds.size}</strong><small>legal targets</small></div>
        </section>}
        {attackFlow?.phase === "attack-roll" && targetAnalysis && <section className="roll-coach attack-coach" aria-live="polite">
          <div><span>Attack roll · Click to roll</span><h3>{attackFlow.attack.name} vs. {targetAnalysis.target.name}</h3><p>Roll a <strong>d20</strong> {validateAttackChoice(encounter, attackFlow.attack).rollMode === "disadvantage" ? "twice and keep the lower result, then" : "and"} add {attackFlow.attack.attackBonus >= 0 ? "+" : "−"}{Math.abs(attackFlow.attack.attackBonus)}. Meet or beat AC {effectiveArmorClass(encounter, targetAnalysis.target.id) + (targetAnalysis.cover === "half" ? 2 : 0)}.</p></div>
          <button type="button" onClick={rollSelectedAttack}><small>Roll attack</small><strong>{validateAttackChoice(encounter, attackFlow.attack).rollMode === "disadvantage" ? "2d20 · lower" : "d20"} {attackFlow.attack.attackBonus >= 0 ? "+" : "−"} {Math.abs(attackFlow.attack.attackBonus)}</strong></button>
        </section>}
        {attackFlow?.phase === "damage-roll" && targetAnalysis && <section className="roll-coach damage-coach" aria-live="polite">
          <div><span>{attackFlow.critical ? "Critical hit · Double the damage dice" : "Hit confirmed · Click to roll damage"}</span><h3>{attackFlow.attack.damage}</h3><p>Damage is rolled separately from the attack. The total will be applied to {targetAnalysis.target.name}&apos;s hit points.</p></div>
          <button type="button" onClick={rollSelectedDamage}><small>Roll damage</small><strong>{attackFlow.critical ? `Critical · ${attackFlow.attack.damage}` : attackFlow.attack.damage}</strong></button>
        </section>}
        {spellFlow?.phase === "attack-roll" && targetAnalysis && spellFlow.spell.attackBonus !== undefined && <section className="roll-coach attack-coach" aria-live="polite">
          <div><span>Spell attack roll · Click to roll</span><h3>{spellFlow.spell.name} vs. {targetAnalysis.target.name}</h3><p>Roll a <strong>d20</strong> {validateSpellChoice(encounter, spellFlow.spell).rollMode === "disadvantage" ? "twice and keep the lower result, then" : "and"} add {spellFlow.spell.attackBonus >= 0 ? "+" : "−"}{Math.abs(spellFlow.spell.attackBonus)}. Meet or beat AC {effectiveArmorClass(encounter, targetAnalysis.target.id) + (targetAnalysis.cover === "half" ? 2 : 0)}.</p></div>
          <button type="button" onClick={rollSelectedSpellAttack}><small>Roll spell attack</small><strong>{validateSpellChoice(encounter, spellFlow.spell).rollMode === "disadvantage" ? "2d20 · lower" : "d20"} {spellFlow.spell.attackBonus >= 0 ? "+" : "−"} {Math.abs(spellFlow.spell.attackBonus)}</strong></button>
        </section>}
        {spellFlow?.phase === "damage-roll" && targetAnalysis && spellFlow.spell.damage && <section className="roll-coach damage-coach" aria-live="polite">
          <div><span>{spellFlow.critical ? "Critical hit · Double the damage dice" : "Spell hit confirmed · Click to roll damage"}</span><h3>{spellFlow.spell.damage}</h3><p>Roll the spell&apos;s damage separately. The total will be applied to {targetAnalysis.target.name}&apos;s hit points.</p></div>
          <button type="button" onClick={rollSelectedSpellDamage}><small>Roll spell damage</small><strong>{spellFlow.critical ? `Critical · ${spellFlow.spell.damage}` : spellFlow.spell.damage}</strong></button>
        </section>}

        <section className="tactical-map-panel">
          <div className="map-heading"><div><span className="eyebrow">5-foot square grid</span><h3>Tactical map</h3></div><div className="map-legend"><span className="legend-player">Player</span><span className="legend-enemy">Enemy</span><span className="legend-difficult">Difficult</span><span className="legend-cover">Cover</span><span className="legend-objective">Objective</span></div></div>
          <div className={`target-panel ${targetAnalysis ? "has-target" : ""}`}>
            {targetAnalysis ? <><div><span>Selected target</span><strong>{targetAnalysis.target.name}</strong><small>{targetAnalysis.target.side} · AC {effectiveArmorClass(encounter, targetAnalysis.target.id)} · {targetAnalysis.target.side === "enemy" ? enemyHealthLabel(targetAnalysis.target, experienceMode) : `${targetAnalysis.target.hitPoints.current}/${targetAnalysis.target.hitPoints.maximum} HP`}</small></div><div><span>Distance</span><strong>{targetAnalysis.distanceFeet} ft.</strong></div><div><span>Sightline</span><strong>{targetAnalysis.lineOfSight ? "Clear" : "Blocked"}</strong></div><div><span>Cover</span><strong>{targetAnalysis.cover === "half" ? "Half (+2 AC)" : "None"}</strong></div><button type="button" disabled={activeCombatant.side !== "player"} onClick={() => { setEncounter((state) => selectTarget(state, null)); setAttackFlow(attackFlow ? { ...attackFlow, phase: "target", targetId: undefined } : null); setSpellFlow(spellFlow ? { ...spellFlow, phase: "target", targetId: undefined } : null); setFeedback("Target cleared."); }}>Clear target</button></> : <div className="target-empty"><span>{attackFlow?.phase === "target" ? `Targeting · ${attackFlow.attack.name}` : spellFlow?.phase === "target" ? `Targeting · ${spellFlow.spell.name}` : "Choose an action"}</span><strong>{attackFlow?.phase === "target" || spellFlow?.phase === "target" ? "Select a highlighted creature" : "Choose an attack or spell first"}</strong><small>{attackFlow?.phase === "target" ? "Gold rings indicate targets within this weapon’s range and line of sight." : spellFlow?.phase === "target" ? "Gold rings indicate legal targets for the selected spell." : "The selected option determines which targets ADaM highlights."}</small></div>}
          </div>
          <div className="map-scroll" role="region" aria-label="Tactical combat map">
            <div className="battle-grid" style={{ gridTemplateColumns: `repeat(${encounter.map.width}, 46px)` }}>
              {Array.from({ length: encounter.map.width * encounter.map.height }, (_, index) => {
                const x = index % encounter.map.width;
                const y = Math.floor(index / encounter.map.width);
                const terrain = encounter.map.terrain.find((cell) => cell.x === x && cell.y === y);
                const occupant = encounter.combatants.find((combatant) => combatant.position.x === x && combatant.position.y === y);
                const movementCell = legalMovementByCell.get(`${x},${y}`);
                const reachable = !attackFlow && !spellFlow && initiativeReady && activeCombatant.side === "player" && !occupant && Boolean(movementCell);
                const coordinate = `${String.fromCharCode(65 + x)}${y + 1}`;
                const targeted = occupant?.id === encounter.selectedTargetId;
                const targetCandidate = Boolean(occupant && (attackFlow?.phase === "target" || spellFlow?.phase === "target") && occupant.id !== activeCombatant.id);
                const legalOptionTarget = Boolean(occupant && (legalAttackTargetIds.has(occupant.id) || legalSpellTargetIds.has(occupant.id)));
                const targetValidation = occupant && attackFlow?.phase === "target" ? validateAttackTarget(encounter, attackFlow.attack, occupant.id) : occupant && spellFlow?.phase === "target" ? validateSpellTarget(encounter, spellFlow.spell, occupant.id) : null;
                const targetOptionName = attackFlow?.attack.name ?? spellFlow?.spell.name;
                return <button type="button" key={`${x}-${y}`} className={`grid-cell terrain-${terrain?.kind ?? "open"} ${reachable ? "reachable" : ""} ${targeted ? "targeted" : ""} ${legalOptionTarget ? "legal-target" : targetCandidate ? "illegal-target" : ""}`} onClick={() => handleGridInteraction(x, y, occupant?.id)} aria-pressed={targeted} aria-label={`${coordinate}. ${terrain?.label ?? "Open ground"}${movementCell ? `. Reachable for ${movementCell.cost} feet.` : ""}${occupant ? `. Occupied by ${occupant.name}. ${legalOptionTarget ? `Legal target for ${targetOptionName}.` : "Select as target."}` : ""}`} title={`${coordinate} · ${occupant ? legalOptionTarget ? `${occupant.name}: legal target` : targetValidation?.reason ?? `Select ${occupant.name}` : movementCell ? `${movementCell.cost} ft. by legal path` : terrain?.label ?? "Open ground"}`}>
                  <small>{coordinate}</small>
                  {terrain && <span className="terrain-mark" aria-hidden="true">{terrain.kind === "wall" ? "■" : terrain.kind === "difficult" ? "≈" : terrain.kind === "cover" ? "◩" : "◆"}</span>}
                  {occupant && <span className={`token ${occupant.side} ${occupant.hitPoints.current <= 0 ? occupant.side === "player" && !occupant.stabilized && occupant.deathSaves.failures < 3 ? "unconscious" : "defeated" : ""} ${targeted ? "selected" : ""}`} title={occupant.name}>{occupant.hitPoints.current <= 0 ? occupant.stabilized ? "S" : "0" : occupant.name.slice(0, 2).toUpperCase()}</span>}
                </button>;
              })}
            </div>
          </div>
          <div className="map-help"><span>{attackFlow?.phase === "target" || spellFlow?.phase === "target" ? "Gold ring: legal target for selected option" : "Creature token: inspect target"}</span><span>Highlighted empty square: tap once to move there</span><span>ADaM finds a legal path and charges terrain costs</span></div>
        </section>

        <div className="initiative-strip"><div className="round">Round <strong>{encounter.round}</strong></div>{encounter.combatants.map((combatant, index) => <div key={combatant.id} className={`initiative-card ${initiativeReady && index === encounter.activeIndex ? "active" : ""} ${combatant.hitPoints.current <= 0 ? combatant.side === "player" && !combatant.stabilized && combatant.deathSaves.failures < 3 ? "unconscious" : "defeated" : ""}`}><span>{combatant.initiativeRolled ? combatant.initiative : "—"}</span><div><strong>{combatant.name}</strong><small>{combatant.hitPoints.current <= 0 ? combatant.stabilized ? "stabilized" : combatant.deathSaves.failures >= 3 ? "defeated" : `${combatant.deathSaves.successes} saves · ${combatant.deathSaves.failures} failures` : combatant.initiativeRolled ? `initiative · ${combatant.side}` : combatant.side === "player" ? `d20 ${combatant.initiativeModifier >= 0 ? "+" : "−"}${Math.abs(combatant.initiativeModifier)} · your roll` : "ADaM rolls privately"}</small></div></div>)}</div>

        <div className="turn-dashboard"><div><span>Current turn</span><strong>{activeCombatant.name}</strong></div><div><span>Action</span><strong>{encounter.turn.action ? "Ready" : "Used"}</strong></div><div><span>Bonus action</span><strong>{encounter.turn.bonusAction ? "Ready" : "Used"}</strong></div><div><span>Movement</span><strong>{encounter.turn.movementRemaining} ft.{encounter.turn.disengaged ? " · Disengaged" : ""}</strong></div><div><span>Your reaction</span><strong>{playerCombatant.reactionAvailable ? "Ready" : "Used"}</strong></div></div>

        <section className="state-tray" aria-label="Character resources and temporary effects">
          <div className="resource-tracker"><div><span className="eyebrow">Combat resources</span><h3>Uses remaining</h3></div><div className="resource-pills">{playerCombatant.resources.length ? playerCombatant.resources.map((resource) => <div key={resource.id}><span>{resource.kind === "spell-slot" ? `Level ${resource.level} slots` : resource.name}</span><strong>{resource.current}/{resource.maximum}</strong></div>) : <p>No tracked resources imported.</p>}</div></div>
          <div className="effect-tracker"><div><span className="eyebrow">Derived statistics</span><h3>Active effects</h3></div><div className="effect-pills">{playerEffects.length ? playerEffects.map((effect) => { const remaining = remainingEffectRounds(encounter, effect); return <div key={effect.id}><span>{effect.concentration ? "Concentration" : remaining === 1 ? "Until next turn" : remaining === null ? "Ongoing" : `${remaining} rounds`}</span><strong>{effect.name}</strong><small>{effect.description}</small></div>; }) : <p>Base statistics only; no temporary modifiers are active.</p>}</div></div>
        </section>

        <section className="action-console">
          <div className="console-heading"><div><span className="eyebrow">{modeCopy[experienceMode].label} mode</span><h3>{targetAnalysis ? `Actions against ${targetAnalysis.target.name}` : "Choose your action"}</h3></div>{lastRoll && <div className="mini-roll"><span>Last roll</span><strong>{lastRoll.total}</strong></div>}</div>
          <div className="action-category-tabs" aria-label="Action economy categories">{actionCategoryCopy.map((category) => {
            const actions = visibleActions.filter((action) => action.cost === category.id);
            const legalCount = actions.filter((action) => validateAction(action, encounter, character).legal).length;
            return <button type="button" key={category.id} className={actionCategory === category.id ? "active" : ""} onClick={() => setActionCategory(category.id)}><span>{category.label}</span><strong>{legalCount}</strong><small>{category.detail}</small></button>;
          })}</div>
          <div className="action-grid">{categorizedActions.length ? categorizedActions.map((action) => {
            const validation = validateAction(action, encounter, character);
            const targetingLabel = action.targeting?.mode === "single" ? `${action.targeting.rangeFeet} ft.` : action.targeting?.mode === "area" ? `${action.targeting.shape} · ${action.targeting.sizeFeet} ft.` : action.cost.replace("-", " ");
            return <button key={action.id} className={!validation.legal ? "illegal" : ""} onClick={() => runAction(action)} title={experienceMode === "training" ? (validation.legal ? action.description : validation.reason) : undefined}><strong>{action.name}</strong><span>{targetingLabel}</span>{experienceMode !== "advanced" && <small>{validation.legal || experienceMode === "beginner" ? action.description : validation.reason}</small>}</button>;
          }) : <div className="category-empty"><strong>No actions available</strong><p>Your imported sheet and current turn state do not provide an option in this category.</p></div>}</div>
          {choiceMode === "attack" && <div className="choice-panel"><div className="choice-heading"><div><span>Step 1 · Choose weapon</span><strong>Weapon and attack options</strong></div><button type="button" onClick={() => { setChoiceMode(null); setAttackFlow(null); }}>Cancel</button></div><div className="choice-grid">{(character.attacks ?? []).map((attack) => { const selected = attackFlow?.attack.id === attack.id; return <button type="button" key={attack.id} className={selected ? "selected" : ""} onClick={() => chooseAttack(attack)}><span>{attack.kind} · {attack.normalRangeFeet}{attack.longRangeFeet ? `/${attack.longRangeFeet}` : ""} ft.</span><strong>{attack.name}</strong><small>{attack.damage} · {attack.attackBonus >= 0 ? "+" : ""}{attack.attackBonus} to hit</small><p>{selected && attackFlow?.phase === "target" ? `${legalAttackTargetIds.size} legal target${legalAttackTargetIds.size === 1 ? "" : "s"} highlighted on the map.` : attack.description}</p></button>; })}</div></div>}
          {choiceMode === "spell" && <div className="choice-panel"><div className="choice-heading"><div><span>Step 1 · Choose spell</span><strong>Spellbook and slot costs</strong></div><button type="button" onClick={() => { setChoiceMode(null); setSpellFlow(null); }}>Cancel</button></div><div className="choice-grid">{(character.spells ?? []).length ? (character.spells ?? []).map((spell) => { const validation = validateSpellAvailability(encounter, spell); const selected = spellFlow?.spell.id === spell.id; return <button type="button" key={spell.id} className={`${!validation.legal ? "illegal" : ""} ${selected ? "selected" : ""}`} onClick={() => chooseSpell(spell)}><span>{spell.level === 0 ? "Cantrip · free" : `Level ${spell.level} · 1 slot`}</span><strong>{spell.name}</strong><small>{spell.target === "self" ? "Self" : `${spell.rangeFeet} ft.`}{spell.concentration ? " · concentration" : ""}</small><p>{selected && spellFlow?.phase === "target" ? `${legalSpellTargetIds.size} legal target${legalSpellTargetIds.size === 1 ? "" : "s"} highlighted on the map.` : validation.legal ? spell.damage ?? spell.effect?.description ?? "Spell ready." : validation.reason}</p></button>; }) : <div className="category-empty"><strong>No spells imported</strong><p>This character sheet does not contain spell choices yet.</p></div>}</div></div>}
          <div className="area-effect-note"><span>Area-effect foundation</span><p>Future actions can define cones, cubes, cylinders, lines, spheres, or emanations and specify whether they affect every creature, only hostiles, or chosen creatures.</p></div>
          <div className="turn-controls"><div><span>Turn control</span><p>{activeCombatant.side === "player" ? "End your turn and let ADaM advance initiative." : "ADaM controls and advances enemy turns automatically."}</p></div><button type="button" disabled={activeCombatant.side !== "player" || outcome !== "active"} onClick={() => runAction(actionCatalog.find((action) => action.id === "end-turn")!)}>{activeCombatant.side === "player" ? "End turn" : "Enemy acting"}</button></div>
          <form className="command-bar" onSubmit={submitCommand}><label htmlFor="command">Or describe your action</label><div><input id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Example: I cast a spell at the scout" /><button>Submit</button></div></form>
          <div className="feedback" aria-live="polite"><span>ADaM</span><p>{feedback}</p></div>
        </section>

        <section className="encounter-log"><div><span className="eyebrow">Combat log</span><h3>Encounter state</h3></div><ol>{encounter.log.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol></section>
      </section>
    </section>
  </main>;
}
