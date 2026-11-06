---
description: Check the records against the rules in docs/compliance.md and cite the rule for every finding.
---

Read CLAUDE.md. Check the records against the rules in docs/compliance.md and cite the rule for every finding.

Run `npm run farm -- compliance`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Read docs/compliance.md first. Group findings by rule, worst first. Nothing here is legal advice; it checks the records against the rules the operator has told it to enforce.
