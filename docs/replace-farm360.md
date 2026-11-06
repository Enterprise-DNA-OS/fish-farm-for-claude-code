# Moving off Innovasea Farm360

Farm360 (formerly Aquanetix) holds your units, stock groups and the daily records your crews enter: feed, deaths and weights. This guide moves them into your own database in an afternoon. Nothing is written until you have seen a dry run.

## 1. Export two files

Every farm sets Farm360 up differently, so the column names in your export will not match anyone else's exactly. You need two spreadsheets, saved as CSV:

- **A stock list:** one row per unit with fish in it today. Columns: site, unit (pen, cage or tank), group or batch, species, fish count, average weight in grams, stocking date.
- **A daily log:** one row per unit per day. Columns: date, site, unit, feed in kilograms, feed type, deaths, cause of death.

If Farm360 will not give you one of these as a report, ask your Innovasea contact for the data export under your agreement, or ask Claude Code to reshape whatever file you do get. See `fixtures/farm360-stock.csv` and `fixtures/farm360-daily.csv` for the shape.

## 2. Add your sites and units

The importer matches units by code or by site and unit name. Add your sites and units first (ask Claude Code: "add Blackwood Reach with pens 1 to 5, 12,000 cubic metres each"). It writes the rows and shows them back to you.

## 3. Dry run

```bash
npm run farm -- import farm360 --stock=stock.csv --daily=daily.csv --dry-run --actor="Your name"
```

You get the row counts, any feed types it has not seen before, and a list of every row it cannot read, with the reason (an unknown unit, a date it cannot read, feed with no feed type). Fix the file and run it again until the problem list is empty.

## 4. Import

Run the same command without `--dry-run`. It runs in one transaction: either everything goes in or nothing does. The same files never import twice.

## What maps

| Farm360 | Here |
|---|---|
| Site, pen, cage, tank | `sites`, `units` |
| Group, batch, year class | `batches` |
| Fish in a unit today | `holdings` (count and average weight from the stock list) |
| Daily feed | `feed_records` (a new feed type is added to `feeds`) |
| Daily deaths and cause | `mortalities` (causes such as "seal" or "bloom" are mapped to predator and algal bloom) |

## What does not carry over

- **Counts are not rebuilt from history.** Today's count comes from the stock list; the daily log is history. A daily row from before a unit was stocked is skipped and listed.
- **Weighings, treatments, harvests and water readings.** Add these with `/sample`, `/treat`, `/harvest` and `/reading`, or ask Claude Code to map another export file to them.
- **Sensor feeds and camera links.** Live sensor data stays with your sensor supplier. If you want daily oxygen and temperature pulled in automatically, that is a connection Enterprise DNA builds.
- **Forecasts and budgets.** Farm360's production planning models are not copied. `/growth` gives the growth rate and the date each unit reaches harvest weight from your own weighings.
