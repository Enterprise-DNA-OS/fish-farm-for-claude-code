# Fish Farm for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs attention, the week, what is overdue | `/attention` |
| Read out the day's feed | `/daily-log` |
| Fish died, losses, morts | `/mort` |
| A weighing, a sample, average weight | `/sample` |
| Oxygen, temperature, salinity | `/reading` |
| A treatment, medicated feed, a bath | `/treat` |
| New batch, year class | `/add-batch` |
| Fish into an empty pen or tank | `/stock` |
| Move, split, grade, transfer fish | `/move` |
| A harvest | `/harvest` |
| Feed arrived | `/deliver` |
| We told MPI, the vet or the council | `/notify` |
| Close a mortality event | `/close-event` |
| Biosecurity plan reviewed | `/review-plan` |
| What is in the pens | `/units` |
| One pen or tank | `/unit` |
| One batch | `/batch` |
| One mortality event | `/event` |
| The sites | `/sites` |
| Feeding by unit, feeding rate | `/feed` |
| Feed on hand, what to order | `/feed-stock` |
| Feed limit in the consent | `/feed-cap` |
| Deaths this month | `/mortality` |
| Mortality events | `/events` |
| Growth, when pens reach harvest weight | `/growth` |
| Oxygen and temperature this week | `/environment` |
| Treatments, withholding | `/treatments` |
| What can we harvest | `/harvest-plan` |
| Past harvests | `/harvests` |
| Feed conversion | `/fcr` |
| Are we compliant | `/compliance` |
| Report to MPI or the regulator | `/draft-event-report` |
| Paperwork for the processor | `/harvest-declaration` |
| Feed return for the council or EPA | `/feed-return` |
| The Monday review | `/weekly-review` |
| Bring data across from Farm360 | `/import` |
| A copy of everything | `/export` |
| Who changed what | `/activity` |
| Add a field, change a rule or threshold | `/customise` |
| A new dashboard | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run farm -- help`) and then propose a new command for it.

## Hard rules

- A unit holds one batch at a time. Never mix batches in a record.
- Never record a harvest the CLI refuses for withholding. Tell the operator the treatment and the clear date.
- A mortality event is reported by a person. Draft the report; never contact MPI, a vet or a regulator from here.
- Feed, death, weight and reading records are never edited. A correction is a new record with a note.

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Innovasea Farm360.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/farm360
