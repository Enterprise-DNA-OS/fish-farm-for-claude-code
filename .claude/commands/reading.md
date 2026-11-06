---
description: Record dissolved oxygen, temperature or salinity at a site or a unit.
---

Read CLAUDE.md. Record dissolved oxygen, temperature or salinity at a site or a unit.

Run `npm run farm -- reading --site= [--unit=] --parameter=DO|TEMP|SAL --value= [--on=YYYY-MM-DD] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

If the output warns that oxygen is below the site minimum, tell the operator to stop or cut feeding and check the fish, then record any deaths with /mort.
