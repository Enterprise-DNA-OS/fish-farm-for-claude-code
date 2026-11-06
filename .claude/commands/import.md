---
description: Bring stock and daily records across from an Innovasea Farm360 export. Always a dry run first.
---

Read CLAUDE.md. Bring stock and daily records across from an Innovasea Farm360 export. Always a dry run first.

Run `npm run farm -- import farm360 [--stock=stock.csv] [--daily=daily.csv] [--dry-run] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read docs/replace-farm360.md. Run with --dry-run first and show every problem row. Import for real only after the operator says go.
