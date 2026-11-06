---
description: Put a batch of fish into an empty unit (smolt transfer to sea, fry into tanks).
---

Read CLAUDE.md. Put a batch of fish into an empty unit (smolt transfer to sea, fry into tanks).

Run `npm run farm -- stock --unit= --batch= --count= --avg= [--on=YYYY-MM-DD] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. Add the batch first with /add-batch if it is new.
