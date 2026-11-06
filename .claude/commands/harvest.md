---
description: Record a harvest from a unit. Refused while any treatment's withholding period is running.
---

Read CLAUDE.md. Record a harvest from a unit. Refused while any treatment's withholding period is running.

Run `npm run farm -- harvest --unit= --count= --kg= --processor= [--docket=] [--on=YYYY-MM-DD] [--code=] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. If it is refused for withholding, say the treatment and the date harvest is clear from. After a harvest, offer /harvest-declaration.
