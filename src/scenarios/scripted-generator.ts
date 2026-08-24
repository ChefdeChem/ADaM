import type { Scenario } from "./types";

const environments = [
  { words: ["forest", "woods", "trees"], name: "Thornwood Crossing", features: ["Half cover from trees", "Difficult terrain in brambles"] },
  { words: ["dungeon", "crypt", "ruin"], name: "Shattered Reliquary", features: ["Narrow stone corridors", "Unstable pillars provide cover"] },
  { words: ["street", "city", "market"], name: "Abandoned Market", features: ["Vendor stalls provide half cover", "A raised balcony overlooks the square"] },
];

export function generateScriptedScenario(prompt: string): Scenario {
  const text = prompt.toLowerCase();
  const environment = environments.find((entry) => entry.words.some((word) => text.includes(word))) ?? environments[1];
  const objective = text.includes("rescue") ? "Reach and protect the trapped civilian" : text.includes("escape") ? "Reach the far exit before being surrounded" : text.includes("hold") || text.includes("defend") ? "Hold the marked position for three rounds" : "Defeat or drive off the hostile creatures";
  return {
    id: crypto.randomUUID(),
    title: environment.name,
    environment: environment.name,
    objective,
    opening: `You enter ${environment.name}. Two hostile figures move to block your path. Your objective: ${objective.toLowerCase()}.`,
    features: environment.features,
  };
}
