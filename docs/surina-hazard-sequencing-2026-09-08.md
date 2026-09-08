# Surina hazard and enemy-route sequencing

This follow-up closes the two previously named engine gaps for existing registered point hazards: per-square enemy movement and serial overlapping hazard responses. It preserves all original character records and grants, the detected source-edition policy, and the approved Hide adjudication.

Enemy planning retains its route, traverses each square, checks departure reactions at the relevant step, and applies on-square hazards and visibility reconciliation. A paused opportunity attack retains the remaining route. Lethal damage stops the route and prevents the enemy Action. Ready remains the supported after-movement trigger, evaluated after the route finishes.

Point-hazard events retain an ordered queue. Player targets receive a clickable saving-throw prompt; enemy targets resolve their saves automatically. Each event completes its damage, any reduction or zero-HP replacement choice, and concentration before the next event proceeds. Automatic Strength/Dexterity failures from conditions use the shared rules resolver. End-turn hazards retain the ending initiative position until all responses finish, then advance without repeating the same end-turn event.

Regression coverage includes multiple hazards, concentration, Relentless Endurance, Stone's Endurance, end-turn suspension, intermediate enemy hazard squares, lethal intermediate damage, and opportunity-attack continuation. Defensive-feature tests use the existing verified characters; they do not grant those features to Surina. Synthetic hazards are test fixtures, not new spell definitions.

## Player-facing status

Surina supports the tested combat-and-rest loop and these hazard interactions. She is not labeled comprehensively playable across every tabletop interaction. Remaining broader gaps include arbitrary Ready triggers, grappling/escape workflows, unmodeled lighting and special senses, undefined objects and narrative outcomes, and interrupted adventure rests. Point-hazard event frequency still follows the existing registered engine model; per-definition re-entry limits and simultaneous-effect ordering choices require further audit. No new proprietary rule text or spell definitions were imported.

Registry coverage stays 85 supported, 13 partial, 1 descriptive. These core engine corrections do not inflate the 99-entry count.

Official resolution basis: SRD 5.2.1, movement and opportunity attacks, conditions and Concentration in the Rules Glossary; checked September 8, 2026. https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf

Roadmap retained: independent selectable 2014 and 2024 combat-resolution modes, separate from character source edition. Neither is newly implemented here.
