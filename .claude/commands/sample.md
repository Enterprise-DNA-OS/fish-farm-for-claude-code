---
description: Record a weighing: how many fish were weighed and their average weight. Biomass and density update from it.
---

Read CLAUDE.md. Record a weighing: how many fish were weighed and their average weight. Biomass and density update from it.

Run `npm run farm -- sample --unit= --fish= --avg= [--on=YYYY-MM-DD] [--note=] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. If the output warns about density, say so first and offer the harvest plan or a split with /move.
