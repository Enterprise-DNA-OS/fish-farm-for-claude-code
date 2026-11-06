---
description: Move fish between units. A unit only ever holds one batch; moving every fish empties the source.
---

Read CLAUDE.md. Move fish between units. A unit only ever holds one batch; moving every fish empties the source.

Run `npm run farm -- move --from= --to= --count= [--avg=] [--on=YYYY-MM-DD] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. Say the count left behind and the new density in the destination (run units after).
