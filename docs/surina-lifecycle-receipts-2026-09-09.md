# Surina encounter lifecycle receipts

This interface slice extends the result-card system across five encounter lifecycle workflows:

1. Initiative
2. Enemy turns
3. Ending Surina's turn
4. Rest recovery
5. Building or loading a fresh encounter

Initiative now reports the ordered combatants and first turn. Enemy-turn results preserve player-facing damage and condition changes while respecting Advanced-mode enemy-health concealment. Ending Surina's turn identifies the next combatant and round. Recovery lists healing, restored resource pools, Hit Dice, and elapsed downtime. A fresh encounter confirms hostile count, held-weapon setup, and the initiative step.

These receipts derive from the same before-and-after encounter states used by the existing engine. They do not change initiative, enemy AI, turn advancement, rest eligibility, resource recovery, scenario generation, character data, or rules provenance. Registry coverage remains 95 fully supported, 3 partial, and 1 descriptive.
