-- Demo data: one salmon business with a hatchery, a freshwater canal farm, a marine farm
-- in the Marlborough Sounds and a marine lease in Tasmania. Every date is relative to today,
-- so the attention list always has something to say:
--   a mortality event nobody has reported, a site over its feed cap and one close to it,
--   a pen over its stocking density, low oxygen yesterday, a pen with no feed record for
--   three days, weights out of date, grower feed running low, a treatment with no vet
--   authorisation, and a biosecurity plan past its yearly review.
-- Idempotent: a second run returns early.
do $$
begin
  if exists (select 1 from sites where code = 'HAT') then
    return;
  end if;

  insert into sites (code, name, kind, country, region, regulator, consent_ref, operator, feed_cap_t, max_density_kg_m3, min_do_mg_l,
    mass_mortality_pct, notify_within_days, notify_to, biosecurity_plan_reviewed_on) values
  ('HAT', 'Rakaia Hatchery', 'hatchery', 'NZ', 'Canterbury', 'Environment Canterbury', 'CRC190455', 'Southern Alps Salmon Ltd', null, 40, 7, 3, 2,
    'Fish health vet and MPI (0800 80 99 66)', current_date - 200),
  ('CAN', 'Kowhai Canal Farm', 'freshwater', 'NZ', 'Canterbury', 'Environment Canterbury', 'CRC204117', 'Southern Alps Salmon Ltd', 600, 25, 7, 2, 1,
    'MPI (0800 80 99 66)', current_date - 120),
  ('BLR', 'Blackwood Reach', 'marine', 'NZ', 'Marlborough', 'Marlborough District Council', 'U140294', 'Southern Alps Salmon Ltd', 780, 15, 6, 2, 1,
    'MPI (0800 80 99 66)', current_date - 400),
  ('DOV', 'Dover Bay Lease', 'marine', 'AU', 'Tasmania', 'EPA Tasmania', 'EL 61/2018', 'Southern Alps Salmon Tasmania Pty Ltd', 300, 15, 6, 2, 1,
    'EPA Tasmania and the state veterinarian', current_date - 90);

  insert into units (code, site_id, name, kind, volume_m3)
  select v.code, s.id, v.name, v.kind, v.vol
  from (values
    ('HAT-T01', 'HAT', 'Tank 1', 'tank', 60), ('HAT-T02', 'HAT', 'Tank 2', 'tank', 60), ('HAT-T03', 'HAT', 'Tank 3', 'tank', 60),
    ('CAN-P01', 'CAN', 'Canal pen 1', 'pen', 6000), ('CAN-P02', 'CAN', 'Canal pen 2', 'pen', 6000), ('CAN-P03', 'CAN', 'Canal pen 3', 'pen', 6000),
    ('BLR-P01', 'BLR', 'Pen 1', 'pen', 12000), ('BLR-P02', 'BLR', 'Pen 2', 'pen', 12000), ('BLR-P03', 'BLR', 'Pen 3', 'pen', 12000),
    ('BLR-P04', 'BLR', 'Pen 4', 'pen', 12000), ('BLR-P05', 'BLR', 'Pen 5', 'pen', 12000),
    ('DOV-P01', 'DOV', 'Pen 1', 'pen', 10000), ('DOV-P02', 'DOV', 'Pen 2', 'pen', 10000), ('DOV-P03', 'DOV', 'Pen 3', 'pen', 10000)
  ) v(code, site, name, kind, vol) join sites s on s.code = v.site;

  insert into batches (code, name, species, origin, hatched_on, target_weight_g) values
  ('YC24', '2024 year class', 'King salmon', 'Rakaia Hatchery', current_date - 900, 3500),
  ('YC25', '2025 year class', 'King salmon', 'Rakaia Hatchery', current_date - 540, 3500),
  ('YC26', '2026 year class', 'King salmon', 'Rakaia Hatchery broodstock', current_date - 180, 3500),
  ('AS25', '2025 Atlantic intake', 'Atlantic salmon', 'Tasmanian hatchery smolt', current_date - 600, 4500);

  insert into holdings (unit_id, batch_id, opened_on, source, start_count, start_avg_g, count, closed_on, closed_reason)
  select u.id, b.id, current_date - v.opened, 'stocked', v.sc, v.sa, v.c,
    case when v.closed is null then null else current_date - v.closed end, v.why
  from (values
    ('HAT-T01', 'YC26', 150, 60000, 2, 57200, null::int, null),
    ('HAT-T02', 'YC26', 150, 60000, 2, 56800, null, null),
    ('CAN-P01', 'YC25', 330, 30000, 120, 28400, null, null),
    ('CAN-P02', 'YC25', 330, 30000, 120, 28900, null, null),
    ('CAN-P03', 'YC24', 700, 25000, 100, 22100, null, null),
    ('BLR-P01', 'YC24', 640, 42000, 150, 38000, null, null),
    ('BLR-P02', 'YC24', 640, 42000, 150, 37500, null, null),
    ('BLR-P03', 'YC24', 640, 52000, 150, 49000, null, null),
    ('BLR-P04', 'YC24', 640, 40000, 150, 0, 20, 'harvested'),
    ('BLR-P05', 'YC25', 300, 45000, 110, 41900, null, null),
    ('DOV-P01', 'AS25', 280, 35000, 150, 33000, null, null),
    ('DOV-P02', 'AS25', 280, 35000, 150, 33600, null, null),
    ('DOV-P03', 'AS25', 280, 30000, 150, 29100, null, null)
  ) v(unit, batch, opened, sc, sa, c, closed, why)
  join units u on u.code = v.unit join batches b on b.code = v.batch;

  insert into samples (holding_id, sampled_on, fish_count, avg_weight_g)
  select h.id, current_date - v.ago, v.n, v.g
  from (values
    ('HAT-T01', 10, 100, 18), ('HAT-T02', 12, 100, 17),
    ('CAN-P01', 40, 40, 1500), ('CAN-P01', 12, 40, 1850),
    ('CAN-P02', 38, 40, 1450), ('CAN-P02', 9, 40, 1800),
    ('CAN-P03', 35, 40, 3300), ('CAN-P03', 7, 40, 3650),
    ('BLR-P01', 40, 50, 3400), ('BLR-P01', 8, 50, 3720),
    ('BLR-P02', 42, 50, 3350), ('BLR-P02', 10, 50, 3680),
    ('BLR-P03', 9, 50, 3800),
    ('BLR-P04', 45, 50, 3450),
    ('BLR-P05', 30, 50, 1200), ('BLR-P05', 11, 50, 1400),
    ('DOV-P01', 50, 40, 1900),
    ('DOV-P02', 14, 40, 2100),
    ('DOV-P03', 14, 40, 2050)
  ) v(unit, ago, n, g)
  join units u on u.code = v.unit join holdings h on h.unit_id = u.id;

  insert into feeds (code, name, supplier, pellet_mm, reorder_days) values
  ('STARTER', 'Starter crumble 1.5 mm', 'Southern Feeds', 1.5, 14),
  ('GROWER', 'Grower 6 mm', 'Southern Feeds', 6, 10),
  ('FINISHER', 'Finisher 9 mm', 'Southern Feeds', 9, 10);

  -- One record per unit per day for the last 120 days (yesterday back), in kilograms.
  insert into feed_records (holding_id, fed_on, feed_id, kg, recorded_by)
  select h.id, current_date - d, f.id, v.kg, v.who
  from (values
    ('HAT-T01', 'STARTER', 12, 1, 120, 'Mere Tipene'), ('HAT-T02', 'STARTER', 12, 1, 120, 'Mere Tipene'),
    ('CAN-P01', 'GROWER', 450, 1, 120, 'Sam Whitlock'), ('CAN-P02', 'GROWER', 450, 1, 120, 'Sam Whitlock'),
    ('CAN-P03', 'FINISHER', 700, 1, 120, 'Sam Whitlock'),
    ('BLR-P01', 'FINISHER', 1300, 1, 120, 'Aroha Ngata'), ('BLR-P02', 'FINISHER', 1300, 1, 120, 'Aroha Ngata'),
    ('BLR-P03', 'FINISHER', 1700, 1, 120, 'Aroha Ngata'), ('BLR-P04', 'FINISHER', 1300, 21, 120, 'Aroha Ngata'),
    ('BLR-P05', 'GROWER', 600, 1, 120, 'Aroha Ngata'),
    ('DOV-P01', 'GROWER', 900, 1, 120, 'Liam Carter'), ('DOV-P02', 'GROWER', 900, 1, 120, 'Liam Carter'),
    ('DOV-P03', 'GROWER', 900, 3, 120, 'Liam Carter')
  ) v(unit, feed, kg, d0, d1, who)
  join units u on u.code = v.unit join holdings h on h.unit_id = u.id join feeds f on f.code = v.feed
  cross join lateral generate_series(v.d0, v.d1) d;

  -- Opening stock sized so that today's on-hand is set, plus one recent delivery each.
  insert into feed_deliveries (feed_id, received_on, kg, lot, docket)
  select f.id, current_date - 121, (select sum(r.kg) from feed_records r where r.feed_id = f.id) + v.on_hand - v.recent, 'opening stock', null
  from (values ('STARTER', 600, 400), ('GROWER', 18000, 30000), ('FINISHER', 90000, 60000)) v(feed, on_hand, recent)
  join feeds f on f.code = v.feed;
  insert into feed_deliveries (feed_id, received_on, kg, lot, docket)
  select f.id, current_date - v.ago, v.kg, v.lot, v.docket
  from (values ('STARTER', 20, 400, 'SF-ST-2611', 'D-88412'), ('GROWER', 6, 30000, 'SF-GR-2644', 'D-88730'), ('FINISHER', 4, 60000, 'SF-FN-2651', 'D-88791')) v(feed, ago, kg, lot, docket)
  join feeds f on f.code = v.feed;

  -- Routine losses every third day over the last 60 days, plus the two events.
  insert into mortalities (holding_id, found_on, count, cause, recorded_by)
  select h.id, current_date - d, 5 + (d % 7), 'unknown', 'farm crew'
  from units u join holdings h on h.unit_id = u.id and h.closed_on is null
  cross join lateral generate_series(3, 60, 3) d
  where u.code not like 'HAT-%';
  insert into mortalities (holding_id, found_on, count, cause, note, recorded_by)
  select h.id, current_date - v.ago, v.n, v.cause, v.note, v.who
  from (values
    ('CAN-P02', 60, 900, 'low_oxygen', 'Canal flow cut during a power station outage overnight', 'Sam Whitlock'),
    ('BLR-P05', 3, 2100, 'unknown', 'Fish found at the surface at first light; samples sent to the lab', 'Aroha Ngata')
  ) v(unit, ago, n, cause, note, who)
  join units u on u.code = v.unit join holdings h on h.unit_id = u.id;

  insert into mortality_events (code, holding_id, found_on, count, pct, notified_on, notified_to, reference, cause, closed_on, closeout_note)
  select v.code, h.id, current_date - v.ago, v.n, v.pct,
    case when v.told is null then null else current_date - v.told end, v.told_to, v.ref, v.cause,
    case when v.closed is null then null else current_date - v.closed end, v.note
  from (values
    ('ME-0001', 'CAN-P02', 60, 900, 3.0, 60, 'MPI', 'MPI-2026-11873', 'low_oxygen', 45, 'Flow alarm fitted to the canal intake; power company now calls the farm before outages'),
    ('ME-0002', 'BLR-P05', 3, 2100, 4.8, null::int, null, null, null, null::int, null)
  ) v(code, unit, ago, n, pct, told, told_to, ref, cause, closed, note)
  join units u on u.code = v.unit join holdings h on h.unit_id = u.id;

  insert into env_readings (site_id, unit_id, taken_on, parameter, value, unit)
  select s.id, null, current_date - d, p.parameter,
    case when p.parameter = 'DO' then 7.6 + (d % 3) * 0.2
      else (case s.code when 'HAT' then 10.5 when 'CAN' then 9.5 when 'BLR' then 13.8 else 15.2 end) + (d % 4) * 0.3 end, p.u
  from sites s
  cross join generate_series(1, 14) d
  cross join (values ('DO', 'mg/L'), ('TEMP', 'C')) p(parameter, u);
  insert into env_readings (site_id, unit_id, taken_on, parameter, value, unit)
  select s.id, u.id, current_date - 1, 'DO', 5.1, 'mg/L' from sites s join units u on u.code = 'DOV-P02' where s.code = 'DOV';

  insert into treatments (code, holding_id, started_on, ended_on, product, reason, withholding_days, authorised_by, authorisation_ref)
  select v.code, h.id, current_date - v.s, current_date - v.e, v.product, v.reason, v.wd, v.by, v.ref
  from (values
    ('TR-001', 'BLR-P02', 12, 10, 'Oxytetracycline medicated feed', 'Mouth rot in the pen', 40, 'Dr Hana Reid BVSc', 'VA-2026-0412'),
    ('TR-002', 'HAT-T02', 20, 15, 'Chloramine-T bath', 'Gill disease in fry', 0, null, null)
  ) v(code, unit, s, e, product, reason, wd, by, ref)
  join units u on u.code = v.unit join holdings h on h.unit_id = u.id;

  insert into harvests (code, holding_id, harvested_on, count, total_kg, processor, docket)
  select v.code, h.id, current_date - v.ago, v.n, v.kg, 'Nelson Seafood Processors', v.docket
  from (values ('HV-001', 'BLR-P04', 25, 18000, 64800, 'NSP-40122'), ('HV-002', 'BLR-P04', 20, 19200, 70100, 'NSP-40188')) v(code, unit, ago, n, kg, docket)
  join units u on u.code = v.unit join holdings h on h.unit_id = u.id;
end $$;
