-- Fish Farm for Claude Code: the schema.
-- Sites hold units (sea pens, tanks, raceways). A batch (a year class or group of fish)
-- sits in a unit as a holding. Every daily record (feed, mortality, weights, water
-- readings, treatments, harvests) hangs off a holding or a site, and is never edited.
-- Works on Postgres and PGlite: no extensions.

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('hatchery', 'freshwater', 'marine')),
  country text not null default 'NZ' check (country in ('NZ', 'AU')),
  region text,
  regulator text not null,
  consent_ref text,
  operator text not null,
  feed_cap_t numeric,                         -- tonnes of feed a year the consent or licence allows (null = no cap)
  max_density_kg_m3 numeric,                  -- default stocking density limit for units at this site
  min_do_mg_l numeric,                        -- dissolved oxygen below this is a welfare alarm
  mass_mortality_pct numeric not null default 2,  -- one day's deaths above this share of a unit opens a mortality event
  notify_within_days int not null default 1,
  notify_to text,                             -- who hears about a mortality event (MPI, the vet, the regulator)
  biosecurity_plan_reviewed_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  site_id uuid not null references sites(id),
  name text not null,
  kind text not null check (kind in ('pen', 'tank', 'raceway', 'pond')),
  volume_m3 numeric not null check (volume_m3 > 0),
  max_density_kg_m3 numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  species text not null,
  origin text,
  hatched_on date,
  target_weight_g numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A batch in a unit, from the day it went in to the day the unit was emptied.
create table holdings (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  batch_id uuid not null references batches(id),
  opened_on date not null,
  source text not null default 'stocked' check (source in ('stocked', 'transfer')),
  start_count int not null check (start_count > 0),
  start_avg_g numeric not null check (start_avg_g > 0),
  count int not null check (count >= 0),
  closed_on date,
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index holdings_one_open_per_unit on holdings (unit_id) where closed_on is null;

create table feeds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  supplier text,
  pellet_mm numeric,
  reorder_days int not null default 10,
  created_at timestamptz not null default now()
);

create table feed_deliveries (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references feeds(id),
  received_on date not null,
  kg numeric not null check (kg > 0),
  lot text,
  docket text,
  created_at timestamptz not null default now()
);

create table feed_records (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references holdings(id),
  fed_on date not null,
  feed_id uuid not null references feeds(id),
  kg numeric not null check (kg >= 0),
  recorded_by text,
  created_at timestamptz not null default now(),
  unique (holding_id, fed_on, feed_id)
);

create table mortalities (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references holdings(id),
  found_on date not null,
  count int not null check (count > 0),
  cause text not null default 'unknown' check (cause in ('unknown', 'predator', 'disease', 'handling', 'algal_bloom', 'low_oxygen', 'temperature', 'other')),
  note text,
  recorded_by text,
  created_at timestamptz not null default now()
);

create table samples (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references holdings(id),
  sampled_on date not null,
  fish_count int not null check (fish_count > 0),
  avg_weight_g numeric not null check (avg_weight_g > 0),
  note text,
  created_at timestamptz not null default now()
);

create table env_readings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  unit_id uuid references units(id),
  taken_on date not null,
  parameter text not null check (parameter in ('TEMP', 'DO', 'SAL')),
  value numeric not null,
  unit text not null,
  created_at timestamptz not null default now()
);

create table treatments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  holding_id uuid not null references holdings(id),
  started_on date not null,
  ended_on date,
  product text not null,
  reason text not null,
  withholding_days int not null default 0 check (withholding_days >= 0),
  authorised_by text,
  authorisation_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table movements (
  id uuid primary key default gen_random_uuid(),
  from_holding_id uuid not null references holdings(id),
  to_holding_id uuid not null references holdings(id),
  moved_on date not null,
  count int not null check (count > 0),
  avg_weight_g numeric,
  created_at timestamptz not null default now()
);

create table harvests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  holding_id uuid not null references holdings(id),
  harvested_on date not null,
  count int not null check (count > 0),
  total_kg numeric not null check (total_kg > 0),
  processor text,
  docket text,
  created_at timestamptz not null default now()
);

create table mortality_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  holding_id uuid not null references holdings(id),
  found_on date not null,
  count int not null,
  pct numeric not null,
  notified_on date,
  notified_to text,
  reference text,
  cause text,
  closed_on date,
  closeout_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_hash text not null,
  rows int not null,
  created_at timestamptz not null default now(),
  unique (source, file_hash)
);

create table activity (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  actor text not null,
  command text not null,
  record_id text,
  detail text
);

create trigger sites_updated before update on sites for each row execute function set_updated_at();
create trigger units_updated before update on units for each row execute function set_updated_at();
create trigger batches_updated before update on batches for each row execute function set_updated_at();
create trigger holdings_updated before update on holdings for each row execute function set_updated_at();
create trigger treatments_updated before update on treatments for each row execute function set_updated_at();
create trigger mortality_events_updated before update on mortality_events for each row execute function set_updated_at();

create index feed_records_holding_day on feed_records (holding_id, fed_on);
create index mortalities_holding_day on mortalities (holding_id, found_on);
create index samples_holding_day on samples (holding_id, sampled_on);
create index env_site_day on env_readings (site_id, taken_on);

-- What is in every unit right now: fish, weight, biomass, density, feeding and withholding.
create view holding_now as
select h.id as holding_id, s.code as site, s.id as site_id, u.code as unit, u.volume_m3, b.code as batch, b.species, b.target_weight_g,
  h.opened_on, h.count,
  coalesce(ls.avg_weight_g, h.start_avg_g)::numeric as avg_g,
  ls.sampled_on as weighed_on,
  round(h.count * coalesce(ls.avg_weight_g, h.start_avg_g) / 1000.0)::numeric as biomass_kg,
  round(h.count * coalesce(ls.avg_weight_g, h.start_avg_g) / 1000.0 / u.volume_m3, 1)::numeric as density_kg_m3,
  coalesce(u.max_density_kg_m3, s.max_density_kg_m3) as max_density_kg_m3,
  lf.last_fed,
  (current_date - coalesce(lf.last_fed, h.opened_on))::int as days_since_fed,
  wt.withhold_until
from holdings h
join units u on u.id = h.unit_id
join sites s on s.id = u.site_id
join batches b on b.id = h.batch_id
left join lateral (select sm.avg_weight_g, sm.sampled_on from samples sm where sm.holding_id = h.id order by sm.sampled_on desc limit 1) ls on true
left join lateral (select max(f.fed_on) as last_fed from feed_records f where f.holding_id = h.id) lf on true
left join lateral (select max(coalesce(t.ended_on, t.started_on) + t.withholding_days) as withhold_until from treatments t where t.holding_id = h.id) wt on true
where h.closed_on is null;

-- Feed used against the consent's yearly cap, over a rolling 365 days.
create view site_feed as
select s.code as site, s.name, s.feed_cap_t,
  round(coalesce(sum(f.kg) filter (where f.fed_on > current_date - 365), 0) / 1000.0, 1)::numeric as feed_t_365d,
  round(coalesce(sum(f.kg) filter (where f.fed_on > current_date - 30), 0) / 1000.0, 1)::numeric as feed_t_30d,
  case when s.feed_cap_t > 0 then round(100.0 * coalesce(sum(f.kg) filter (where f.fed_on > current_date - 365), 0) / 1000.0 / s.feed_cap_t, 1) end::numeric as pct_of_cap
from sites s
left join units u on u.site_id = s.id
left join holdings h on h.unit_id = u.id
left join feed_records f on f.holding_id = h.id
where s.active
group by s.id, s.code, s.name, s.feed_cap_t;

-- Feed on hand by type, what the farm uses a day, and how many days are left.
create view feed_stock as
select fd.code, fd.name, fd.supplier, fd.reorder_days,
  coalesce(d.kg, 0)::numeric as delivered_kg,
  coalesce(u.kg, 0)::numeric as used_kg,
  (coalesce(d.kg, 0) - coalesce(u.kg, 0))::numeric as on_hand_kg,
  round(coalesce(u14.kg, 0) / 14.0)::numeric as daily_kg_14d,
  case when coalesce(u14.kg, 0) > 0 then floor((coalesce(d.kg, 0) - coalesce(u.kg, 0)) / (u14.kg / 14.0))::int end as days_left
from feeds fd
left join (select feed_id, sum(kg) as kg from feed_deliveries group by feed_id) d on d.feed_id = fd.id
left join (select feed_id, sum(kg) as kg from feed_records group by feed_id) u on u.feed_id = fd.id
left join (select feed_id, sum(kg) as kg from feed_records where fed_on > current_date - 14 group by feed_id) u14 on u14.feed_id = fd.id;

-- Economic feed conversion by batch: feed eaten over the weight the batch put on,
-- counting fish still in the water and fish harvested.
create view batch_fcr as
select b.code as batch, b.species,
  coalesce(st.start_kg, 0)::numeric as stocked_kg,
  coalesce(nw.biomass_kg, 0)::numeric as in_water_kg,
  coalesce(hv.kg, 0)::numeric as harvested_kg,
  coalesce(mo.fish, 0)::int as deaths,
  coalesce(fd.kg, 0)::numeric as feed_kg,
  case when coalesce(nw.biomass_kg, 0) + coalesce(hv.kg, 0) - coalesce(st.start_kg, 0) > 0
    then round(coalesce(fd.kg, 0) / (coalesce(nw.biomass_kg, 0) + coalesce(hv.kg, 0) - coalesce(st.start_kg, 0)), 2) end::numeric as fcr
from batches b
left join (select batch_id, round(sum(start_count * start_avg_g) / 1000.0) as start_kg from holdings where source = 'stocked' group by batch_id) st on st.batch_id = b.id
left join (select h.batch_id, sum(n.biomass_kg) as biomass_kg from holding_now n join holdings h on h.id = n.holding_id group by h.batch_id) nw on nw.batch_id = b.id
left join (select h.batch_id, sum(x.total_kg) as kg from harvests x join holdings h on h.id = x.holding_id group by h.batch_id) hv on hv.batch_id = b.id
left join (select h.batch_id, sum(m.count) as fish from mortalities m join holdings h on h.id = m.holding_id group by h.batch_id) mo on mo.batch_id = b.id
left join (select h.batch_id, sum(f.kg) as kg from feed_records f join holdings h on h.id = f.holding_id group by h.batch_id) fd on fd.batch_id = b.id;

-- Every mortality event with the date someone had to be told by.
create view mortality_register as
select e.id, e.code, s.code as site, u.code as unit, b.code as batch, e.found_on, e.count, e.pct,
  s.notify_to, e.found_on + s.notify_within_days as notify_by, e.notified_on, e.notified_to, e.reference,
  case when e.notified_on is not null then e.notified_on - e.found_on end as days_to_notify, s.notify_within_days,
  e.cause, case when e.closed_on is null then 'open' else 'closed' end as status,
  (coalesce(e.closed_on, current_date) - e.found_on)::int as days_open
from mortality_events e
join holdings h on h.id = e.holding_id
join units u on u.id = h.unit_id
join sites s on s.id = u.site_id
join batches b on b.id = h.batch_id;

-- What needs a person this week, worst first.
-- severity 1 = a legal duty, a consent limit or fish welfare; 2 = overdue or close; 3 = housekeeping.
create view site_attention as
select 1 as severity, site, code as item, 'mortality event not reported' as rule,
  count || ' fish (' || pct || '%) in ' || unit || ' on ' || found_on || '; ' || coalesce(notify_to, 'the regulator') || ' to hear by ' || notify_by as detail,
  (current_date - notify_by)::int as days
from mortality_register where notified_on is null and status = 'open' and notify_by < current_date
union all
select 1, site, site || ' feed', 'feed cap exceeded',
  feed_t_365d || ' t fed in 365 days against a cap of ' || feed_cap_t || ' t (' || pct_of_cap || '%)', null
from site_feed where pct_of_cap > 100
union all
select 1, site, unit, 'stocking density over limit',
  density_kg_m3 || ' kg/m3 against ' || max_density_kg_m3 || ' (' || count || ' fish at ' || round(avg_g) || ' g)', null
from holding_now where max_density_kg_m3 is not null and density_kg_m3 > max_density_kg_m3
union all
select 1, s.code, coalesce(u.code, s.code) || ' DO ' || r.taken_on, 'low oxygen',
  r.value || ' mg/L against a minimum of ' || s.min_do_mg_l, (current_date - r.taken_on)::int
from env_readings r join sites s on s.id = r.site_id left join units u on u.id = r.unit_id
where r.parameter = 'DO' and s.min_do_mg_l is not null and r.value < s.min_do_mg_l and r.taken_on >= current_date - 2
union all
select 2, site, site || ' feed', 'feed cap close',
  feed_t_365d || ' t fed in 365 days against a cap of ' || feed_cap_t || ' t (' || pct_of_cap || '%)', null
from site_feed where pct_of_cap > 90 and pct_of_cap <= 100
union all
select 2, site, unit, 'no feed record', 'stocked with ' || batch || ', last feed recorded ' || coalesce(last_fed::text, 'never'), days_since_fed
from holding_now where days_since_fed >= 2
union all
select 2, site, unit, 'weights out of date', batch || ' last weighed ' || coalesce(weighed_on::text, 'never') || ', weights older than 28 days',
  (current_date - coalesce(weighed_on, opened_on))::int
from holding_now where current_date - coalesce(weighed_on, opened_on) > 28
union all
select 2, null, code, 'feed running low', on_hand_kg || ' kg on hand, about ' || days_left || ' days at ' || daily_kg_14d || ' kg a day', days_left
from feed_stock where days_left is not null and days_left < reorder_days
union all
select 2, s.code, t.code, 'treatment not authorised', t.product || ' on ' || u.code || ' from ' || t.started_on || ' has no veterinary authorisation recorded', (current_date - t.started_on)::int
from treatments t join holdings h on h.id = t.holding_id join units u on u.id = h.unit_id join sites s on s.id = u.site_id
where t.authorisation_ref is null and t.started_on >= current_date - 365
union all
select 2, code, code || ' biosecurity plan', 'biosecurity plan review overdue', 'last reviewed ' || coalesce(biosecurity_plan_reviewed_on::text, 'never'),
  (current_date - coalesce(biosecurity_plan_reviewed_on, current_date - 366) - 365)::int
from sites where active and (biosecurity_plan_reviewed_on is null or biosecurity_plan_reviewed_on < current_date - 365)
union all
select 3, site, code, 'mortality event not closed', count || ' fish in ' || unit || ', cause ' || coalesce(cause, 'not recorded'), days_open
from mortality_register where status = 'open' and (notified_on is not null or notify_by >= current_date) and days_open > 14;
