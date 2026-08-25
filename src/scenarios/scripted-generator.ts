import type { Scenario, ScenarioEnvironment, ScenarioGrid, ScenarioObjective, ScenarioSetup, ScenarioTemplate } from "./types";

const environments: Record<ScenarioEnvironment, { words: string[]; name: string; features: string[] }> = {
  forest: { words: ["forest", "woods", "trees", "grove"], name: "Thornwood Crossing", features: ["Half cover from trees", "Difficult terrain in brambles"] },
  crypt: { words: ["dungeon", "crypt", "ruin", "tomb"], name: "Shattered Reliquary", features: ["Narrow stone corridors", "Unstable pillars provide cover"] },
  market: { words: ["street", "city", "market", "town"], name: "Abandoned Market", features: ["Vendor stalls provide half cover", "A raised balcony overlooks the square"] },
};

const objectiveCopy: Record<ScenarioObjective, string> = {
  defeat: "Defeat or drive off the hostile creatures",
  rescue: "Reach and protect the trapped civilian",
  escape: "Reach the far exit before being surrounded",
  hold: "Hold the marked position for three rounds",
};

export const scenarioTemplates: ScenarioTemplate[] = [
  {
    id: "crypt-rescue",
    name: "Crypt Rescue",
    description: "Recover a scholar from a guarded reliquary.",
    setup: { prompt: "A ruined crypt where I must rescue a trapped scholar", environment: "crypt", objective: "rescue", difficulty: "standard" },
  },
  {
    id: "forest-ambush",
    name: "Forest Ambush",
    description: "Break through attackers and escape the crossing.",
    setup: { prompt: "An ambush in dense woodland with a blocked trail", environment: "forest", objective: "escape", difficulty: "easy" },
  },
  {
    id: "market-holdout",
    name: "Market Holdout",
    description: "Defend a position against a difficult assault.",
    setup: { prompt: "Hold the abandoned market square against raiders", environment: "market", objective: "hold", difficulty: "hard" },
  },
];

export const defaultScenarioSetup: ScenarioSetup = { ...scenarioTemplates[0].setup };

function inferEnvironment(text: string): ScenarioEnvironment {
  return (Object.entries(environments) as [ScenarioEnvironment, (typeof environments)[ScenarioEnvironment]][])
    .find(([, entry]) => entry.words.some((word) => text.includes(word)))?.[0] ?? "crypt";
}

function inferObjective(text: string): ScenarioObjective {
  if (text.includes("rescue") || text.includes("save") || text.includes("protect")) return "rescue";
  if (text.includes("escape") || text.includes("flee") || text.includes("exit")) return "escape";
  if (text.includes("hold") || text.includes("defend")) return "hold";
  return "defeat";
}

function createGrid(environment: ScenarioEnvironment, objective: ScenarioObjective): ScenarioGrid {
  const objectiveCell = { x: 10, y: objective === "hold" ? 4 : 6, kind: "objective" as const, label: objectiveCopy[objective] };
  const terrainByEnvironment: Record<ScenarioEnvironment, ScenarioGrid["terrain"]> = {
    crypt: [
      { x: 4, y: 1, kind: "wall", label: "Stone wall" }, { x: 4, y: 2, kind: "wall", label: "Stone wall" },
      { x: 4, y: 5, kind: "wall", label: "Stone wall" }, { x: 4, y: 6, kind: "wall", label: "Stone wall" },
      { x: 6, y: 3, kind: "difficult", label: "Loose rubble" }, { x: 6, y: 4, kind: "difficult", label: "Loose rubble" },
      { x: 8, y: 2, kind: "cover", label: "Unstable pillar" }, { x: 8, y: 5, kind: "cover", label: "Unstable pillar" },
    ],
    forest: [
      { x: 4, y: 1, kind: "wall", label: "Thick tree" }, { x: 7, y: 2, kind: "wall", label: "Thick tree" },
      { x: 5, y: 5, kind: "wall", label: "Thick tree" }, { x: 9, y: 6, kind: "wall", label: "Thick tree" },
      { x: 3, y: 3, kind: "difficult", label: "Dense brambles" }, { x: 4, y: 3, kind: "difficult", label: "Dense brambles" },
      { x: 5, y: 3, kind: "difficult", label: "Dense brambles" }, { x: 8, y: 4, kind: "cover", label: "Fallen log" },
    ],
    market: [
      { x: 4, y: 2, kind: "cover", label: "Vendor stall" }, { x: 5, y: 2, kind: "cover", label: "Vendor stall" },
      { x: 7, y: 5, kind: "cover", label: "Vendor stall" }, { x: 8, y: 5, kind: "cover", label: "Vendor stall" },
      { x: 6, y: 3, kind: "wall", label: "Collapsed cart" }, { x: 6, y: 4, kind: "wall", label: "Collapsed cart" },
      { x: 3, y: 6, kind: "difficult", label: "Scattered crates" }, { x: 4, y: 6, kind: "difficult", label: "Scattered crates" },
    ],
  };
  return { width: 12, height: 8, terrain: [...terrainByEnvironment[environment], objectiveCell] };
}

export function generateScriptedScenario(input: string | ScenarioSetup): Scenario {
  const guided = typeof input !== "string";
  const prompt = guided ? input.prompt : input;
  const text = prompt.toLowerCase();
  const environmentId = guided ? input.environment : inferEnvironment(text);
  const objectiveId = guided ? input.objective : inferObjective(text);
  const difficulty = guided ? input.difficulty : text.includes("hard") || text.includes("deadly") ? "hard" : text.includes("easy") ? "easy" : "standard";
  const environment = environments[environmentId];
  const objective = objectiveCopy[objectiveId];
  const enemyCount = difficulty === "easy" ? "One hostile figure moves" : difficulty === "hard" ? "Three hostile figures move" : "Two hostile figures move";
  return {
    id: crypto.randomUUID(),
    title: environment.name,
    environment: environment.name,
    environmentId,
    objective,
    objectiveId,
    difficulty,
    opening: `You enter ${environment.name}. ${enemyCount} to block your path. Your objective: ${objective.toLowerCase()}.`,
    features: environment.features,
    grid: createGrid(environmentId, objectiveId),
  };
}
