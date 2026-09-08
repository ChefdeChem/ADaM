export type ScenarioEnvironment = "crypt" | "forest" | "market";
export type ScenarioObjective = "defeat" | "rescue" | "escape" | "hold";
export type ScenarioDifficulty = "easy" | "standard" | "hard";

export type ScenarioSetup = {
  prompt: string;
  environment: ScenarioEnvironment;
  objective: ScenarioObjective;
  difficulty: ScenarioDifficulty;
};

export type GridTerrainKind = "wall" | "open-door" | "difficult" | "cover" | "objective" | "flame";

export type GridTerrainCell = {
  door?: { locked: boolean; noisy?: boolean };
  x: number;
  y: number;
  kind: GridTerrainKind;
  label: string;
  divineAura?: "consecrated" | "desecrated";
  magicAura?: string;
  magicBarrier?: { material: "stone" | "dirt" | "wood" | "metal" | "lead"; thicknessInches: number };
  looseObject?: { unsecured: true };
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
