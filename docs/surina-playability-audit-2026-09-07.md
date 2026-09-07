# Surina playability audit: defensive and weapon flow

Surina remains a level-one 2014 Dragonborn Paladin with current combat resolution. Imported records and character grants remain unchanged. This is a progress slice, not a declaration of complete playability.

## Implemented

- Dodge now influences actual weapon, spell and opportunity attack rolls through the shared roll-mode resolver. It grants Dexterity saving throw Advantage independently of sight. Incoming attack Disadvantage requires seeing the attacker, with the trainer's wall, Blinded and Invisible model. Advantage and Disadvantage cancel normally.
- Dodge is an engine action rather than an inert UI marker. It ends at the next turn, on Incapacitated, or at Speed 0. Spending movement is not the same as Speed 0. Removing the restricting condition does not restore an ended Dodge.
- Incapacitated blocks generic actions, weapon attacks and opportunity Reactions. Enemy offense also respects the condition. Opportunity attacks require sight and available equipment.
- Speed-zero conditions prevent voluntary map movement and interrupted movement completion. Incapacitated alone is not treated as Speed 0.
- Surina can select her Longsword's two-handed 1d10 mode. It shares the existing weapon inventory, uses normal/critical damage, and cannot be used with an equipped Shield. No Sap or Graze mastery is invented, and imported source data is unchanged.

## Audit status

| Flow | Status |
| --- | --- |
| Original class/species grants and resources | Preserved; no conversion |
| Divine Sense / Lay on Hands compatibility | Existing v42 overrides retained and regression-tested |
| Fire resistance, basic weapon damage, thrown inventory | Existing implementation retained |
| Dodge, action inhibition, reaction sight, Longsword Versatile | Improved and interaction-tested here |
| Weapon handling | Full held-item switching/free-hand model remains incomplete |
| Breath Weapon | Current-resolution conflict and interruptible multi-target damage remain to audit |
| Conditions | Full Prone, visibility/special senses, automatic saves and other condition consequences remain incomplete |
| Recovery | Resource-only rest controls exist; HP/Hit Dice, elapsed duration and complete rest prerequisites remain incomplete |
| General actions | Help, Hide, Ready, Search and other skill workflows are not fully executable |
| Player dice | Multi-target defensive choices and all click-to-roll continuations require further work |

Source registry coverage remains 85 fully supported, 13 partial, 1 descriptive. Core-action corrections do not inflate the 99-entry character registry. Its coverage is not an end-to-end playability measure.

## Authorities

Verified September 7, 2026 against official SRD 5.2.1: Dodge p. 181, Incapacitated and other conditions in the Rules Glossary, Versatile and Longsword pp. 89-91. https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf

The app's existing visibility model is limited to modeled conditions and terrain, not arbitrary DM visibility rulings. No proprietary rule content is added.

## Next work

Continue Surina's rest/recovery and Breath Weapon interaction gaps. Retain separate future 2014 and 2024 encounter settings as a roadmap item, not a working toggle.

## Playthrough milestone follow-up

The automated playthrough now exercises initiative, Divine Sense, Search, enemy movement and attacks, an opportunity-reaction decline and continuation, Lay on Hands, Breath Weapon, movement to weapon range, a weapon hit and damage, victory, Short Rest with a Hit Die, Long Rest, and a new encounter. Seeded dice make this a repeatable regression, not a claim that Surina wins every encounter. No browser-operated playthrough is claimed.

- Recovery now tracks her one d10 Hit Die, HP, original resource pools, elapsed downtime and timed-effect expiry. Long Rest clears temporary HP and restores the Hit Die. The safe-downtime surface explicitly waits out the 16-hour interval before another 8-hour Long Rest. Living hostiles, pending choices, zero HP and ongoing damage block recovery. These are uninterrupted training rests; an adventure interruption/sleep/exhaustion subsystem is not claimed.
- Breath Weapon uses current level-one 1d10 Fire resolution and a 15-foot Cone/30-foot Line choice while preserving the original one-use Short Rest resource. Its current-resolution provenance is explicit. Area targets resolve sequentially across defensive choices. Charmed restrictions and automatic Strength/Dexterity save failures apply. The existing grid area/visibility model is retained; arbitrary area origins and special-sense geometry remain outside this surface.
- Prone now affects attacks and crawling, and Stand Up spends half Speed. Blinded, Invisible, Restrained, Paralyzed, Stunned and Unconscious feed attack modes. Nearby hits against Paralyzed/Unconscious targets become critical hits. Dodge now reaches the actual player Dexterity save prompt.
- Search, Study and Influence offer actual skill rolls and spend Action. Narrative discoveries and NPC behavior remain explicitly adjudicated; the UI does not invent a DC or turn a persuasion roll into control. Surina's unsupported Help/Hide/Ready/Utilize paths no longer report false automatic success.
- Recovered HP, source resources, Hit Dice and spent inventory carry to the next encounter. Original feature descriptions and equipment quantities remain untouched. New encounters derive from the source character, avoiding repeated derivation that would misidentify her build.

This establishes a tested trainer combat-and-recovery playthrough, not complete support for every tabletop option. Remaining broader work includes held-item switching, arbitrary Ready triggers, concealment/Help/object workflows, special senses, grappling escape adjudication and adventure rest interruptions. Registry coverage remains 85 supported / 13 partial / 1 descriptive; no marker or core correction adds an entry to that count.

Validation for this follow-up: ten new focused regressions, the existing Surina/edition regressions, full suite, type checking, lint and production build. SRD 5.2.1 authorities: Dragonborn p. 84; Rules Glossary entries for Short Rest, Long Rest, Prone, Paralyzed, Stunned, Unconscious, Search, Study and Influence. Existing source edition remains 2014. Future separate 2014/2024 encounter resolution settings remain on the roadmap, unimplemented.
