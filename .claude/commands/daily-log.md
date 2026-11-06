---
description: Record the day's feeding for a unit. Run once per unit per feed type; the feed type carries over from the last record.
---

Read CLAUDE.md. Record the day's feeding for a unit. Run once per unit per feed type; the feed type carries over from the last record.

Run `npm run farm -- log-feed --unit= --kg= [--feed=<feed code>] [--on=YYYY-MM-DD] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. When the operator reads out a whole site ("pen 1 1300, pen 2 1250..."), run one command per unit and report the total at the end with the feed days left. If deaths are part of the same report, run /mort for them.
