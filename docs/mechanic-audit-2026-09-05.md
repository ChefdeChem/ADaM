# Registry recovery and concentration audit

## Counting policy

The roster has 99 entries. The legacy `executable` count means an execution
path exists, including descriptive markers. It is not full rule coverage.
The UI now uses disjoint `supportSummary` counts and labels the headline
as fully supported. These are registry assessments of registered behavior,
not a certification of every possible D&D interaction.

Before this slice: 83 supported, 15 partial, 1 descriptive.
After this slice: 84 supported, 14 partial, 1 descriptive.
Control Flames is descriptive despite having a runnable marker. Its imported
content remains unchanged and its non-SRD options have not been copied.

## Ten bounded mechanic improvements

1. Rage: activation ends concentration, blocks ordinary and reaction spells,
   and incapacitation ends Rage. Damage bonus, Strength advantage, duration
   extension, and Heavy armor restrictions remain partial.
2. Surina's 2014 Lay on Hands: excludes undead and constructs before spending.
   Individual poison neutralization and disease curing remain partial.
3. Irven's 2024 Lay On Hands: spends 5 points to remove Poisoned, optionally
   alongside healing. Removing Poisoned also ends its registered source effects
   and associated attack/check disadvantage. Healing prevention does not block
   poison-only recovery. Touch can target a hostile creature in either edition.
4. Dancing Lights: incapacitation/death and voluntary concentration release.
5. Detect Magic: same lifecycle correction. Ritual/auras remain partial.
6. Heroism: same lifecycle correction, including effects on another creature.
7. Create Bonfire: same lifecycle correction to the existing user-imported spell.
   No new proprietary spell rules or text are introduced.
8. True Strike: same lifecycle correction, including pending future-turn benefit.
9. Guidance: same lifecycle correction, including the unused roll bonus.
10. Expeditious Retreat: same lifecycle correction, removing further Dash permission.

The shared concentration handler defers loss while a zero-HP replacement choice
is pending, avoids an obsolete concentration roll after voluntary release, and
uses the caster's edition for the 2024 maximum concentration DC of 30.

## Authorities

- [SRD 5.1](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf):
  printed pp. 31 (Lay on Hands), 102 (Concentration), and conditions appendix.
- [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf):
  printed pp. 29 (Rage), 54 (Lay On Hands), 179 (Concentration), and Poisoned.

## Next priorities

Finish Rage's remaining combat branches and 2014 Lay on Hands recovery.
Audit mastery ownership before implementing the weapon riders: an imported
weapon description alone does not establish that the character selected its mastery.
Then address Large Form occupancy and spell-specific gaps. Preserve uncertain
user choices rather than inferring them from weapon names. Continue import
reliability work after these gaps have been resolved or explicitly bounded.
