-- ---------------------------------------------------------------------------
-- A route sample carries its own destination coordinates (§12.54).
--
-- `route_samples` already denormalises dest_city/state/zip/precision, with the
-- comment "a sample whose destination can change is not a measurement". The
-- intent was right and the coordinates were left out, so the only way to get
-- them was to join `stops` — which is a LIVE row.
--
-- 35 of 114 existing samples (31%) already name a destination their stop no
-- longer has: Bismarck -> Grand Forks, Atlanta -> Joliet, Phoenix -> Grand
-- Island, Dallas -> Hazleton, and six more. Those measurements are CORRECT —
-- Chicago to Dallas really is 1198.9 straight and 1387.96 routed — and the
-- table is append-only precisely so they survive. What was wrong is that
-- `stop_id` was doing double duty as provenance and as a join key.
--
-- Every row is kept. Nothing is deleted here.
-- ---------------------------------------------------------------------------

alter table route_samples add column dest_lat double precision;
alter table route_samples add column dest_lng double precision;

comment on column route_samples.stop_id is
  'PROVENANCE ONLY — which stop this measurement was taken for, at the time. '
  'NOT a join key for destination facts: the stop may since have been '
  're-pointed anywhere. Use dest_lat/dest_lng/dest_city/dest_state/dest_zip, '
  'which are snapshots (§12.54).';

comment on column route_samples.dest_lat is
  'The destination as routed to, snapshotted. Null on rows measured before '
  '0014 whose coordinates could not be recovered (§12.54).';

-- Backfill 1: the sample written in the same transaction as the cache row.
-- `sweepRouting` inserts both together, so measured_at = computed_at exactly,
-- and stop_routes carries the coordinates that were routed to. This recovers
-- the newest sample per stop regardless of where the stop points now.
update route_samples rs
   set dest_lat = sr.stop_lat, dest_lng = sr.stop_lng
  from stop_routes sr
 where sr.stop_id = rs.stop_id
   and sr.computed_at = rs.measured_at
   and rs.dest_lat is null;

-- Backfill 2: the stop has not moved, so its coordinates still describe the
-- measurement. Guarded on the city AND state still matching the snapshot —
-- a stop that was re-pointed is exactly the case this must not guess at.
update route_samples rs
   set dest_lat = s.lat, dest_lng = s.lng
  from stops s
 where s.id = rs.stop_id
   and rs.dest_lat is null
   and s.lat is not null
   and s.city is not distinct from rs.dest_city
   and s.state is not distinct from rs.dest_state;

-- Everything still null is a row whose destination genuinely cannot be
-- recovered. That is the honest value: it says "not recorded", where a guess
-- from the live stop would say "Hazleton" about a Dallas measurement.
