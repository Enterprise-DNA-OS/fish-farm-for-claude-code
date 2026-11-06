---
description: Record a veterinary treatment with its withholding period and the vet authorisation.
---

Read CLAUDE.md. Record a veterinary treatment with its withholding period and the vet authorisation.

Run `npm run farm -- treat --unit= --product= --reason= --withholding=<days> [--authorised-by=] [--ref=] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--code=] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the unit first (`npm run farm -- unit <code>`). Put the real person doing this in `--actor`. If a name matches more than one unit, show the candidates and ask. Ask for the authorising vet and the authorisation reference before you record a restricted product. Say the date harvest is clear from.
