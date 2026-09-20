# Five import cross-reference gates

This slice adds five bounded checks between an imported character record and the mechanics ADaM exposes in combat.

1. Inventory records require unique names, whole-number quantities, and valid optional weights.
2. Executable equipment rules must have stable IDs and a matching carried inventory item.
3. Weapon and ammunition rules must point to real imported attacks, and ammunition must declare which attacks spend it.
4. Imported source features must point to real executable actions, passives, triggers, and attacks. Executable features without a source ownership link remain visible for review instead of being silently treated as verified ownership.
5. Executable feature actions, triggers, rerolls, and free casts must resolve their required imported resources and spells.

Broken executable references block the import. Missing ownership evidence is a review warning because user-provided records are preserved rather than rewritten. These checks do not invent equipment, features, choices, or proprietary rules content.

Registry coverage remains 98 fully supported, 0 partial, and 1 descriptive. Control Flames remains descriptive.
