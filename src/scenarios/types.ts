export type ScenarioEnvironment = "crypt" | "forest" | "market";
export type ScenarioObjective = "defeat" | "rescue" | "escape" | "hold";
export type ScenarioDifficulty = "easy" | "standard" | "hard";

export type ScenarioSetup = {
  prompt: string;
  environment: ScenarioEnvironment;
  objective: ScenarioObjective;
  difficulty: ScenarioDifficulty;
};

export type GridTerrainKind = "wall" | "difficult" | "cover" | "objective" | "flame";

export type GridTerrainCell = {
  x: number;
  y: number;
  kind: GridTerrainKind;
  label: string;
  divineAura?: "consecrated" | "desecrated";
  magicAura?: string;
  flame?: { lit: boolean; controlled: boolean };
};

export type ScenarioGrid = {
  width: number;
  height: number;
  terrain: GridTerrainCell[];
};

export type Scenario = {
  id: string;
  title: string;
  environment: string;
  environmentId: ScenarioEnvironment;
  objective: string;
  objectiveId: ScenarioObjective;
  difficulty: ScenarioDifficulty;
  opening: string;
  features: string[];
  grid: ScenarioGrid;
  enemyProfileIds: string[];
};

export type ScenarioTemplate = {
  id: string;
  name: string;
  description: string;
  setup: ScenarioSetup;
};
