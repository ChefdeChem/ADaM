# Character edition and combat resolution

User-approved policy: detect and preserve the character's source build. Do not convert characters. Default encounter resolution to 2024 and explain differences. Source grants, level, selections and resource pools remain separate from resolution behavior. This cross-edition policy is an ADaM compatibility choice, not a claim that an unchanged 2014 character is a standard 2024 build.

Implemented in this slice:
- Non-destructive edition assessment using explicit edition and distinctive Paladin feature clues; ambiguous and conflicting evidence stays visible. A generic 5e label, weapon property or sheet layout does not grant an edition or mastery.
- Current combat default independent of character edition, including on roster activation and scenario restart.
- Ephemeral resolution profiles for legacy Lay on Hands and Divine Sense. Original records and resource pools are retained. Rest recovery updates source resource totals without persisting resolution overrides.
- Player-facing evidence, uncertainty and conflict notes. Removed the misleading old ruleset buttons, which changed labels without providing two complete resolution engines.
- Lay on Hands uses Bonus Action, permits Undead/Construct healing and removes Poisoned for five points. Disease/individual-poison removal is not offered in the current resolution profile.
- Divine Sense uses Bonus Action, 100-round expiry, senses through total cover and ends on Incapacitated. Its original resource pool remains a character-build property, explicitly noted to the player.

Authorities: official SRD 5.2.1 Paladin pp. 54-55, https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf; original 2014 provenance remains attached to the imported records. No proprietary rules added.

Coverage remains 85 supported / 13 partial / 1 descriptive in the source registry. Compatibility support is a separate dimension and is not claimed complete. This release does not complete Surina's entire flow or resolve all cross-edition spells and features.

## Roadmap

1. Extend edition evidence to additional class, species and spell definitions and preserve relevant extraction evidence from PDFs. Do not infer missing character choices.
2. Audit remaining cross-edition resolution conflicts, with exact source/applied notices and interaction tests. Keep unsupported resolutions explicit.
3. Complete Surina's combat and recovery flow under this policy.
4. Provide two genuine encounter settings: 2014 resolution and 2024 resolution, independently of character source edition. Both require engine coverage and regression gates before controls are enabled.

Validation: eight focused edition/compatibility tests and all 202 full-suite tests passed. Lint (zero errors, three existing generated-declaration warnings), production build and typecheck passed.
