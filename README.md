# ADaM Combat Trainer

Initial local-first scaffold for a D&D combat training application.

## Included

- Fillable PDF and ADaM JSON character import adapters
- Device-local roster for five uploaded characters, with one-tap encounter loading of each character's complete combat statistics
- Cleira Oestwilde included as the first verified roster character, with legacy ruleset selection, spell slots, Bardic Inspiration, attacks, saves, skills, senses, proficiencies, equipment, and spellbook data extracted from her D&D Beyond PDF
- Normal, advantage, and disadvantage d20 engine
- Selectable D&D 2024 and D&D 2014/legacy rulesets
- Responsive training console
- Framework-independent domain, importer, engine, and ruleset modules
- Beginner, training, and advanced action-selection modes
- Scripted scenario generation from modular environments and objectives
- Natural-language, guided, combined, and reusable-template scenario setup
- Initiative order, round tracking, action economy, movement, and combat log state
- Interactive 5-foot square tactical grid with one-tap pathfinding to every reachable square, split movement, Dash, Disengage, blocking terrain, occupied squares, and difficult-terrain costs
- Weapon-first and spell-first combat flows that highlight legal targets using grid distance, line of sight, cover, range, and target-type rules
- Action, Bonus Action, and Movement category navigation with legal-option counts and a persistent End Turn control
- Extensible area-effect targeting schema for shapes, size, origin, affected creatures, and per-target resolution
- Character-sheet attack picker with melee, normal-range, and long-range validation
- Automatic disadvantage at long range and when making ranged attacks while threatened within 5 feet
- Spell picker with spell-level costs, tracked slot pools, cantrips, and per-cast resource spending
- Single-target enemy saving-throw resolution and friendly healing spell support; Cleira's Healing Word is fully playable
- Base combat statistics separated from derived values and temporary modifiers
- Round-based effect expiration, concentration replacement, and temporary hit-point ownership
- Automated enemy initiative, movement, targeting, attacks, damage, and saving-throw abilities
- Mode-scaled enemy tactics: predictable direct play for Beginner, signature abilities and repositioning for Intermediate, and vulnerable-target, strongest-attack, range, and cover priorities for Advanced
- Player-controlled saving throws, Shield and opportunity-attack reaction windows, concentration checks, and death saves
- Automated enemy opportunity attacks when the player leaves reach, with movement resolved in the correct sequence
- Mode-based enemy health visibility with exact, descriptive, and concealed states

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

## Rules content updates

- Rules mechanics are separated from the interface and tracked by edition in `src/rulesets/content-manifest.ts`.
- Individual weapons, spells, and features should use stable action IDs and declarative targeting profiles rather than interface-specific logic.
- One combat round represents 6 seconds: 1 minute is 10 rounds and 10 minutes is 100 rounds.
- Base character values remain unchanged during combat; active effects produce derived AC, attack, saving-throw, and speed modifiers.
- Spell slots are tracked by level. Casting a leveled spell spends one slot from its level; cantrips spend no slot.
- Area effects record shape, size, origin, range, line-of-sight needs, affected-creature policy, and whether attacks or saves resolve per target.
- Friendly fire is never inferred: each action explicitly declares whether it affects all creatures, hostile creatures, or chosen creatures.
- A rules-content change should update the appropriate edition revision and receive regression coverage before release.
- Enemy attacks and abilities use data profiles; player response rolls pause the DM turn until resolved.

## Deferred interface notes

- Show dice rolls prominently above the encounter.
- Animate the relevant die values cycling or spinning before each result settles.
- Keep the complete initiative order and values visible throughout combat, including enemy initiative.
- Give every non-initiative roll a prominent teaching display so new players can see which dice and modifiers are being used.

Next: schema validation, expanded import mapping, cover refinements, broader conditions, and additional class-specific reaction triggers.
