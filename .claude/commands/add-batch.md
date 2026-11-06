---
description: Register a new batch or year class with its species and target harvest weight.
---

Read CLAUDE.md. Register a new batch or year class with its species and target harvest weight.

Run `npm run farm -- add-batch --code= --name= --species= [--origin=] [--target=<grams>] --actor=`. Flags use `--name=value`; quote values with spaces. Add `--json` for structured results. Use the operator's actual values, drop optional brackets, and never run a literal placeholder.

Codes are short and stable (YC27, AS26). Ask for the target harvest weight if the operator has one.
