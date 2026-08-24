# ADaM Combat Trainer

Initial local-first scaffold for a D&D combat training application.

## Included

- Fillable PDF and ADaM JSON character import adapters
- Normal, advantage, and disadvantage d20 engine
- Selectable D&D 2024 and D&D 2014/legacy rulesets
- Responsive training console
- Framework-independent domain, importer, engine, and ruleset modules
- Beginner, training, and advanced action-selection modes
- Scripted scenario generation from modular environments and objectives
- Initiative order, round tracking, action economy, movement, and combat log state

## Run locally

```bash
npm install
npm run dev
```

Use `src/data/sample-character.json` to test JSON import.

## Structure

```text
app/                 Interface and styles
src/domain/          Stable character model
src/engine/          Dice and future combat logic
src/importers/       Format-specific sheet adapters
src/rulesets/        Versioned game rules
src/scenarios/       Scripted scenario components and generator
src/data/            Sample import data
```

Next: schema validation, import review, target selection, enemy turns, conditions, concentration, resource tracking, and grid movement.
