---
description: Record deaths in a unit. A day's deaths above the site threshold open a mortality event in the same step.
---

Read CLAUDE.md. Record deaths in a unit. A day's deaths above the site threshold open a mortality event in the same step.

Run `npm run farm -- mort --unit= --count= [--cause=unknown|predator|disease|handling|algal_bloom|low_oxygen|temperature|other] [--note=] [--on=YYYY-MM-DD] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. If the output says an event was opened, stop and tell the operator straight away: who must hear, by when, and offer /draft-event-report. Ask whether samples went to the lab.
