# Surina movement-boundary follow-up

This bounded Surina audit slice corrects existing grid movement without changing character grants, imported records, interface layout, or the approved Hide ruling.

- Five-foot diagonals remain the encounter convention, but player paths, enemy paths, and straight forced movement no longer cross solid wall corners. Half cover and open doors are not treated as solid obstacles.
- Players and enemies share the same movement-square cost: 5 feet normally, 10 feet when crawling or entering Difficult Terrain, and 15 feet when both apply. Prone enemies no longer move at standing cost.
- Interrupted movement checks available movement, destination occupancy, solid terrain, and adjacent-step corner/crawl costs before resuming. Rejected steps leave position and movement unchanged and do not resume the rest of the player's path.
- A player path stops at its current square when a hazard reduces the mover to 0 HP, reduces Speed to 0, or queues a response. After an on-square response, the player may select a further destination rather than silently advancing through the prompt.

Nine focused regressions cover ordinary diagonals, corners and detours, non-solid terrain, additive crawl costs, enemy crawl behavior, forced movement, stale interrupted destinations, insufficient/invalid costs, pending responses, and a lethal on-path hazard. Existing Surina playthrough and interaction regressions remain in the validation gate.

Rules verified September 8, 2026 against official SRD 5.2.1: grid movement and corners p. 13, movement p. 14, Crawling p. 179, Prone p. 186. https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf

The hazard regression uses a synthetic test fixture for existing engine behavior, not a new spell, source grant, or proprietary rules definition.

## Honest coverage and remaining work

Registry coverage remains 85 supported / 13 partial / 1 descriptive. Core movement corrections do not add completed entries. This is not comprehensive tabletop support. Enemy movement still resolves a planned route as a destination transition; per-square enemy hazards and mid-route visibility, multiple simultaneous point-hazard response sequencing, and broader Ready triggers need further audit. No new browser-operated playthrough is claimed.

The roadmap still calls for independent 2014 and 2024 encounter-resolution settings, separate from detected character source edition. Those settings are not implemented by this slice.
