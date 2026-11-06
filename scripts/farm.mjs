#!/usr/bin/env node
// The one CLI for Fish Farm for Claude Code.
//
//   npm run farm -- help
//   npm run farm -- attention              # what needs a person this week
//   npm run farm -- unit BLR-P05           # one pen or tank, everything about it
//   npm run farm -- harvest-plan --json    # machine output for any read
//
// Every write needs --actor=<who is doing it> and lands in the append-only activity log.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table as textTable, heading, truncate } from './lib/format.mjs';

// ------------------------------------------------------------------ reads

export const reads = {
  sites: {
    about: 'Every site: kind, regulator, consent, units stocked, fish and biomass in the water, feed against the cap.',
    sql: `select s.code, s.name, s.kind, s.region, s.regulator, s.consent_ref,
            (select count(*) from holding_now n where n.site = s.code)::int as units_stocked,
            (select coalesce(sum(n.count), 0) from holding_now n where n.site = s.code)::int as fish,
            (select round(coalesce(sum(n.biomass_kg), 0) / 1000.0, 1) from holding_now n where n.site = s.code)::float as biomass_t,
            f.feed_t_365d::float as feed_t_365d, s.feed_cap_t::float as feed_cap_t
          from sites s join site_feed f on f.site = s.code where s.active order by s.code`,
  },
  units: {
    about: 'Every stocked pen and tank: batch, fish, average weight, biomass, density against its limit, last fed.',
    sql: `select site, unit, batch, species, count as fish, round(avg_g)::int as avg_g, weighed_on, biomass_kg::float as biomass_kg,
            density_kg_m3::float as density, max_density_kg_m3::float as max_density, last_fed, withhold_until
          from holding_now order by site, unit`,
  },
  batches: {
    about: 'Every batch (year class): species, fish in the water, harvested, deaths, feed and feed conversion.',
    sql: `select f.batch, f.species, b.target_weight_g::int as target_g,
            (select coalesce(sum(n.count), 0) from holding_now n where n.batch = f.batch)::int as fish_now,
            f.in_water_kg::float as in_water_kg, f.harvested_kg::float as harvested_kg, f.deaths, f.feed_kg::float as feed_kg, f.fcr::float as fcr
          from batch_fcr f join batches b on b.code = f.batch order by f.batch`,
  },
  feed: {
    about: 'Feed by unit: yesterday, the 7-day average, and the feeding rate as a share of biomass.',
    sql: `select n.site, n.unit, n.batch,
            coalesce((select sum(kg) from feed_records r where r.holding_id = n.holding_id and r.fed_on = current_date - 1), 0)::float as kg_yesterday,
            round(coalesce((select sum(kg) from feed_records r where r.holding_id = n.holding_id and r.fed_on > current_date - 8), 0) / 7.0)::float as kg_day_7d,
            case when n.biomass_kg > 0 then round(100.0 * coalesce((select sum(kg) from feed_records r where r.holding_id = n.holding_id and r.fed_on > current_date - 8), 0) / 7.0 / n.biomass_kg, 2) end::float as pct_bw_day,
            n.last_fed
          from holding_now n order by n.site, n.unit`,
  },
  'feed-stock': {
    about: 'Feed on hand by type, daily use over the last 14 days, and days left before the next order is needed.',
    sql: `select code, name, supplier, on_hand_kg::float as on_hand_kg, daily_kg_14d::float as daily_kg, days_left, reorder_days from feed_stock order by days_left nulls last, code`,
  },
  'feed-cap': {
    about: 'Feed used at each site over the last 365 days against the yearly cap in its consent or licence.',
    sql: `select site, name, feed_t_365d::float as feed_t_365d, feed_t_30d::float as feed_t_30d, feed_cap_t::float as cap_t, pct_of_cap::float as pct_of_cap
          from site_feed order by pct_of_cap desc nulls last, site`,
  },
  mortality: {
    about: 'Deaths by unit over the last 30 days: fish, share of stock, and the main recorded cause.',
    sql: `select n.site, n.unit, n.batch, coalesce(m.fish, 0)::int as deaths_30d,
            case when n.count + coalesce(m.fish, 0) > 0 then round(100.0 * coalesce(m.fish, 0) / (n.count + coalesce(m.fish, 0)), 2) end::float as pct_30d,
            m.top_cause, m.last_death
          from holding_now n
          left join lateral (select sum(x.count) as fish, max(x.found_on) as last_death,
              (select y.cause from mortalities y where y.holding_id = n.holding_id and y.found_on > current_date - 30 group by y.cause order by sum(y.count) desc limit 1) as top_cause
            from mortalities x where x.holding_id = n.holding_id and x.found_on > current_date - 30) m on true
          order by pct_30d desc nulls last, n.site, n.unit`,
  },
  events: {
    about: 'Mortality events: how many fish, who had to hear and by when, when they did, and whether it is closed.',
    sql: `select code, site, unit, batch, found_on, count as fish, pct::float as pct, notify_by, notified_on, notified_to, reference, cause, status, days_open
          from mortality_register order by found_on desc, code`,
  },
  growth: {
    about: 'Growth between the last two weighings: specific growth rate and, at that rate, when each unit reaches harvest weight.',
    sql: `select n.site, n.unit, n.batch, s1.sampled_on as prev_on, round(s1.avg_weight_g)::int as prev_g, s2.sampled_on as last_on, round(s2.avg_weight_g)::int as last_g,
            case when s1.id is not null and s2.sampled_on > s1.sampled_on then round((100 * (ln(s2.avg_weight_g) - ln(s1.avg_weight_g)) / (s2.sampled_on - s1.sampled_on))::numeric, 2) end::float as sgr_pct_day,
            case when s2.avg_weight_g >= n.target_weight_g then 'at target'
                 when s1.id is not null and s2.avg_weight_g > s1.avg_weight_g and s2.sampled_on > s1.sampled_on
                 then (s2.sampled_on + ceil((ln(n.target_weight_g) - ln(s2.avg_weight_g)) / ((ln(s2.avg_weight_g) - ln(s1.avg_weight_g)) / (s2.sampled_on - s1.sampled_on)))::int)::text end as target_on
          from holding_now n
          left join lateral (select * from samples s where s.holding_id = n.holding_id order by sampled_on desc limit 1) s2 on true
          left join lateral (select * from samples s where s.holding_id = n.holding_id order by sampled_on desc offset 1 limit 1) s1 on true
          order by n.site, n.unit`,
  },
  environment: {
    about: 'Water temperature and dissolved oxygen over the last three days, against each site\'s oxygen minimum.',
    sql: `select s.code as site, coalesce(u.code, 'site') as unit, r.taken_on, r.parameter, r.value::float as value, r.unit as measure,
            case when r.parameter = 'DO' and s.min_do_mg_l is not null and r.value < s.min_do_mg_l then 'LOW' else '' end as flag
          from env_readings r join sites s on s.id = r.site_id left join units u on u.id = r.unit_id
          where r.taken_on >= current_date - 3 order by r.taken_on desc, s.code, r.parameter, coalesce(u.code, '')`,
  },
  treatments: {
    about: 'Treatments in the last year: product, reason, who authorised it, and the date fish can be harvested again.',
    sql: `select t.code, s.code as site, u.code as unit, b.code as batch, t.started_on, t.ended_on, t.product, t.reason, t.withholding_days,
            coalesce(t.ended_on, t.started_on) + t.withholding_days as harvest_from, coalesce(t.authorisation_ref, 'NONE') as authorisation
          from treatments t join holdings h on h.id = t.holding_id join units u on u.id = h.unit_id join sites s on s.id = u.site_id join batches b on b.id = h.batch_id
          where t.started_on >= current_date - 365 order by t.started_on desc`,
  },
  'harvest-plan': {
    about: 'Units at or near harvest weight, the biomass in each, and whether a withholding period still blocks harvest.',
    sql: `select site, unit, batch, count as fish, round(avg_g)::int as avg_g, target_weight_g::int as target_g, biomass_kg::float as biomass_kg,
            case when withhold_until >= current_date then 'withholding until ' || withhold_until
                 when avg_g >= target_weight_g then 'ready' else 'growing' end as status
          from holding_now where avg_g >= target_weight_g * 0.9 order by (withhold_until >= current_date) nulls first, avg_g desc`,
  },
  harvests: {
    about: 'Every harvest: unit, batch, fish, kilograms, average weight, processor and docket.',
    sql: `select x.code, s.code as site, u.code as unit, b.code as batch, x.harvested_on, x.count as fish, x.total_kg::float as total_kg,
            round(1000.0 * x.total_kg / x.count)::int as avg_g, x.processor, x.docket
          from harvests x join holdings h on h.id = x.holding_id join units u on u.id = h.unit_id join sites s on s.id = u.site_id join batches b on b.id = h.batch_id
          order by x.harvested_on desc, x.code`,
  },
  fcr: {
    about: 'Feed conversion by batch: feed eaten over weight gained, counting fish in the water and fish harvested.',
    sql: `select batch, species, stocked_kg::float as stocked_kg, in_water_kg::float as in_water_kg, harvested_kg::float as harvested_kg, feed_kg::float as feed_kg, fcr::float as fcr
          from batch_fcr order by batch`,
  },
  attention: {
    about: 'What needs a person this week: unreported deaths, feed caps, density, oxygen, missing records, low feed, plans.',
    sql: `select severity, coalesce(site, '') as site, item, rule, detail, days from site_attention order by severity, days desc nulls last, site, item`,
  },
  compliance: {
    about: 'Check the records against the rules in docs/compliance.md.',
    sql: null,
  },
  activity: {
    about: 'The append-only log of who changed what.',
    sql: `select created_at, actor, command, record_id, detail from activity order by id`,
  },
};

// Each rule matches a row in docs/compliance.md.
export const complianceRules = [
  { rule: 'MORTALITY-REPORT', sql: `select code, count || ' fish (' || pct || '%) in ' || unit || ' on ' || found_on || '; ' || coalesce(notify_to, 'the regulator') ||
        case when notified_on is null then ' to hear by ' || notify_by || ', not told yet' else ' told ' || days_to_notify || ' days after, window ' || notify_within_days || ' days' end as finding
      from mortality_register where (notified_on is null and status = 'open' and notify_by < current_date) or days_to_notify > notify_within_days` },
  { rule: 'FEED-CAP', sql: `select site as code, feed_t_365d || ' t in the last 365 days against a consented ' || feed_cap_t || ' t a year' as finding from site_feed where pct_of_cap > 100` },
  { rule: 'DENSITY', sql: `select unit as code, density_kg_m3 || ' kg/m3 against a limit of ' || max_density_kg_m3 as finding from holding_now where density_kg_m3 > max_density_kg_m3` },
  { rule: 'LOW-OXYGEN', sql: `select coalesce(u.code, s.code) || ' ' || r.taken_on as code, 'dissolved oxygen ' || r.value || ' mg/L below the site minimum of ' || s.min_do_mg_l as finding
      from env_readings r join sites s on s.id = r.site_id left join units u on u.id = r.unit_id where r.parameter = 'DO' and r.value < s.min_do_mg_l and r.taken_on >= current_date - 7` },
  { rule: 'WITHHOLDING', sql: `select x.code, 'harvested ' || x.harvested_on || ' inside the withholding period of ' || t.code || ' (' || t.product || ', clear from ' || (coalesce(t.ended_on, t.started_on) + t.withholding_days) || ')' as finding
      from harvests x join treatments t on t.holding_id = x.holding_id where x.harvested_on >= t.started_on and x.harvested_on < coalesce(t.ended_on, t.started_on) + t.withholding_days` },
  { rule: 'VET-AUTHORISATION', sql: `select code, product || ' started ' || started_on || ' with no veterinary authorisation recorded' as finding from treatments where authorisation_ref is null and started_on >= current_date - 365` },
  { rule: 'DAILY-RECORDS', sql: `select unit as code, 'stocked, last feed recorded ' || coalesce(last_fed::text, 'never') as finding from holding_now where days_since_fed >= 2` },
  { rule: 'BIOSECURITY-PLAN', sql: `select code, name || ' biosecurity plan last reviewed ' || coalesce(biosecurity_plan_reviewed_on::text, 'never') as finding
      from sites where active and (biosecurity_plan_reviewed_on is null or biosecurity_plan_reviewed_on < current_date - 365)` },
];

// ------------------------------------------------------------------ usage

export const usage = {
  ...Object.fromEntries(Object.keys(reads).map((k) => [k, ''])),
  unit: '<unit code or name words>',
  batch: '<batch code or name words>',
  event: '<mortality event code>',
  'log-feed': '--unit= --kg= [--feed=<feed code>] [--on=YYYY-MM-DD] --actor=',
  mort: '--unit= --count= [--cause=unknown|predator|disease|handling|algal_bloom|low_oxygen|temperature|other] [--note=] [--on=YYYY-MM-DD] --actor=',
  sample: '--unit= --fish= --avg= [--on=YYYY-MM-DD] [--note=] --actor=',
  reading: '--site= [--unit=] --parameter=DO|TEMP|SAL --value= [--on=YYYY-MM-DD] --actor=',
  treat: '--unit= --product= --reason= --withholding=<days> [--authorised-by=] [--ref=] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--code=] --actor=',
  stock: '--unit= --batch= --count= --avg= [--on=YYYY-MM-DD] --actor=',
  'add-batch': '--code= --name= --species= [--origin=] [--target=<grams>] --actor=',
  move: '--from= --to= --count= [--avg=] [--on=YYYY-MM-DD] --actor=',
  harvest: '--unit= --count= --kg= --processor= [--docket=] [--on=YYYY-MM-DD] [--code=] --actor=',
  deliver: '--feed= --kg= [--lot=] [--docket=] [--on=YYYY-MM-DD] --actor=',
  notify: '<event> --to= --reference= [--on=YYYY-MM-DD] --actor=',
  'close-event': '<event> --cause= --note= [--on=YYYY-MM-DD] --actor=',
  'review-plan': '<site> [--on=YYYY-MM-DD] --actor=',
  import: 'farm360 [--stock=stock.csv] [--daily=daily.csv] [--dry-run] --actor=',
  export: '--out=<new-file.json>',
  'draft-event-report': '<event>',
  'harvest-declaration': '<harvest>',
  'feed-return': '<site> [--months=12]',
  'weekly-review': '',
  help: '',
};

const mutating = new Set(['log-feed', 'mort', 'sample', 'reading', 'treat', 'stock', 'add-batch', 'move', 'harvest', 'deliver', 'notify', 'close-event', 'review-plan', 'import']);
const CAUSES = ['unknown', 'predator', 'disease', 'handling', 'algal_bloom', 'low_oxygen', 'temperature', 'other'];
const PARAMS = { DO: 'mg/L', TEMP: 'C', SAL: 'ppt' };
const TABLES = ['sites', 'units', 'batches', 'holdings', 'feeds', 'feed_deliveries', 'feed_records', 'mortalities', 'samples', 'env_readings',
  'treatments', 'movements', 'harvests', 'mortality_events', 'imports', 'activity'];

const today = () => new Date().toISOString().slice(0, 10);
function need(v, label) {
  if (typeof v !== 'string' || !v.trim()) throw Error(`--${label} is required`);
  return v.trim();
}
function date(v, label, { past = false } = {}) {
  v = need(v, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw Error(`--${label} needs a real YYYY-MM-DD date`);
  if (past && v > today()) throw Error(`--${label} cannot be in the future`);
  return v;
}
const dayOr = (v, label) => (v === undefined ? today() : date(v, label, { past: true }));
function one(v, values, label) {
  if (!values.includes(v)) throw Error(`--${label} must be one of ${values.join(', ')}`);
  return v;
}
function num(v, label, { min = 0, gt = false } = {}) {
  const n = Number(need(v, label));
  if (!Number.isFinite(n) || n < min || (gt && n <= min)) throw Error(`--${label} must be a number ${gt ? `above ${min}` : `of ${min} or more`}`);
  return n;
}
function int(v, label, lo = 1, hi = 10_000_000) {
  const n = Number(need(v, label));
  if (!Number.isInteger(n) || n < lo || n > hi) throw Error(`--${label} must be a whole number from ${lo} to ${hi}`);
  return n;
}

function parse(args) {
  const pos = [];
  const f = {};
  for (const arg of args) {
    if (!arg.startsWith('--')) { pos.push(arg); continue; }
    const [key, ...rest] = arg.slice(2).split('=');
    if (Object.hasOwn(f, key)) throw Error(`Duplicate flag --${key}`);
    f[key] = rest.length ? rest.join('=') : true;
  }
  let cmd = pos.shift() || 'help';
  if (!Object.hasOwn(usage, cmd)) throw Error(`Unknown command "${cmd}". Run: npm run farm -- help`);
  const allowed = new Set(['json', ...[...usage[cmd].matchAll(/--([a-z-]+)/g)].map((m) => m[1])]);
  for (const k of Object.keys(f)) if (!allowed.has(k)) throw Error(`Unknown flag --${k} for ${cmd}. Usage: ${cmd} ${usage[cmd]}`);
  if (f.json !== undefined && f.json !== true) throw Error('--json is a boolean flag');
  if (f['dry-run'] !== undefined && f['dry-run'] !== true) throw Error('--dry-run is a boolean flag');
  if (Object.hasOwn(reads, cmd) && pos.length) throw Error(`Usage: ${cmd} takes no arguments`);
  return { cmd, pos, f };
}

async function log(db, actor, command, recordId, detail) {
  await db.query('insert into activity (actor, command, record_id, detail) values ($1,$2,$3,$4)', [actor, command, recordId, detail]);
}

// Match by code (case-insensitive, prefix) or by words in the name. Ambiguous -> list and fail.
async function findOne(db, table, q, label, nameCol = 'name') {
  q = need(q, label);
  const exact = await db.query(`select * from ${table} where lower(code) = lower($1)`, [q]);
  if (exact.length === 1) return exact[0];
  const rows = await db.query(`select * from ${table} where lower(code) like lower($1) || '%' or lower(${nameCol}) like '%' || lower($1) || '%' order by code`, [q]);
  if (!rows.length) throw Error(`No matching ${label} for "${q}"`);
  if (rows.length > 1) throw Error(`Ambiguous: "${q}" matches ${rows.map((r) => `${r.code} (${truncate(r[nameCol], 40)})`).join('; ')}`);
  return rows[0];
}
const findSite = (db, q) => findOne(db, 'sites', q, 'site');
const findBatch = (db, q) => findOne(db, 'batches', q, 'batch');
const findFeed = (db, q) => findOne(db, 'feeds', q, 'feed');
const findEvent = (db, q) => findOne(db, 'mortality_events', q, 'mortality event', 'code');
const findHarvest = (db, q) => findOne(db, 'harvests', q, 'harvest', 'docket');
// A unit by its code (BLR-P05), or by words from its site and name ("blackwood pen 5").
async function findUnit(db, q) {
  q = need(q, 'unit');
  const all = await db.query(`select u.*, lower(s.code || ' ' || s.name || ' ' || u.code || ' ' || u.name) as label from units u join sites s on s.id = u.site_id order by u.code`);
  const exact = all.filter((u) => u.code.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  const words = q.toLowerCase().split(/\s+/);
  const rows = all.filter((u) => u.code.toLowerCase().startsWith(q.toLowerCase()) || words.every((w) => u.label.split(/[\s-]+/).some((t) => t === w || (w.length > 2 && t.startsWith(w)))));
  if (!rows.length) throw Error(`No matching unit for "${q}"`);
  if (rows.length > 1) throw Error(`Ambiguous: "${q}" matches ${rows.map((r) => r.code).join(', ')}`);
  return rows[0];
}
async function openHolding(db, unit, { required = true } = {}) {
  const h = (await db.query('select h.*, b.code as batch from holdings h join batches b on b.id = h.batch_id where h.unit_id = $1 and h.closed_on is null', [unit.id]))[0];
  if (!h && required) throw Error(`${unit.code} is empty: nothing is stocked there`);
  return h || null;
}
async function nextCode(db, table, prefix, width) {
  const rows = await db.query(`select code from ${table} where code like $1`, [`${prefix}%`]);
  const n = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(prefix.length)) || 0), 0) + 1;
  return prefix + String(n).padStart(width, '0');
}

// ------------------------------------------------------------------ detail

async function unitDetail(db, q) {
  const u = await findUnit(db, q);
  const now = (await db.query('select * from holding_now where unit = $1', [u.code]))[0];
  const h = now?.holding_id;
  const head = { code: u.code, name: u.name, kind: u.kind, volume_m3: Number(u.volume_m3) };
  if (now) Object.assign(head, { batch: now.batch, species: now.species, fish: now.count, avg_g: Math.round(Number(now.avg_g)), biomass_kg: Number(now.biomass_kg),
    density_kg_m3: Number(now.density_kg_m3), max_density_kg_m3: now.max_density_kg_m3 === null ? null : Number(now.max_density_kg_m3), last_fed: now.last_fed, withhold_until: now.withhold_until });
  else head.status = 'empty';
  return {
    unit: head,
    attention: await db.query('select severity, rule, detail, days from site_attention where item = $1 or item like $1 || \' %\' or detail like \'% \' || $1 || \' %\' order by severity', [u.code]),
    feed_14d: h ? await db.query(`select r.fed_on, f.code as feed, r.kg::float as kg, r.recorded_by from feed_records r join feeds f on f.id = r.feed_id where r.holding_id = $1 and r.fed_on > current_date - 14 order by r.fed_on desc`, [h]) : [],
    deaths: h ? await db.query(`select found_on, count, cause, note from mortalities where holding_id = $1 order by found_on desc limit 10`, [h]) : [],
    weights: h ? await db.query(`select sampled_on, fish_count, avg_weight_g::float as avg_g from samples where holding_id = $1 order by sampled_on desc`, [h]) : [],
    treatments: h ? await db.query(`select code, started_on, product, withholding_days, coalesce(ended_on, started_on) + withholding_days as harvest_from, authorisation_ref from treatments where holding_id = $1 order by started_on desc`, [h]) : [],
  };
}

async function batchDetail(db, q) {
  const b = await findBatch(db, q);
  const fcr = (await db.query('select * from batch_fcr where batch = $1', [b.code]))[0];
  return {
    batch: { code: b.code, name: b.name, species: b.species, origin: b.origin, hatched_on: b.hatched_on, target_weight_g: Number(b.target_weight_g),
      stocked_kg: Number(fcr.stocked_kg), in_water_kg: Number(fcr.in_water_kg), harvested_kg: Number(fcr.harvested_kg), deaths: fcr.deaths, feed_kg: Number(fcr.feed_kg), fcr: fcr.fcr === null ? null : Number(fcr.fcr) },
    units: await db.query(`select site, unit, count as fish, round(avg_g)::int as avg_g, biomass_kg::float as biomass_kg, withhold_until from holding_now where batch = $1 order by unit`, [b.code]),
    history: await db.query(`select u.code as unit, h.opened_on, h.source, h.start_count, h.closed_on, h.closed_reason from holdings h join units u on u.id = h.unit_id where h.batch_id = $1 order by h.opened_on, u.code`, [b.id]),
    harvests: await db.query(`select x.code, u.code as unit, x.harvested_on, x.count, x.total_kg::float as total_kg, x.docket from harvests x join holdings h on h.id = x.holding_id join units u on u.id = h.unit_id where h.batch_id = $1 order by x.harvested_on`, [b.id]),
    treatments: await db.query(`select t.code, u.code as unit, t.started_on, t.product, t.authorisation_ref from treatments t join holdings h on h.id = t.holding_id join units u on u.id = h.unit_id where h.batch_id = $1 order by t.started_on`, [b.id]),
  };
}

async function eventDetail(db, q) {
  const e = await findEvent(db, q);
  const reg = (await db.query('select * from mortality_register where id = $1', [e.id]))[0];
  delete reg.id;
  return {
    event: { ...reg, pct: Number(reg.pct), closeout_note: e.closeout_note },
    deaths_14d: await db.query(`select found_on, count, cause, note from mortalities where holding_id = $1 and found_on between $2::date - 14 and $2::date + 14 order by found_on`, [e.holding_id, e.found_on]),
    oxygen: await db.query(`select r.taken_on, coalesce(u.code, '') as unit, r.value::float as do_mg_l from env_readings r join units uu on uu.id = (select unit_id from holdings where id = $1)
        left join units u on u.id = r.unit_id where r.site_id = uu.site_id and r.parameter = 'DO' and r.taken_on between $2::date - 3 and $2::date order by r.taken_on`, [e.holding_id, e.found_on]),
    activity: await db.query('select created_at, actor, command, detail from activity where record_id = $1 order by id', [e.code]),
  };
}

// ------------------------------------------------------------------ writes

async function logFeed(db, f, actor) {
  const u = await findUnit(db, f.unit);
  const h = await openHolding(db, u);
  const on = dayOr(f.on, 'on');
  let feed;
  if (f.feed) feed = await findFeed(db, f.feed);
  else {
    feed = (await db.query('select f.* from feed_records r join feeds f on f.id = r.feed_id where r.holding_id = $1 order by r.fed_on desc limit 1', [h.id]))[0];
    if (!feed) throw Error(`--feed is required: ${u.code} has no feed recorded yet`);
  }
  const kg = num(f.kg, 'kg');
  const dup = await db.query('select 1 from feed_records where holding_id = $1 and fed_on = $2 and feed_id = $3', [h.id, on, feed.id]);
  if (dup.length) throw Error(`${u.code} already has ${feed.code} recorded on ${on}. Records are never changed: add a correction note to the unit instead.`);
  await db.query('insert into feed_records (holding_id, fed_on, feed_id, kg, recorded_by) values ($1,$2,$3,$4,$5)', [h.id, on, feed.id, kg, actor]);
  await log(db, actor, 'log-feed', u.code, `${kg} kg ${feed.code} on ${on}`);
  const left = (await db.query('select on_hand_kg::float as on_hand, days_left from feed_stock where code = $1', [feed.code]))[0];
  return { unit: u.code, fed_on: on, feed: feed.code, kg, feed_on_hand_kg: left.on_hand, days_of_feed_left: left.days_left };
}

// A day's deaths over the site's threshold open a mortality event in the same step,
// so a mass mortality can never sit in the daily log with nobody owning it.
async function mort(db, f, actor) {
  const u = await findUnit(db, f.unit);
  const h = await openHolding(db, u);
  const count = int(f.count, 'count');
  if (count > h.count) throw Error(`${u.code} holds ${h.count} fish; --count ${count} is more than that`);
  const cause = one(f.cause || 'unknown', CAUSES, 'cause');
  const on = dayOr(f.on, 'on');
  const site = (await db.query('select * from sites where id = $1', [u.site_id]))[0];
  await db.exec('BEGIN');
  try {
    await db.query('insert into mortalities (holding_id, found_on, count, cause, note, recorded_by) values ($1,$2,$3,$4,$5,$6)', [h.id, on, count, cause, f.note || null, actor]);
    await db.query('update holdings set count = count - $2 where id = $1', [h.id, count]);
    const day = (await db.query('select coalesce(sum(count), 0)::int as n from mortalities where holding_id = $1 and found_on = $2', [h.id, on]))[0].n;
    const pct = Math.round((1000 * day) / (h.count - count + day)) / 10;
    let event = null;
    if (pct > Number(site.mass_mortality_pct)) {
      const open = (await db.query('select code from mortality_events where holding_id = $1 and found_on = $2', [h.id, on]))[0];
      if (open) {
        event = open.code;
        await db.query('update mortality_events set count = $2, pct = $3 where code = $1', [event, day, pct]);
      } else {
        event = await nextCode(db, 'mortality_events', 'ME-', 4);
        await db.query('insert into mortality_events (code, holding_id, found_on, count, pct) values ($1,$2,$3,$4,$5)', [event, h.id, on, day, pct]);
        await log(db, actor, 'mortality-event', event, `opened automatically: ${day} fish (${pct}%) in ${u.code} on ${on}`);
      }
    }
    await log(db, actor, 'mort', u.code, `${count} dead (${cause}) on ${on}`);
    await db.exec('COMMIT');
    const out = { unit: u.code, found_on: on, deaths: count, cause, fish_left: h.count - count, day_pct: pct };
    if (event) {
      const r = (await db.query('select notify_to, notify_by from mortality_register where code = $1', [event]))[0];
      Object.assign(out, { event_opened: event, next: `Tell ${r.notify_to || site.regulator} by ${r.notify_by} (then: notify ${event}), keep samples for the lab, and record the cause when it is known.` });
    }
    return out;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

async function sample(db, f, actor) {
  const u = await findUnit(db, f.unit);
  const h = await openHolding(db, u);
  const on = dayOr(f.on, 'on');
  const fish = int(f.fish, 'fish', 1, 10000);
  const avg = num(f.avg, 'avg', { gt: true });
  await db.query('insert into samples (holding_id, sampled_on, fish_count, avg_weight_g, note) values ($1,$2,$3,$4,$5)', [h.id, on, fish, avg, f.note || null]);
  await log(db, actor, 'sample', u.code, `${fish} fish weighed, average ${avg} g on ${on}`);
  const now = (await db.query('select biomass_kg::float as biomass_kg, density_kg_m3::float as density, max_density_kg_m3::float as max_density from holding_now where holding_id = $1', [h.id]))[0];
  return { unit: u.code, sampled_on: on, avg_g: avg, biomass_kg: now.biomass_kg, density_kg_m3: now.density,
    ...(now.max_density !== null && now.density > now.max_density ? { warning: `density is over the limit of ${now.max_density} kg/m3: plan a split or a harvest` } : {}) };
}

async function reading(db, f, actor) {
  const s = await findSite(db, f.site);
  const u = f.unit ? await findUnit(db, f.unit) : null;
  if (u && u.site_id !== s.id) throw Error(`${u.code} is not at ${s.code}`);
  const parameter = one(String(f.parameter || '').toUpperCase(), Object.keys(PARAMS), 'parameter');
  const value = num(f.value, 'value', { min: -5 });
  const on = dayOr(f.on, 'on');
  await db.query('insert into env_readings (site_id, unit_id, taken_on, parameter, value, unit) values ($1,$2,$3,$4,$5,$6)', [s.id, u?.id || null, on, parameter, value, PARAMS[parameter]]);
  await log(db, actor, 'reading', u?.code || s.code, `${parameter} ${value} ${PARAMS[parameter]} on ${on}`);
  const low = parameter === 'DO' && s.min_do_mg_l !== null && value < Number(s.min_do_mg_l);
  return { site: s.code, unit: u?.code || '', parameter, value, unit_of_measure: PARAMS[parameter], taken_on: on,
    ...(low ? { warning: `below the site minimum of ${Number(s.min_do_mg_l)} mg/L: stop or cut feeding and check the fish` } : {}) };
}

async function treat(db, f, actor) {
  const u = await findUnit(db, f.unit);
  const h = await openHolding(db, u);
  const start = f.start ? date(f.start, 'start', { past: true }) : today();
  const end = f.end ? date(f.end, 'end') : null;
  if (end && end < start) throw Error('--end is before --start');
  const wd = int(f.withholding, 'withholding', 0, 1000);
  if ((f['authorised-by'] === undefined) !== (f.ref === undefined)) throw Error('Give both --authorised-by and --ref, or neither');
  const code = f.code ? need(f.code, 'code').toUpperCase() : await nextCode(db, 'treatments', 'TR-', 3);
  await db.query(`insert into treatments (code, holding_id, started_on, ended_on, product, reason, withholding_days, authorised_by, authorisation_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [code, h.id, start, end, need(f.product, 'product'), need(f.reason, 'reason'), wd, f['authorised-by'] || null, f.ref || null]);
  await log(db, actor, 'treat', code, `${f.product} on ${u.code} from ${start}, withholding ${wd} days`);
  const clear = new Date(Date.parse(`${end || start}T00:00:00Z`) + wd * 86400000).toISOString().slice(0, 10);
  return { treatment: code, unit: u.code, product: f.product, harvest_from: clear, ...(f.ref ? {} : { warning: 'no veterinary authorisation recorded; add it before the course starts if the product needs one' }) };
}

async function addBatch(db, f, actor) {
  const code = need(f.code, 'code').toUpperCase();
  if ((await db.query('select 1 from batches where code = $1', [code])).length) throw Error(`Batch ${code} already exists`);
  await db.query('insert into batches (code, name, species, origin, target_weight_g) values ($1,$2,$3,$4,$5)',
    [code, need(f.name, 'name'), need(f.species, 'species'), f.origin || null, f.target === undefined ? null : num(f.target, 'target', { gt: true })]);
  await log(db, actor, 'add-batch', code, `${f.species}: ${f.name}`);
  return { batch: code, species: f.species, next: `Stock it: npm run farm -- stock --unit=<unit> --batch=${code} --count= --avg= --actor=` };
}

async function stock(db, f, actor) {
  const u = await findUnit(db, f.unit);
  if (await openHolding(db, u, { required: false })) throw Error(`${u.code} already holds fish: use move to add fish of the same batch`);
  const b = await findBatch(db, f.batch);
  const count = int(f.count, 'count');
  const avg = num(f.avg, 'avg', { gt: true });
  const on = dayOr(f.on, 'on');
  await db.query(`insert into holdings (unit_id, batch_id, opened_on, source, start_count, start_avg_g, count) values ($1,$2,$3,'stocked',$4,$5,$4)`, [u.id, b.id, on, count, avg]);
  await log(db, actor, 'stock', u.code, `${count} ${b.code} at ${avg} g on ${on}`);
  const now = (await db.query('select biomass_kg::float as biomass_kg, density_kg_m3::float as density from holding_now where unit = $1', [u.code]))[0];
  return { unit: u.code, batch: b.code, fish: count, biomass_kg: now.biomass_kg, density_kg_m3: now.density };
}

// Moving fish keeps the batch: the destination is empty or holds the same batch.
async function move(db, f, actor) {
  const from = await findUnit(db, f.from);
  const to = await findUnit(db, f.to);
  if (from.id === to.id) throw Error('--from and --to are the same unit');
  const src = await openHolding(db, from);
  const count = int(f.count, 'count');
  if (count > src.count) throw Error(`${from.code} holds ${src.count} fish; cannot move ${count}`);
  const dst = await openHolding(db, to, { required: false });
  if (dst && dst.batch_id !== src.batch_id) throw Error(`${to.code} holds ${dst.batch}, not ${src.batch}: batches are never mixed in one unit`);
  const on = dayOr(f.on, 'on');
  const avgNow = (await db.query('select avg_g from holding_now where holding_id = $1', [src.id]))[0].avg_g;
  const avg = f.avg === undefined ? Number(avgNow) : num(f.avg, 'avg', { gt: true });
  await db.exec('BEGIN');
  try {
    let dstId = dst?.id;
    if (!dst) dstId = (await db.query(`insert into holdings (unit_id, batch_id, opened_on, source, start_count, start_avg_g, count) values ($1,$2,$3,'transfer',$4,$5,$4) returning id`, [to.id, src.batch_id, on, count, avg]))[0].id;
    else await db.query('update holdings set count = count + $2 where id = $1', [dstId, count]);
    await db.query('update holdings set count = count - $2 where id = $1', [src.id, count]);
    if (count === src.count) await db.query(`update holdings set closed_on = $2, closed_reason = 'moved' where id = $1`, [src.id, on]);
    await db.query('insert into movements (from_holding_id, to_holding_id, moved_on, count, avg_weight_g) values ($1,$2,$3,$4,$5)', [src.id, dstId, on, count, avg]);
    await log(db, actor, 'move', from.code, `${count} ${src.batch} to ${to.code} on ${on}`);
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  return { from: from.code, to: to.code, batch: src.batch, fish: count, left_in_from: src.count - count, from_closed: count === src.count };
}

async function harvest(db, f, actor) {
  const u = await findUnit(db, f.unit);
  const h = await openHolding(db, u);
  const on = dayOr(f.on, 'on');
  const blocked = (await db.query(`select code, product, coalesce(ended_on, started_on) + withholding_days as clear_on from treatments
    where holding_id = $1 and $2::date >= started_on and $2::date < coalesce(ended_on, started_on) + withholding_days order by clear_on desc`, [h.id, on]))[0];
  if (blocked) throw Error(`${u.code} is inside the withholding period of ${blocked.code} (${blocked.product}) until ${blocked.clear_on}. Nothing harvested.`);
  const count = int(f.count, 'count');
  if (count > h.count) throw Error(`${u.code} holds ${h.count} fish; cannot harvest ${count}`);
  const kg = num(f.kg, 'kg', { gt: true });
  const code = f.code ? need(f.code, 'code').toUpperCase() : await nextCode(db, 'harvests', 'HV-', 3);
  await db.exec('BEGIN');
  try {
    await db.query('insert into harvests (code, holding_id, harvested_on, count, total_kg, processor, docket) values ($1,$2,$3,$4,$5,$6,$7)',
      [code, h.id, on, count, kg, need(f.processor, 'processor'), f.docket || null]);
    await db.query('update holdings set count = count - $2 where id = $1', [h.id, count]);
    if (count === h.count) await db.query(`update holdings set closed_on = $2, closed_reason = 'harvested' where id = $1`, [h.id, on]);
    await log(db, actor, 'harvest', code, `${count} fish, ${kg} kg from ${u.code} to ${f.processor}`);
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  return { harvest: code, unit: u.code, batch: h.batch, fish: count, kg, avg_g: Math.round((1000 * kg) / count), fish_left: h.count - count,
    next: `Traceability for the processor: npm run farm -- harvest-declaration ${code}` };
}

async function deliver(db, f, actor) {
  const feed = await findFeed(db, f.feed);
  const kg = num(f.kg, 'kg', { gt: true });
  const on = dayOr(f.on, 'on');
  await db.query('insert into feed_deliveries (feed_id, received_on, kg, lot, docket) values ($1,$2,$3,$4,$5)', [feed.id, on, kg, f.lot || null, f.docket || null]);
  await log(db, actor, 'deliver', feed.code, `${kg} kg received ${on}${f.lot ? `, lot ${f.lot}` : ''}`);
  const s = (await db.query('select on_hand_kg::float as on_hand, days_left from feed_stock where code = $1', [feed.code]))[0];
  return { feed: feed.code, received_kg: kg, on_hand_kg: s.on_hand, days_left: s.days_left };
}

async function notify(db, q, f, actor) {
  const e = await findEvent(db, q);
  if (e.notified_on) throw Error(`${e.code} was reported on ${e.notified_on} (${e.reference})`);
  const on = dayOr(f.on, 'on');
  if (on < e.found_on) throw Error(`--on ${on} is before the deaths were found (${e.found_on})`);
  await db.query('update mortality_events set notified_on = $2, notified_to = $3, reference = $4 where id = $1', [e.id, on, need(f.to, 'to'), need(f.reference, 'reference')]);
  await log(db, actor, 'notify', e.code, `reported ${on} to ${f.to}, ref ${f.reference}`);
  const r = (await db.query('select days_to_notify, notify_within_days from mortality_register where code = $1', [e.code]))[0];
  return { event: e.code, notified_on: on, to: f.to, reference: f.reference, days_after_found: r.days_to_notify, late: r.days_to_notify > r.notify_within_days };
}

async function closeEvent(db, q, f, actor) {
  const e = await findEvent(db, q);
  if (e.closed_on) throw Error(`${e.code} was closed on ${e.closed_on}`);
  if (!e.notified_on) throw Error(`${e.code} cannot close: nobody has been told yet (notify ${e.code})`);
  const on = dayOr(f.on, 'on');
  await db.query('update mortality_events set cause = $2, closeout_note = $3, closed_on = $4 where id = $1', [e.id, need(f.cause, 'cause'), need(f.note, 'note'), on]);
  await log(db, actor, 'close-event', e.code, f.note);
  return { event: e.code, status: 'closed', closed_on: on };
}

async function reviewPlan(db, q, f, actor) {
  const s = await findSite(db, q);
  const on = dayOr(f.on, 'on');
  await db.query('update sites set biosecurity_plan_reviewed_on = $2 where id = $1', [s.id, on]);
  await log(db, actor, 'review-plan', s.code, `biosecurity plan reviewed ${on}`);
  return { site: s.code, biosecurity_plan_reviewed_on: on };
}

// ------------------------------------------------------------------ import

function normDate(v, label) {
  v = String(v || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return date(`${m[1]}-${m[2]}-${m[3]}`, label);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // NZ and AU exports: day first
  if (m) return date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, label);
  throw Error(`${label}: "${v}" is not a date this importer reads (use YYYY-MM-DD or DD/MM/YYYY)`);
}
const number = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw Error(`"${v}" is not a number`);
  return n;
};
const causeOf = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (/seal|bird|shark|predat/.test(s)) return 'predator';
  if (/algae|algal|bloom|plankton/.test(s)) return 'algal_bloom';
  if (/oxygen|\bdo\b/.test(s)) return 'low_oxygen';
  if (/temp|heat/.test(s)) return 'temperature';
  if (/handl|grad|transfer|net/.test(s)) return 'handling';
  if (/disease|infect|gill|rot|patholog/.test(s)) return 'disease';
  return CAUSES.includes(s) ? s : 'other';
};

// Two files from the farm's export: a stock list (what is in each unit today) and the
// daily log (feed and deaths). Counts come from the stock list; history comes from the log.
async function importFarm360(db, f, actor) {
  if (!f.stock && !f.daily) throw Error('Give --stock=<file.csv>, --daily=<file.csv> or both');
  const problems = [];
  const units = await db.query('select u.id, u.code, lower(u.name) as name, lower(s.name) as site_name, lower(s.code) as site_code from units u join sites s on s.id = u.site_id');
  const unitOf = (site, unit) => {
    const uv = String(unit || '').trim().toLowerCase();
    const sv = String(site || '').trim().toLowerCase();
    const hits = units.filter((u) => u.code.toLowerCase() === uv || (u.name === uv && (!sv || u.site_name === sv || u.site_code === sv)));
    if (hits.length !== 1) throw Error(hits.length ? `unit "${unit}" is at more than one site; give the site` : `no unit "${unit}"${site ? ` at "${site}"` : ''} (add it first)`);
    return hits[0];
  };
  const files = [];
  const stockRows = [];
  if (f.stock) {
    const text = fs.readFileSync(path.resolve(need(f.stock, 'stock')), 'utf8');
    files.push(text);
    parseCsv(text).forEach((row, n) => {
      const line = n + 2;
      try {
        const u = unitOf(pick(row, 'site', 'farm', 'location'), pick(row, 'unit', 'pen', 'cage', 'tank', 'unit name'));
        const batch = String(pick(row, 'batch', 'group', 'year class', 'stock group', 'lot')).trim().toUpperCase();
        if (!batch) throw Error('no batch or group');
        const count = number(pick(row, 'count', 'fish', 'number', 'fish count', 'current number'));
        const avg = number(pick(row, 'avg weight', 'average weight', 'avg weight (g)', 'average weight (g)', 'mean weight'));
        if (!count || !avg) throw Error('no fish count or average weight');
        stockRows.push({ u, batch, species: pick(row, 'species') || 'unknown', count: Math.round(count), avg,
          on: normDate(pick(row, 'stocked on', 'stocking date', 'date in', 'input date'), `stock row ${line} date`) || today() });
      } catch (e) { problems.push(`stock row ${line}: ${e.message}`); }
    });
  }
  const daily = [];
  if (f.daily) {
    const text = fs.readFileSync(path.resolve(need(f.daily, 'daily')), 'utf8');
    files.push(text);
    parseCsv(text).forEach((row, n) => {
      const line = n + 2;
      try {
        const u = unitOf(pick(row, 'site', 'farm', 'location'), pick(row, 'unit', 'pen', 'cage', 'tank', 'unit name'));
        const day = normDate(pick(row, 'date', 'day', 'record date'), `daily row ${line} date`);
        if (!day) throw Error('no date');
        const kg = number(pick(row, 'feed (kg)', 'feed kg', 'feed', 'feed amount', 'amount fed (kg)'));
        const feed = String(pick(row, 'feed type', 'feed name', 'product', 'diet')).trim();
        if (kg && !feed) throw Error('feed with no feed type');
        const dead = number(pick(row, 'mortality', 'mortalities', 'morts', 'dead', 'deaths'));
        daily.push({ u, day, kg, feed, dead: dead ? Math.round(dead) : 0, cause: causeOf(pick(row, 'mortality cause', 'cause', 'reason')) });
      } catch (e) { problems.push(`daily row ${line}: ${e.message}`); }
    });
  }
  const hash = createHash('sha256').update(files.join('\n--\n')).digest('hex');
  const already = (await db.query(`select created_at from imports where source = 'farm360' and file_hash = $1`, [hash]))[0];
  const feedNames = [...new Set(daily.filter((r) => r.kg).map((r) => r.feed))];
  const knownFeeds = await db.query('select id, code, lower(name) as name from feeds');
  const feedOf = (v) => knownFeeds.find((x) => x.code.toLowerCase() === v.toLowerCase() || x.name === v.toLowerCase());
  const summary = { stock_rows: stockRows.length, daily_rows: daily.length, new_feed_types: feedNames.filter((n) => !feedOf(n)),
    problems, already_imported: already ? String(already.created_at) : false, dry_run: Boolean(f['dry-run']) };
  if (problems.length || f['dry-run'] || already) {
    if (problems.length && !f['dry-run']) throw Error(`Nothing imported. Fix these first:\n  ${problems.join('\n  ')}`);
    if (already && !f['dry-run']) throw Error(`These files were imported on ${already.created_at}. Nothing imported twice.`);
    return summary;
  }
  await db.exec('BEGIN');
  try {
    let holdingsIn = 0;
    for (const r of stockRows) {
      let b = (await db.query('select id from batches where code = $1', [r.batch]))[0];
      if (!b) b = (await db.query('insert into batches (code, name, species, origin) values ($1,$1,$2,$3) returning id', [r.batch, r.species, 'imported from Farm360']))[0];
      const open = (await db.query('select id, batch_id from holdings where unit_id = $1 and closed_on is null', [r.u.id]))[0];
      if (open) {
        if (open.batch_id !== b.id) throw Error(`${r.u.code} already holds a different batch; empty it before importing ${r.batch}`);
        continue;
      }
      await db.query(`insert into holdings (unit_id, batch_id, opened_on, source, start_count, start_avg_g, count) values ($1,$2,$3,'stocked',$4,$5,$4)`, [r.u.id, b.id, r.on, r.count, r.avg]);
      holdingsIn++;
    }
    for (const n of feedNames) {
      if (feedOf(n)) continue;
      const code = n.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
      const row = (await db.query('insert into feeds (code, name) values ($1,$2) on conflict (code) do nothing returning id, code, lower(name) as name', [code, n]))[0];
      if (row) knownFeeds.push(row);
    }
    let feedIn = 0;
    let deathsIn = 0;
    const skipped = [];
    for (const r of daily) {
      const h = (await db.query('select id from holdings where unit_id = $1 and opened_on <= $2 and (closed_on is null or closed_on >= $2) order by opened_on desc limit 1', [r.u.id, r.day]))[0];
      if (!h) { skipped.push(`${r.u.code} ${r.day}: nothing stocked that day`); continue; }
      if (r.kg) {
        const ins = await db.query(`insert into feed_records (holding_id, fed_on, feed_id, kg, recorded_by) values ($1,$2,$3,$4,'import')
          on conflict (holding_id, fed_on, feed_id) do nothing returning id`, [h.id, r.day, feedOf(r.feed).id, r.kg]);
        feedIn += ins.length;
      }
      if (r.dead) {
        await db.query(`insert into mortalities (holding_id, found_on, count, cause, recorded_by) values ($1,$2,$3,$4,'import')`, [h.id, r.day, r.dead, r.cause]);
        deathsIn++;
      }
    }
    await db.query(`insert into imports (source, file_hash, rows) values ('farm360', $1, $2)`, [hash, stockRows.length + daily.length]);
    await log(db, actor, 'import', 'farm360', `${holdingsIn} units stocked, ${feedIn} feed records, ${deathsIn} death records`);
    await db.exec('COMMIT');
    return { ...summary, units_stocked: holdingsIn, feed_records: feedIn, death_records: deathsIn, skipped };
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

async function exportAll(db, f) {
  const out = path.resolve(need(f.out, 'out'));
  if (fs.existsSync(out)) throw Error(`${out} already exists; choose a new file name`);
  const data = { exported_at: new Date().toISOString() };
  for (const t of TABLES) data[t] = await db.query(`select * from ${t}`);
  fs.writeFileSync(out, JSON.stringify(data, null, 2), { mode: 0o600 });
  return { file: out, tables: Object.fromEntries(TABLES.map((t) => [t, data[t].length])) };
}

// ------------------------------------------------------------------ drafts (written to drafts/, never sent)

function draftsDir() {
  const dir = path.join(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const md = (rows) => {
  if (!rows.length) return '_None._\n';
  const cols = Object.keys(rows[0]);
  const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
  return `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n${rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`).join('\n')}\n`;
};

async function draftEventReport(db, q) {
  const d = await eventDetail(db, q);
  const e = d.event;
  const s = (await db.query('select * from sites where code = $1', [e.site]))[0];
  const unit = (await db.query('select * from holding_now where unit = $1', [e.unit]))[0];
  const body = `# Mortality report: ${e.code}, ${s.name}

To: ${e.notify_to || s.regulator}
From: ${s.operator}
Site: ${s.name} (${s.region}), consent or licence ${s.consent_ref || 'not recorded'}

| Field | Value |
|---|---|
| Unit | ${e.unit} |
| Batch | ${e.batch}${unit ? `, ${unit.species}` : ''} |
| Deaths found | ${e.found_on} |
| Fish dead that day | ${e.count} (${e.pct}% of the unit) |
| Fish remaining | ${unit ? unit.count : 'unit since emptied'} |
| To be told by | ${e.notify_by} |
| Suspected cause | ${e.cause || 'not known yet; samples sent for diagnosis'} |

## Deaths in this unit around the event
${md(d.deaths_14d)}
## Dissolved oxygen at the site in the three days before
${md(d.oxygen)}
## What we have done
[Samples taken and where they went, movements stopped, feeding changed, nets or intake checked.]

## What happens next
[Disposal of dead fish, lab results expected, who is watching the unit.]

_Draft prepared ${today()} from the farm records. Check every line before it goes. Once it has gone, record it with: npm run farm -- notify ${e.code} --to="..." --reference="..."_
`;
  const file = path.join(draftsDir(), `mortality-report-${e.code.toLowerCase()}-${today()}.md`);
  fs.writeFileSync(file, body);
  return { file, event: e.code, tell: e.notify_to || s.regulator, notify_by: e.notify_by };
}

async function harvestDeclaration(db, q) {
  const x = await findHarvest(db, q);
  const r = (await db.query(`select x.*, u.code as unit, s.name as site, s.operator, s.consent_ref, b.code as batch, b.species, b.origin, b.hatched_on, h.id as hid
    from harvests x join holdings h on h.id = x.holding_id join units u on u.id = h.unit_id join sites s on s.id = u.site_id join batches b on b.id = h.batch_id where x.id = $1`, [x.id]))[0];
  const treatments = await db.query(`select code, started_on, ended_on, product, withholding_days, coalesce(ended_on, started_on) + withholding_days as clear_on, authorisation_ref
    from treatments t where t.holding_id = $1 or t.holding_id in (select from_holding_id from movements where to_holding_id = $1) order by started_on`, [r.hid]);
  const lots = await db.query(`select f.code as feed, min(r.fed_on) as first_fed, max(r.fed_on) as last_fed, round(sum(r.kg))::int as kg,
      (select string_agg(distinct coalesce(d.lot, 'no lot'), ', ') from feed_deliveries d where d.feed_id = f.id and d.received_on <= max(r.fed_on)) as lots_received
    from feed_records r join feeds f on f.id = r.feed_id where r.holding_id = $1 group by f.id, f.code order by f.code`, [r.hid]);
  const clear = treatments.every((t) => r.harvested_on >= t.clear_on || r.harvested_on < t.started_on);
  const body = `# Harvest declaration ${r.code}

| Field | Value |
|---|---|
| Grower | ${r.operator} |
| Site and unit | ${r.site}, ${r.unit} |
| Consent or licence | ${r.consent_ref || 'not recorded'} |
| Species and batch | ${r.species}, ${r.batch} (${r.origin || 'origin not recorded'}) |
| Harvested | ${r.harvested_on} |
| Fish and weight | ${r.count} fish, ${Number(r.total_kg)} kg |
| Processor and docket | ${r.processor}, ${r.docket || 'no docket'} |
| Withholding periods | ${clear ? 'all ended before harvest' : 'NOT CLEAR: do not send'} |

## Veterinary treatments for these fish
${md(treatments)}
## Feed eaten in this unit
${md(lots)}
_Prepared ${today()} from the farm records for the processor's traceability file. Check it against your own programme before signing._
`;
  const file = path.join(draftsDir(), `harvest-declaration-${r.code.toLowerCase()}.md`);
  fs.writeFileSync(file, body);
  return { file, harvest: r.code, withholding_clear: clear };
}

async function feedReturn(db, q, f) {
  const s = await findSite(db, q);
  const months = f.months === undefined ? 12 : int(f.months, 'months', 1, 36);
  const rows = await db.query(`select to_char(date_trunc('month', r.fed_on), 'YYYY-MM') as month, round(sum(r.kg) / 1000.0, 2)::float as feed_t
    from feed_records r join holdings h on h.id = r.holding_id join units u on u.id = h.unit_id
    where u.site_id = $1 and r.fed_on >= (date_trunc('month', current_date) - make_interval(months => $2))::date and r.fed_on < date_trunc('month', current_date)::date
    group by 1 order by 1`, [s.id, months]);
  const total = Math.round(rows.reduce((n, r) => n + r.feed_t, 0) * 100) / 100;
  const sf = (await db.query('select * from site_feed where site = $1', [s.code]))[0];
  const body = `# Feed return: ${s.name}, ${s.consent_ref || 'consent not recorded'}

To: ${s.regulator}
From: ${s.operator}

Feed placed at the site by month, for the ${months} full months to the end of last month.

${md(rows)}
| Total | ${total} t |
|---|---|
| Consented limit | ${s.feed_cap_t === null ? 'none recorded' : `${Number(s.feed_cap_t)} t a year`} |
| Last 365 days | ${Number(sf.feed_t_365d)} t${sf.pct_of_cap === null ? '' : ` (${Number(sf.pct_of_cap)}% of the limit)`} |

_Draft prepared ${today()} from the daily feed records. Your consent sets the period, the form and the date of this return; check it before you lodge._
`;
  const file = path.join(draftsDir(), `feed-return-${s.code.toLowerCase()}-${today()}.md`);
  fs.writeFileSync(file, body);
  return { file, site: s.code, months: rows.length, total_t: total };
}

async function weeklyReview(db) {
  const att = await db.query(reads.attention.sql);
  const plan = await db.query(reads['harvest-plan'].sql);
  const deaths = (await db.query(reads.mortality.sql)).filter((r) => r.deaths_30d > 0);
  const urgent = att.filter((a) => a.severity === 1);
  const body = `# Fish farm: weekly review, ${today()}

${urgent.length ? `**${urgent.length} item(s) touch a legal duty, a consent limit or fish welfare and come first:** ${urgent.map((u) => `${u.item} (${u.rule})`).join('; ')}.` : '**Nothing this week touches a legal duty, a consent limit or fish welfare.**'}

## Needs attention
${md(att)}
## Harvest plan
${md(plan)}
## Deaths in the last 30 days
${md(deaths)}
_Draft from three commands: attention, harvest-plan, mortality. Read before it goes to the farm managers' meeting._
`;
  const file = path.join(draftsDir(), `weekly-review-${today()}.md`);
  fs.writeFileSync(file, body);
  return { file, needs_attention: att.length, urgent: urgent.length, units_near_harvest: plan.length };
}

// ------------------------------------------------------------------ run

export async function run(db, args) {
  const { cmd, pos, f } = parse(args);
  let actor = null;
  if (mutating.has(cmd)) actor = need(f.actor, 'actor');
  if (Object.hasOwn(reads, cmd)) {
    if (cmd === 'compliance') {
      const out = [];
      for (const r of complianceRules) for (const row of await db.query(r.sql)) out.push({ rule: r.rule, code: row.code, finding: row.finding });
      return out.sort((a, b) => a.rule.localeCompare(b.rule) || a.code.localeCompare(b.code));
    }
    return db.query(reads[cmd].sql);
  }
  const target = pos.join(' ');
  switch (cmd) {
    case 'help': return Object.entries(usage).map(([command, a]) => ({ command, args: a, about: reads[command]?.about || '' }));
    case 'unit': return unitDetail(db, target);
    case 'batch': return batchDetail(db, target);
    case 'event': return eventDetail(db, target);
    case 'log-feed': return logFeed(db, f, actor);
    case 'mort': return mort(db, f, actor);
    case 'sample': return sample(db, f, actor);
    case 'reading': return reading(db, f, actor);
    case 'treat': return treat(db, f, actor);
    case 'add-batch': return addBatch(db, f, actor);
    case 'stock': return stock(db, f, actor);
    case 'move': return move(db, f, actor);
    case 'harvest': return harvest(db, f, actor);
    case 'deliver': return deliver(db, f, actor);
    case 'notify': return notify(db, target, f, actor);
    case 'close-event': return closeEvent(db, target, f, actor);
    case 'review-plan': return reviewPlan(db, target, f, actor);
    case 'import':
      if (pos[0] !== 'farm360' || pos.length > 1) throw Error(`Usage: import ${usage.import}`);
      return importFarm360(db, f, actor);
    case 'export': return exportAll(db, f);
    case 'draft-event-report': return draftEventReport(db, target);
    case 'harvest-declaration': return harvestDeclaration(db, target);
    case 'feed-return': return feedReturn(db, target, f);
    case 'weekly-review': return weeklyReview(db);
    default: throw Error(`Unknown command ${cmd}`);
  }
}

const WIDE = ['detail', 'finding', 'about', 'args', 'note', 'reason', 'product'];
function print(cmd, result) {
  if (Array.isArray(result)) {
    if (!result.length) { console.log('  (none)'); return; }
    const cols = Object.keys(result[0]).map((key) => ({ key, label: key, width: WIDE.includes(key) ? 48 : undefined,
      align: typeof result[0][key] === 'number' ? 'right' : 'left' }));
    console.log(textTable(result, cols));
    return;
  }
  if (['unit', 'batch', 'event'].includes(cmd)) {
    const head = result[cmd];
    console.log(heading(`${head.code}  ${head.name || head.unit || ''}`));
    for (const [k, v] of Object.entries(head)) if (v !== null && v !== undefined && !['code', 'name'].includes(k)) console.log(`  ${k.padEnd(22)}${v}`);
    for (const [label, rows] of Object.entries(result)) {
      if (!Array.isArray(rows)) continue;
      console.log(heading(label));
      print('', rows);
    }
    return;
  }
  for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(26)}${Array.isArray(v) ? (v.length ? '\n    ' + v.join('\n    ') : 'none') : typeof v === 'object' && v ? JSON.stringify(v) : v}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let db;
  try {
    db = await getDb();
    const result = await run(db, args);
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else print(args.find((a) => !a.startsWith('--')) || 'help', result);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    if (db) await db.close();
  }
}
