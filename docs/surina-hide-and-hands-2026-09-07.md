# Surina: approved Hide ruling and weapon handling

The user approved this trainer adjudication on September 7, 2026: ordinary unobstructed enemy observation ends Hide automatically, while concealed detection uses Perception. This is labeled as a trainer ruling, not a claim that official text uniquely dictates every observation circumstance.

Visibility reconciliation now runs after player movement steps, resumed movement, enemy movement, forced movement, and door interactions, and before enemy Search. Only Hide effects are removed. Blind, unconscious/incapacitated, and allied observers do not reveal a creature by ordinary observation. A separate magical Invisible effect remains effective. Current maps assume visible lighting; darkness and special-sense simulation remain unsupported.

Surina now chooses held weapons before initiative. Carried inventory is not treated as held equipment. Drawing/stowing on her turn uses the shared free object interaction, then Utilize. The Attack action can draw its weapon when hands permit; if it does not, its one equipment change remains available after the attack. Opportunity attacks require a held weapon. Glaive and two-handed Longsword require both hands for the attack, while a two-handed weapon may be carried in one hand between attacks. Unarmed Strikes do not require a free hand. Throwing a Javelin consumes a carried copy and releases that held copy.

No original character records, mastery selections, spell selections, or resource grants were changed. Hand management is enabled for Surina's derived encounter profile; undefined hand state retains previous behavior for other profiles pending their audits.

## Player testing milestone

Surina's supported combat-and-recovery loop is available for testing: choose hands, roll initiative, move, use Divine Sense/Lay on Hands/Breath Weapon, attack and roll damage, resolve reactions, finish the encounter, recover using rests, and begin the next encounter. Optional supported practice includes Total-Cover Hide, modeled doors, skill checks, Help with an ally, and Ready after enemy movement. Seeded engine regressions exercise the loop; no browser-operated or human playthrough is claimed.

This is not blanket support for every tabletop action. Arbitrary Ready triggers, undefined objects, narrative skill outcomes, unmodeled senses/lighting, and interrupted adventure rests remain explicitly bounded or adjudicated. Registry counts remain 85 supported, 13 partial, 1 descriptive; these engine corrections do not add completed registry entries.

Official rule verification: SRD 5.2.1, Attack p. 177, Two-Handed/Versatile/Thrown p. 90, weapons p. 91, object interactions and Hide. https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf

Roadmap retained: separate 2014 and 2024 encounter-resolution settings, independent of character source edition. Neither selectable resolution setting is claimed implemented by this update.
