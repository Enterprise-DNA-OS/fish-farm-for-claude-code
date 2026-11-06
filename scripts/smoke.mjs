// npm test: a temporary database, migrate, seed twice, then every command and every gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, reads, usage } from './farm.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fishfarm-'));
process.env.DATA_DIR = path.join(tmp, 'db');
process.env.OUTPUT_DIR = tmp;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const db = await getDb();
const exercised = new Set();
let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const call = async (args) => { exercised.add(args[0]); return run(db, args); };
const fail = async (args, re) => { exercised.add(args[0]); await assert.rejects(() => run(db, args), re); checks++; };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const dmy = (n) => day(n).split('-').reverse().join('/');
const actor = '--actor=Tester';

try {
  ok((await migrate(db)).ran.length === 1, 'migration applies');
  ok((await migrate(db)).ran.length === 0, 'migration is idempotent');
  await seed(db);
  await seed(db);
  ok((await db.query('select * from holdings')).length === 13, 'seed is idempotent');
  ok((await db.query('select * from feed_records')).length === 1538, 'seed feed records');

  // Every read works in both shapes.
  for (const name of Object.keys(reads)) ok(Array.isArray(await call([name, '--json'])), `${name} returns rows`);
  ok((await call(['help'])).length === Object.keys(usage).length, 'help lists every command');

  // The attention list finds what the seed planted.
  const att = await call(['attention']);
  const has = (item, rule) => att.some((r) => (r.item === item || r.item.startsWith(`${item} `)) && r.rule === rule);
  ok(has('ME-0002', 'mortality event not reported'), 'unreported mortality event');
  ok(!att.some((r) => r.item === 'ME-0001'), 'a reported, closed event needs nothing');
  ok(has('DOV feed', 'feed cap exceeded') && has('BLR feed', 'feed cap close') && !att.some((r) => r.item === 'CAN feed'), 'feed caps');
  ok(has('BLR-P03', 'stocking density over limit') && !has('BLR-P01', 'stocking density over limit'), 'density');
  ok(has('DOV-P02 DO', 'low oxygen'), 'low oxygen yesterday');
  ok(has('DOV-P03', 'no feed record') && !has('DOV-P02', 'no feed record'), 'missing feed records');
  ok(has('DOV-P01', 'weights out of date') && !has('DOV-P02', 'weights out of date'), 'weights older than 28 days');
  ok(has('GROWER', 'feed running low') && !has('FINISHER', 'feed running low'), 'feed stock');
  ok(has('TR-002', 'treatment not authorised') && !has('TR-001', 'treatment not authorised'), 'vet authorisation');
  ok(has('BLR biosecurity plan', 'biosecurity plan review overdue') && !has('CAN biosecurity plan', 'biosecurity plan review overdue'), 'plan review');
  ok(att[0].severity === 1, 'worst first');

  const comp = await call(['compliance']);
  const finds = (rule, code) => comp.some((r) => r.rule === rule && (r.code === code || r.code.startsWith(`${code} `)));
  ok(finds('MORTALITY-REPORT', 'ME-0002') && !finds('MORTALITY-REPORT', 'ME-0001'), 'ME-0001 was reported the same day');
  ok(finds('FEED-CAP', 'DOV') && !finds('FEED-CAP', 'BLR'), 'only Dover Bay is over its cap');
  ok(finds('DENSITY', 'BLR-P03') && finds('LOW-OXYGEN', 'DOV-P02') && finds('VET-AUTHORISATION', 'TR-002'));
  ok(finds('DAILY-RECORDS', 'DOV-P03') && finds('BIOSECURITY-PLAN', 'BLR'));
  ok(!comp.some((r) => r.rule === 'WITHHOLDING'), 'no harvest inside a withholding period');

  const plan = await call(['harvest-plan']);
  ok(plan.find((r) => r.unit === 'BLR-P02').status.startsWith('withholding until'), 'withholding blocks the plan');
  ok(plan.filter((r) => r.status === 'ready').map((r) => r.unit).join(',') === 'BLR-P03,BLR-P01,CAN-P03', 'ready units, heaviest first');
  ok((await call(['feed-cap']))[0].site === 'DOV', 'worst cap first');
  ok((await call(['feed-stock']))[0].code === 'GROWER', 'lowest feed first');
  ok((await call(['growth'])).find((r) => r.unit === 'BLR-P05').sgr_pct_day === 0.81, 'specific growth rate');
  ok((await call(['mortality']))[0].unit === 'BLR-P05', 'worst deaths first');
  ok((await call(['batches'])).find((r) => r.batch === 'YC24').harvested_kg === 134900, 'harvested kilograms by batch');
  ok((await call(['fcr'])).every((r) => r.fcr > 0), 'feed conversion');

  // Lookup: code, name words, ambiguity, misses, bad flags.
  ok((await call(['unit', 'blackwood pen 5'])).unit.code === 'BLR-P05', 'unit by site and name words');
  ok((await call(['unit', 'blr-p02'])).unit.withhold_until !== null, 'unit by code, any case');
  await fail(['unit', 'pen 1'], /Ambiguous/);
  await fail(['unit', 'nowhere'], /No matching unit/);
  ok((await call(['batch', '2025 year'])).batch.code === 'YC25', 'batch by name words');
  ok((await call(['event', 'me-0002'])).event.status === 'open', 'event lookup');
  await fail(['units', '--bogus'], /Unknown flag/);
  await fail(['nonsense'], /Unknown command/);
  await fail(['units', 'extra'], /takes no arguments/);
  await fail(['mort', '--unit=BLR-P01', '--count=5'], /--actor is required/);

  // Daily records: feed, deaths, weights, oxygen.
  const fed = await call(['log-feed', '--unit=BLR-P01', '--kg=1250', actor]);
  ok(fed.feed === 'FINISHER' && fed.fed_on === day(0), 'feed type carries over from the last record');
  await fail(['log-feed', '--unit=BLR-P01', '--kg=10', actor], /already has FINISHER recorded/);
  await fail(['log-feed', '--unit=HAT-T03', '--kg=10', '--feed=starter', actor], /is empty/);
  const small = await call(['mort', '--unit=CAN-P01', '--count=12', '--cause=predator', actor]);
  ok(small.fish_left === 28388 && !small.event_opened, 'routine deaths open no event');
  await fail(['mort', '--unit=CAN-P01', '--count=5', '--cause=gremlins', actor], /--cause must be one of/);
  await fail(['mort', '--unit=CAN-P01', '--count=999999', actor], /holds 28388 fish/);
  const big = await call(['mort', '--unit=CAN-P03', '--count=700', '--note=Fish gasping at dawn', actor]);
  ok(big.event_opened === 'ME-0003' && /Tell MPI/.test(big.next), 'a mass mortality opens an event in the same step');
  const more = await call(['mort', '--unit=CAN-P03', '--count=100', actor]);
  ok(more.event_opened === 'ME-0003', 'more deaths the same day update the same event');
  ok((await db.query(`select count from mortality_events where code = 'ME-0003'`))[0].count === 800, 'event counts the whole day');
  await fail(['close-event', 'ME-0003', '--cause=low oxygen', '--note=x', actor], /nobody has been told/);
  const told = await call(['notify', 'ME-0003', '--to=MPI', '--reference=MPI-2026-12001', actor]);
  ok(told.late === false && told.days_after_found === 0, 'reported the same day');
  await fail(['notify', 'ME-0003', '--to=MPI', '--reference=again', actor], /was reported/);
  ok((await call(['close-event', 'ME-0003', '--cause=low oxygen', '--note=Aerators fitted', actor])).status === 'closed');
  ok((await call(['notify', 'ME-0002', '--to=MPI', '--reference=MPI-2026-11990', `--on=${day(-1)}`, actor])).late === true, 'two days after is late');
  ok((await call(['compliance'])).some((r) => r.rule === 'MORTALITY-REPORT' && r.code === 'ME-0002' && /told 2 days after/.test(r.finding)), 'a late report stays on the record');

  const s = await call(['sample', '--unit=DOV-P01', '--fish=40', '--avg=2300', actor]);
  ok(s.avg_g === 2300 && !s.warning, 'weights brought up to date');
  ok(!(await call(['attention'])).some((r) => r.item === 'DOV-P01' && r.rule === 'weights out of date'), 'clears the flag');
  ok(/over the limit/.test((await call(['sample', '--unit=BLR-P01', '--fish=50', '--avg=4800', actor])).warning || ''), 'density warning on weighing');
  ok(/below the site minimum/.test((await call(['reading', '--site=CAN', '--unit=CAN-P02', '--parameter=do', '--value=5.5', actor])).warning), 'low oxygen warning');
  await fail(['reading', '--site=CAN', '--unit=BLR-P01', '--parameter=DO', '--value=8', actor], /is not at CAN/);
  await fail(['reading', '--site=CAN', '--parameter=PH', '--value=8', actor], /--parameter must be one of/);
  await fail(['sample', '--unit=DOV-P02', '--fish=40', '--avg=2400', `--on=${day(3)}`, actor], /cannot be in the future/);

  // Treatments and harvest: the withholding period is a hard stop.
  await fail(['harvest', '--unit=BLR-P02', '--count=1000', '--kg=3700', '--processor=Nelson Seafood Processors', actor], /inside the withholding period of TR-001/);
  await fail(['treat', '--unit=BLR-P01', '--product=x', '--reason=y', '--withholding=10', '--ref=1', actor], /both --authorised-by and --ref/);
  const tr = await call(['treat', '--unit=CAN-P02', '--product=Salt bath', '--reason=Fungus', '--withholding=0', '--authorised-by=Dr Hana Reid BVSc', '--ref=VA-2026-0500', actor]);
  ok(tr.treatment === 'TR-003' && tr.harvest_from === day(0) && !tr.warning, 'treatment with authorisation');
  await fail(['harvest', '--unit=BLR-P03', '--count=99999', '--kg=1', '--processor=x', actor], /holds 49000 fish/);
  const hv = await call(['harvest', '--unit=BLR-P03', '--count=12000', '--kg=45600', '--processor=Nelson Seafood Processors', '--docket=NSP-40301', actor]);
  ok(hv.harvest === 'HV-003' && hv.avg_g === 3800 && hv.fish_left === 37000, 'harvest');
  ok(!(await call(['attention'])).some((r) => r.item === 'BLR-P03' && r.rule === 'stocking density over limit'), 'harvest brings density under the limit');

  // Stock, move, batches never mixed.
  ok((await call(['add-batch', '--code=YC27', '--name=2027 year class', '--species=King salmon', '--target=3500', actor])).batch === 'YC27');
  await fail(['add-batch', '--code=yc27', '--name=x', '--species=y', actor], /already exists/);
  ok((await call(['stock', '--unit=HAT-T03', '--batch=YC27', '--count=50000', '--avg=0.4', actor])).fish === 50000);
  await fail(['stock', '--unit=HAT-T03', '--batch=YC27', '--count=1', '--avg=1', actor], /already holds fish/);
  await fail(['move', '--from=HAT-T01', '--to=HAT-T03', '--count=100', actor], /batches are never mixed/);
  const mv = await call(['move', '--from=BLR-P03', '--to=BLR-P04', '--count=37000', actor]);
  ok(mv.from_closed && mv.left_in_from === 0, 'moving every fish empties the pen');
  ok((await call(['units'])).some((r) => r.unit === 'BLR-P04' && r.fish === 37000 && r.avg_g === 3800), 'the fish arrive with their weight');
  ok(!(await call(['units'])).some((r) => r.unit === 'BLR-P03'), 'the empty pen leaves the stock list');

  // Feed stock and the plan.
  const dl = await call(['deliver', '--feed=grower', '--kg=40000', '--lot=SF-GR-2660', '--docket=D-88900', actor]);
  ok(dl.on_hand_kg === 58000 && dl.days_left > 10, 'a delivery clears the low-feed flag');
  ok((await call(['review-plan', 'Blackwood', actor])).biosecurity_plan_reviewed_on === day(0));
  ok(!(await call(['compliance'])).some((r) => r.rule === 'BIOSECURITY-PLAN'), 'plan reviewed');

  // Drafts land in drafts/, never sent.
  const rep = await call(['draft-event-report', 'ME-0002']);
  ok(fs.existsSync(rep.file) && /Mortality report: ME-0002/.test(fs.readFileSync(rep.file, 'utf8')), 'mortality report drafted');
  const dec = await call(['harvest-declaration', 'HV-003']);
  ok(dec.withholding_clear && /Harvest declaration HV-003/.test(fs.readFileSync(dec.file, 'utf8')), 'harvest declaration');
  const ret = await call(['feed-return', 'DOV']);
  ok(ret.months >= 3 && ret.total_t > 0 && /Feed return: Dover Bay Lease/.test(fs.readFileSync(ret.file, 'utf8')), 'feed return');
  const wk = await call(['weekly-review']);
  ok(wk.urgent >= 1 && fs.readFileSync(wk.file, 'utf8').includes('## Harvest plan'), 'weekly review');

  // Import from a Farm360 export: dry run, problems, the real thing, never twice.
  const stockCsv = path.join(tmp, 'stock.csv');
  const dailyCsv = path.join(tmp, 'daily.csv');
  await db.exec(`insert into units (code, site_id, name, kind, volume_m3) select 'CAN-P04', id, 'Canal pen 4', 'pen', 6000 from sites where code = 'CAN'`);
  fs.writeFileSync(stockCsv, `Site,Pen,Group,Species,Fish count,Average weight (g),Stocking date\nKowhai Canal Farm,Canal pen 4,YC25B,King salmon,"20,000",950,${dmy(-40)}\n`);
  fs.writeFileSync(dailyCsv, `Date,Site,Pen,Feed (kg),Feed type,Mortalities,Mortality cause\n${dmy(-10)},Kowhai Canal Farm,Canal pen 4,300,Grower 6 mm,4,Seal attack\n${dmy(-9)},Kowhai Canal Farm,Canal pen 4,310,Grower 6 mm,,\n${dmy(-9)},Kowhai Canal Farm,Canal pen 4,40,Astaxanthin top-up,,\n${dmy(-60)},Kowhai Canal Farm,Canal pen 4,290,Grower 6 mm,,\n`);
  const dry = await call(['import', 'farm360', `--stock=${stockCsv}`, `--daily=${dailyCsv}`, '--dry-run', actor]);
  ok(dry.dry_run && dry.stock_rows === 1 && dry.daily_rows === 4 && dry.new_feed_types.join() === 'Astaxanthin top-up', 'dry run');
  ok((await db.query(`select * from holdings h join units u on u.id = h.unit_id where u.code = 'CAN-P04'`)).length === 0, 'a dry run writes nothing');
  const badCsv = path.join(tmp, 'bad.csv');
  fs.writeFileSync(badCsv, `Date,Site,Pen,Feed (kg),Feed type\n31/02/2026,Kowhai Canal Farm,Canal pen 4,10,Grower 6 mm\n${dmy(-1)},Nowhere,Pen 9,10,Grower 6 mm\n${dmy(-1)},Kowhai Canal Farm,Canal pen 4,10,\n`);
  await fail(['import', 'farm360', `--daily=${badCsv}`, actor], /Nothing imported[\s\S]*real YYYY-MM-DD[\s\S]*no unit "Pen 9"[\s\S]*no feed type/);
  const imp = await call(['import', 'farm360', `--stock=${stockCsv}`, `--daily=${dailyCsv}`, actor]);
  ok(imp.units_stocked === 1 && imp.feed_records === 3 && imp.death_records === 1 && imp.skipped.length === 1, 'import, with the day before stocking skipped');
  ok((await db.query(`select cause from mortalities m join holdings h on h.id = m.holding_id join units u on u.id = h.unit_id where u.code = 'CAN-P04'`))[0].cause === 'predator', 'causes mapped');
  await fail(['import', 'farm360', `--stock=${stockCsv}`, `--daily=${dailyCsv}`, actor], /imported on/);
  await fail(['import', 'other', actor], /Usage: import/);

  const out = path.join(tmp, 'export.json');
  const ex = await call(['export', `--out=${out}`]);
  ok(ex.tables.harvests === 3 && JSON.parse(fs.readFileSync(out, 'utf8')).holdings.length === 16, 'export');
  await fail(['export', `--out=${out}`], /already exists/);

  const acts = await call(['activity']);
  ok(acts.length >= 19 && acts.every((a) => a.actor), 'every write is logged with who did it');

  // Every command in usage was exercised.
  const missed = Object.keys(usage).filter((c) => !exercised.has(c));
  ok(!missed.length, `commands never exercised: ${missed.join(', ')}`);

  // The branded views and documents render from the same data.
  await db.close();
  for (const script of ['view', 'docs']) {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', `${script}.mjs`)], { env: { ...process.env, OUTPUT_DIR: tmp }, encoding: 'utf8' });
    ok(r.status === 0, `${script} renders: ${r.stderr}`);
    ok(/(view|doc): /.test(r.stdout), `${script} wrote files`);
  }
  console.log(`PASS: ${checks} checks, ${Object.keys(usage).length} commands`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  try { await db.close(); } catch {}
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
