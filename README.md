<h1 align="center">Fish Farm for Claude Code</h1>

<p align="center">
  <strong>The open-source fish farm management system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Innovasea Farm360 data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=farm360">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/farm360?utm_source=github&utm_medium=readme&utm_campaign=farm360">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-farm360">Instead of Innovasea Farm360</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Fish Farm for Claude Code does the job you pay Innovasea Farm360 for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Innovasea Farm360 dashboard cannot.

Innovasea does not publish a price for Farm360: it is quoted to each farm, and when the product was still Aquanetix its price scaled with how much feed a farm used each year ([Global Seafood Alliance](https://www.globalseafood.org/advocate/data-collection-app-provides-cloud-coverage/)). Bring your own agreement to compare.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=farm360).

It covers what a salmon or trout farm records every day: sites, pens and tanks, batches and year classes, the fish in each unit, feed, deaths, weighings, oxygen and temperature, veterinary treatments with their withholding periods, fish moves and harvests. It is built for NZ and Australian finfish farms, from a single hatchery to several marine leases, and it checks the records against the rules they live under: reporting mass mortalities, the feed limit in a marine farm consent, stocking density, withholding periods and the biosecurity management plan.

### Your first hour: ten things to ask for

1. "What needs attention this week?"
2. "Pen 1 1300 kilos, pen 2 1250, pen 3 1700, pen 5 600, all finisher except pen 5." (the day's feed, read out)
3. "We lost 700 fish in canal pen 3 this morning." (a mortality event opens if it crosses your threshold)
4. "Which pens are ready to harvest and clear of withholding?"
5. "How close is Dover Bay to its feed limit?"
6. "When does pen 5 reach harvest weight at its current growth?"
7. "Which feed do we need to order this week?"
8. "Draft the mortality report for ME-0002."
9. "Write the harvest declaration for HV-002 for the processor."
10. "Our density limit at Blackwood Reach is 17 kilos per cubic metre, not 15." (`/customise`)

### Ten questions the Farm360 dashboard does not answer

1. Which mortality events has nobody reported to MPI yet, and how late are we?
2. Which pens are at harvest weight and clear of every withholding period?
3. Which sites are over or close to the yearly feed limit in their consent?
4. Which pens are over their stocking density limit right now?
5. Where did dissolved oxygen drop below our minimum this week?
6. Which units have no feed recorded for two days or more?
7. Which feed runs out before the next delivery, at this week's rate?
8. What is each pen's growth rate, and when does it reach harvest weight?
9. Which treatments have no vet authorisation on record?
10. For this harvest, which treatments and feed went into those fish?


## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/fish-farm-for-claude-code.git
cd fish-farm-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo farm has an unreported mortality event, a lease over its feed limit, a pen over its density limit and low oxygen yesterday. Run `npm test` to check every command, and `npm run view` and `npm run docs` for the branded dashboards and paperwork.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | What needs a person this week: unreported deaths, feed caps, stocking density, low oxygen, missing records, low feed, plan reviews. |
| `/daily-log` | Record the day's feeding for a unit. Run once per unit per feed type; the feed type carries over from the last record. |
| `/mort` | Record deaths in a unit. A day's deaths above the site threshold open a mortality event in the same step. |
| `/sample` | Record a weighing: how many fish were weighed and their average weight. Biomass and density update from it. |
| `/reading` | Record dissolved oxygen, temperature or salinity at a site or a unit. |
| `/treat` | Record a veterinary treatment with its withholding period and the vet authorisation. |
| `/stock` | Put a batch of fish into an empty unit (smolt transfer to sea, fry into tanks). |
| `/add-batch` | Register a new batch or year class with its species and target harvest weight. |
| `/move` | Move fish between units. A unit only ever holds one batch; moving every fish empties the source. |
| `/harvest` | Record a harvest from a unit. Refused while any treatment's withholding period is running. |
| `/deliver` | Record a feed delivery with its lot and docket number. |
| `/notify` | Record that a mortality event was reported: to whom, when and the reference they gave. |
| `/close-event` | Close a mortality event with its cause and what was done. Refused until it has been reported. |
| `/review-plan` | Record that a site's biosecurity management plan was reviewed. |
| `/units` | Every stocked pen and tank: batch, fish, weight, biomass, density against its limit, last fed. |
| `/unit` | One pen or tank: what is in it, feed for 14 days, deaths, weights, treatments, what needs attention. |
| `/batch` | One batch or year class: where it is, what was harvested, deaths, feed and feed conversion. |
| `/event` | One mortality event: the deaths around it, oxygen before it, who was told. |
| `/sites` | Every site: regulator, consent, fish and biomass in the water, feed against the cap. |
| `/feed` | Feed by unit: yesterday, the 7-day average, and the feeding rate as a share of biomass. |
| `/feed-stock` | Feed on hand by type and the days left at the current rate. |
| `/feed-cap` | Feed used at each site over the last 365 days against the yearly cap in its consent or licence. |
| `/mortality` | Deaths by unit over the last 30 days, as fish and as a share of stock, with the main cause. |
| `/events` | Every mortality event: who had to hear, by when, when they did, and whether it is closed. |
| `/growth` | Growth between the last two weighings and when each unit reaches harvest weight at that rate. |
| `/environment` | Oxygen and temperature over the last three days against each site's minimum. |
| `/treatments` | Treatments in the last year with the vet authorisation and the date harvest is clear from. |
| `/harvest-plan` | Units at or near harvest weight and whether a withholding period still blocks them. |
| `/harvests` | Every harvest: fish, kilograms, average weight, processor and docket. |
| `/fcr` | Feed conversion by batch: feed eaten over the weight gained. |
| `/compliance` | Check the records against the rules in docs/compliance.md and cite the rule for every finding. |
| `/draft-event-report` | Draft the mortality report for MPI, the vet or the regulator from the records. |
| `/harvest-declaration` | Draft the traceability declaration for the processor: treatments, withholding and feed for the harvested fish. |
| `/feed-return` | Draft the feed return for a site's consent: tonnes of feed by month against the yearly limit. |
| `/weekly-review` | Draft the Monday farm review from attention, the harvest plan and deaths. |
| `/import` | Bring stock and daily records across from an Innovasea Farm360 export. Always a dry run first. |
| `/export` | Write every record to one JSON file the business keeps. |
| `/activity` | The append-only log of who changed what. |
| `/help` | Every command the CLI takes, with its flags. |
| `/customise` | Make it yours in plain words: add a field, change a threshold, rename a stage. Writes and tests the migration. |
| `/new-view` | Add a branded read-only dashboard from a question. |

Every command runs the one CLI, `npm run farm -- <command>`, with `--json` on any read. Every write needs `--actor=` and lands in an append-only activity log.

`npm run view` renders four read-only dashboards (this week, stock in the water, harvest plan, feed) and `npm run docs` renders harvest declarations, mortality event reports and site production summaries, in your brand from `brand.json`.

## Instead of Innovasea Farm360

Export a stock list and a daily log of feed and deaths, run `npm run farm -- import farm360 --stock=stock.csv --daily=daily.csv --dry-run --actor="Your name"`, fix every row it reports, then run it for real. Column names differ from farm to farm; the importer reads the common ones and Claude Code can map the rest. Full guide: [docs/replace-farm360.md](docs/replace-farm360.md). The rules it checks, with sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
fish-farm-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Fish Farm for Claude Code for your business, migrates your Innovasea Farm360 data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=farm360)
- Read more: [enterprisedna.co/omni/instead-of/farm360](https://enterprisedna.co/omni/instead-of/farm360?utm_source=github&utm_medium=readme&utm_campaign=farm360)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
