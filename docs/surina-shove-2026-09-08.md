# Surina: own-turn Shove and footprint hazard interactions

Surina's detected 2014 level-one build is unchanged. Current encounter resolution remains 2024. This slice adds a bounded, usable Shove interaction, not a claim of complete grappling or comprehensive tabletop support.

## Implemented

- Attack options expose knock Prone and push 5 feet against living enemies. Uses Surina's Action and DC 13 (8 + Strength modifier 3 + proficiency 2), not her Athletics modifier.
- The trainer chooses the NPC's Strength or Dexterity save before rolling, comparing success probability including Advantage, Disadvantage, automatic failure and modeled half-cover bonuses. No natural-20 automatic success for saving throws.
- Reach is 5 feet, independent of carried weapon reach. Uses creature footprints, source/target size, Total Cover, charm restrictions, conscious turns, initiative and pending-response guards.
- No weapon damage, hit-triggered mastery, spell trigger, ammunition spending or attack-roll effect consumption. Occupied hands and Speed zero do not themselves prevent a Shove. The Attack action's post-attack equipment interaction remains available.
- Prone immunity leaves no misleading Prone marker. Existing attack modifiers, crawling and Stand Up use the applied condition.
- Pushes use existing grid direction, walls, corners, occupancy and map-edge checks. No collision damage, movement cost or Opportunity Attack is invented.
- Successful movement enters registered point hazards; blocked movement does not re-trigger them. Hazard matching now checks all occupied cells of Large creatures, with one response per effect rather than one per occupied cell. Existing serial hazard/concentration responses are preserved.
- Player-facing copy contrasts the source-edition Athletics contest with the applied target saving throw. Imported character records and feature ownership remain untouched.

## Verified authorities (September 8, 2026)

- [Official SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf), printed page 190: Unarmed Strike / Shove; printed page 182: Grappling audit. Existing condition, cover and forced-movement resolution helpers retain their prior provenance.
- [Official 2014 Basic Rules: Combat](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/combat), Shoving a Creature: source-edition contrast only.

No proprietary spell text or additional imported character data was added. Synthetic test hazards exercise engine sequencing without introducing a spell definition.

## Remaining milestone work

- Grappling needs linked source/target records, hand occupancy, dragging, escape choice and checks, voluntary release, and release on incapacitation or separation. No marker-only substitute is offered.
- This Shove surface does not yet offer player-target saves, Reaction Shoves, special Monk alternatives, or guessing hidden targets. Those need their own choice/trigger flows.
- Ready remains limited to the existing weapon-after-movement trigger. Advanced visibility, interrupted rests and general tabletop adjudication remain outside the supported loop.
- Hazard entry frequency remains the existing registered-effect model; this footprint correction is not a claim of complete support for every spell's timing definition.

Coverage remains **85 supported / 13 partial / 1 descriptive**. Core interaction improvements do not increase the 99-entry registry counts.

The roadmap still requires independent 2014 and 2024 encounter-resolution settings. Neither a second working engine nor character conversion is introduced here.

Validation passed: 33 focused tests (14 new Shove/footprint cases plus hazard sequencing and Surina's seeded combat/recovery playthrough), all 282 full-suite tests, lint (zero errors; three pre-existing generated-declaration warnings), type checking and production build. Browser testing was not performed.
