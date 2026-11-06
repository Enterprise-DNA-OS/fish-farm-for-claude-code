---
description: Draft the mortality report for MPI, the vet or the regulator from the records.
---

Read CLAUDE.md. Draft the mortality report for MPI, the vet or the regulator from the records.

Run `npm run farm -- draft-event-report <event>`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Writes a draft to drafts/. Fill in nothing you do not know; leave the bracketed parts for the farm manager. Nothing is sent from here.
