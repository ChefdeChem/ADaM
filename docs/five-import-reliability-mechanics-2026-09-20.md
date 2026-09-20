# Five import reliability mechanics

## Completed mechanics

1. Core combat statistics are validated before an imported character can enter an encounter. Level, Armor Class, Hit Points, speed, Proficiency Bonus, and all six abilities now produce specific blockers or review warnings.
2. Imported attacks are validated for unique identity, supported attack type, numeric attack bonus, rollable damage, and coherent normal and long ranges.
3. Imported resources are validated for unique identity, current and maximum bounds, recovery schedule, and legal spell-slot level.
4. Imported spells are validated for identity, level, casting time, targeting, range, line-of-sight declaration, rollable damage or healing, and source provenance.
5. Imports now receive a stable file identity. Re-importing the same source replaces its prior roster record without consuming another slot, while declared JSON source metadata remains attached to the new import record.

## Player experience

The review dialog lists blocking issues separately from warnings and disables combat entry until blocking core values are corrected. Warnings remain visible for confirmation against the source sheet. Re-import results explicitly tell the player when an existing roster character was updated.

## Coverage and boundaries

Registry coverage remains **98 fully supported, 0 partial, and 1 descriptive**, totaling 99. These import safeguards do not reclassify registry entries. Control Flames remains descriptive because no permitted SRD source supplies its imported option definition.

The import layer preserves user-provided content and declared source metadata. Validation determines whether ADaM can execute a supplied definition; it does not convert a character, invent missing class grants, or claim that unsupported content is official.
