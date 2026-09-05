# Registry recovery and concentration audit

## Counting policy

The roster has 99 entries. The legacy `executable` count means an execution
path exists, including descriptive markers. It is not full rule coverage.
The UI now uses disjoint `supportSummary` counts and labels the headline
as fully supported. These are registry assessments of registered behavior,
not a certification of every possible D&D interaction.

Before this slice: 84 supported, 14 partial, 1 descriptive.
After this slice: 89 supported, 9 partial, 1 descriptive.
Control Flames is descriptive despite having a runnable marker. Its imported
content remains unchanged and its non-SRD options have not been copied.

## Ten bounded mechanic improvements

1. Rage: adds the Strength-based weapon and Unarmed Strike damage bonus,
   Strength check/save advantage, qualifying attack/save extension, optional
   Bonus Action extension, a ten-minute cap, and Heavy armor restrictions.
2. Surina's 2014 Lay on Hands: spends 5 points per selected registered disease
   or poison, supports multiple selections, and removes linked conditions.
3. Detect Magic: its Action reveals visible registered auras within 30 feet.
   Ritual timing remains partial.
4. Thunderwave: records its 300-foot boom and loose-object push alongside the
   already executable cube, save, damage, and creature push. Loose objects are
   not stateful map entities, so the entry remains partial.
5. Large Form: checks for a free 10-foot-square footprint, occupies four cells,
   respects walls, creatures, and map edges, and supports voluntary ending.
6. Goliath Maul: its selected Topple mastery forces the official Constitution
   save and applies Prone on a failure.
7. Goliath Spear: its selected Sap mastery applies disadvantage to the target's
   next attack roll for the registered duration.
8. Cleira's Charm Person: the target recognizes the caster when the charm ends.
9. Pharos's Charm Person: the same source-revelation branch is executable.
10. Searing Smite: recurring start-of-turn damage now queues the target's
    concentration check after resolving the spell's Constitution save.

## Authorities

- [SRD 5.1](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf):
  printed pp. 31 (Lay on Hands), 102 (Concentration), plus Charm Person,
  Detect Magic, and Thunderwave.
- [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf):
  Rage, Goliath Large Form, Weapon Mastery, Topple, Sap, Searing Smite,
  Concentration, and Prone.

## Next priorities

The next audit should close combat-relevant gaps whose ownership is established.
Do not infer mastery selection for other characters merely from a weapon name or
description. Preserve uncertain choices, then continue reliable import work once
the remaining registered gaps are either resolved or explicitly bounded.
