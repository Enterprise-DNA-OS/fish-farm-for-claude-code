---
description: Record that a mortality event was reported: to whom, when and the reference they gave.
---

Read CLAUDE.md. Record that a mortality event was reported: to whom, when and the reference they gave.

Run `npm run farm -- notify <event> --to= --reference= [--on=YYYY-MM-DD] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read the event first (`npm run farm -- event <code>`). Report whether it was inside the window.
