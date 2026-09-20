# Five import-to-play handoffs

This slice verifies that an accepted character import reaches the live combat engine without silently replacing supplied values.

1. **Initiative:** an imported initiative modifier now takes precedence over a plain Dexterity-derived modifier. When the sheet does not supply one, Dexterity remains the safe default.
2. **Starting movement:** the character's imported walking speed is available on the first combat turn. It is no longer temporarily replaced by a fixed 30-foot allowance.
3. **Saving throws:** imported saving-throw modifiers remain authoritative. Missing modifiers derive from the corresponding ability score without changing the uploaded record.
4. **Skill checks:** imported skill totals remain authoritative. Unlisted skills now use the ability linked to that skill instead of an incorrect zero modifier.
5. **Spell slots:** imported leveled spells retain their imported slot pools and spend those pools through the normal combat flow.

The import review now shows these five handoffs before the character is stored. It identifies imported values, safe derived fallbacks, and leveled spells that lack a corresponding imported casting pool.

## Boundaries

- No missing class feature, spell, proficiency, or player choice is invented.
- Source-edition detection and the original imported record remain separate from current combat resolution.
- A missing spell-slot or free-cast pool is reported for review rather than silently granting a resource.
- Equipment and feature cross-reference auditing remain subsequent import work.

Registry coverage remains **98 fully supported, 0 partial, and 1 descriptive**, totaling 99. These import-to-engine handoffs do not reclassify registry entries.

Rules behavior was checked against official SRD 5.2.1, the current licensed rules reference published by Wizards of the Coast.
