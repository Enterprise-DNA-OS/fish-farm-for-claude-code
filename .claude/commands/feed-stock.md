---
description: Feed on hand by type and the days left at the current rate.
---

Read CLAUDE.md. Feed on hand by type and the days left at the current rate.

Run `npm run farm -- feed-stock`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Anything under its reorder days comes first, with the quantity to order to get back to four weeks.
