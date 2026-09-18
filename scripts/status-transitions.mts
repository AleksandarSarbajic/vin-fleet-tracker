/**
 * How often does a truck actually cross into LATE or AT_RISK? (§12.50)
 *
 *     npx tsx scripts/status-transitions.mts
 *
 * Replays the real status engine over the positions already in the database,
 * one step a minute, and counts the transitions a toast would have fired on.
 * The point is to choose the toast event set from measurement rather than
 * from taste — a toast for every status change on a 23-truck board is the
 * noise that teaches people to ignore toasts.
 *
 * WHAT IT APPROXIMATES, and it matters:
 *
 *   - Stops are read at their CURRENT state. A stop that has since been
 *     re-timed or arrived replays against today's values, not the ones that
 *     were live at the time.
 *   - The cached route is today's, so distances early in the window are
 *     better than they really were.
 *   - Overrides are ignored entirely.
 *
 * So it is a good estimate of RATE and a poor one for any single truck. The
 * first run covered 16.6 hours because §12.32's truncate took everything
 * older; re-run it on a full week before revisiting the AT_RISK decision.
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
loadEnv({ path: '.env.local' });
const { evaluate, STATUS_DEFAULTS } = await import('../src/lib/status.js');
type Status = string;

const sql = postgres(process.env.DIRECT_URL!, { max: 1 });
const CONFIG = { ...STATUS_DEFAULTS, dispatchTz: process.env.DISPATCH_TZ ?? 'America/Chicago' };
const STEP_MS = 60_000;

/** Every truck's next open stop, plus its cached route. §12.13 ordering. */
const stops = await sql`
  select distinct on (l.truck_id)
    l.truck_id::text as truck_id, t.truck_number, s.id::text as stop_id,
    s.appointment_start_utc, s.appointment_end_utc, s.appointment_type,
    s.arrived_at, s.lat, s.lng, s.geocode_precision, s.geocode_accuracy_miles,
    (s.address_line is not null or s.city is not null or s.zip is not null) as has_address,
    r.routed_miles, r.routed_duration_s, r.from_lat, r.from_lng,
    r.straight_at_route_miles, r.lane_ratio, r.stop_lat, r.stop_lng,
    r.snap_from_m, r.snap_to_m, r.computed_at,
    (select count(*) from assignments a where a.truck_id = l.truck_id and a.ended_at is null) as drivers
  from loads l
  join stops s on s.load_id = l.id and s.departed_at is null
  join trucks t on t.id = l.truck_id
  left join stop_routes r on r.stop_id = s.id
  where l.status not in ('DELIVERED','TONU','CANCELLED')
  order by l.truck_id, s.sequence`;

const truckIds = stops.map((s) => s.truck_id);
const positions = await sql`
  select truck_id::text as truck_id, lat, lng, recorded_at
  from positions
  where truck_id = any(${truckIds}) and recorded_at > date_trunc('day', now())
  order by truck_id, recorded_at`;

const byTruck = new Map<string, { lat: number; lng: number; at: number }[]>();
for (const p of positions) {
  const list = byTruck.get(p.truck_id) ?? [];
  list.push({ lat: p.lat, lng: p.lng, at: new Date(p.recorded_at).getTime() });
  byTruck.set(p.truck_id, list);
}

const first = Math.min(...positions.map((p) => new Date(p.recorded_at).getTime()));
const last = Math.max(...positions.map((p) => new Date(p.recorded_at).getTime()));
console.log(`window ${new Date(first).toISOString()} → ${new Date(last).toISOString()}`);
console.log(`${((last - first) / 3_600_000).toFixed(1)} hours, ${stops.length} trucks with an open stop\n`);

interface Crossing { truck: number; stop: string; at: number; to: Status }
const crossings: Crossing[] = [];

for (const s of stops) {
  const fixes = byTruck.get(s.truck_id) ?? [];
  if (fixes.length === 0) continue;
  const route = s.routed_miles === null ? null : {
    routedMiles: s.routed_miles, routedDurationS: s.routed_duration_s,
    fromLat: s.from_lat, fromLng: s.from_lng,
    straightAtRouteMiles: s.straight_at_route_miles, laneRatio: s.lane_ratio,
    stopLat: s.stop_lat, stopLng: s.stop_lng,
    snapFromM: s.snap_from_m, snapToM: s.snap_to_m,
    computedAtUtc: new Date(s.computed_at).toISOString(),
  };
  let cursor = 0;
  let previous: Status | null = null;
  for (let t = first; t <= last; t += STEP_MS) {
    while (cursor + 1 < fixes.length && fixes[cursor + 1]!.at <= t) cursor += 1;
    const fix = fixes[cursor]!;
    if (fix.at > t) continue;
    const facts = {
      lat: fix.lat, lng: fix.lng, recordedAtUtc: new Date(fix.at).toISOString(),
      hasDriver: Number(s.drivers) > 0,
      override: null,
      stop: {
        apptStartUtc: s.appointment_start_utc ? new Date(s.appointment_start_utc).toISOString() : null,
        apptEndUtc: s.appointment_end_utc ? new Date(s.appointment_end_utc).toISOString() : null,
        apptType: s.appointment_type ?? 'APPT',
        arrivedAt: s.arrived_at ? new Date(s.arrived_at).toISOString() : null,
        lat: s.lat, lng: s.lng, precision: s.geocode_precision,
        accuracyMiles: s.geocode_accuracy_miles, hasAddress: s.has_address,
        route, routeFresh: route !== null,
      },
    };
    const { status } = evaluate(facts as never, CONFIG, new Date(t));
    if (previous !== null && status !== previous && (status === 'LATE' || status === 'AT_RISK')) {
      crossings.push({ truck: s.truck_number, stop: s.stop_id, at: t, to: status });
    }
    previous = status;
  }
}

// The flapping case, in detail: every transition for a truck that crossed twice.
const repeatKeys = new Set(
  [...crossings.reduce((m, c) => {
    const k = `${c.truck}|${c.stop}`; m.set(k, (m.get(k) ?? 0) + 1); return m;
  }, new Map<string, number>())].filter(([, n]) => n > 1).map(([k]) => k),
);
if (repeatKeys.size > 0) {
  console.log('--- trucks that crossed the same boundary more than once ---');
  for (const key of repeatKeys) {
    const [truck] = key.split('|');
    const list = crossings.filter((c) => `${c.truck}|${c.stop}` === key).sort((a, b) => a.at - b.at);
    console.log(`truck ${truck}: ${list.length} crossings into ${list[0]!.to}`);
    let prev = 0;
    for (const c of list) {
      const gap = prev === 0 ? '' : ` (+${((c.at - prev) / 60_000).toFixed(0)} min)`;
      console.log(`   ${new Date(c.at).toISOString().slice(11, 19)}Z -> ${c.to}${gap}`);
      prev = c.at;
    }
  }
  console.log();
}

const hours = (last - first) / 3_600_000;
for (const kind of ['LATE', 'AT_RISK'] as const) {
  const hits = crossings.filter((c) => c.to === kind);
  const perHour = new Map<string, number>();
  for (const c of hits) {
    const h = new Date(c.at).toISOString().slice(0, 13);
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  const worst = [...perHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const distinct = new Set(hits.map((c) => `${c.truck}|${c.stop}`)).size;
  console.log(`${kind}:`);
  console.log(`  crossings in window   ${hits.length}`);
  console.log(`  distinct truck+stop   ${distinct}`);
  console.log(`  per hour (mean)       ${(hits.length / hours).toFixed(2)}`);
  console.log(`  extrapolated /day     ${(hits.length / hours * 24).toFixed(0)}`);
  console.log(`  worst single hour     ${worst ? `${worst[1]} at ${worst[0]}Z` : '0'}`);
  const repeats = [...hits.reduce((m, c) => {
    const k = `${c.truck}|${c.stop}`; m.set(k, (m.get(k) ?? 0) + 1); return m;
  }, new Map<string, number>())].filter(([, n]) => n > 1);
  console.log(`  truck+stop pairs crossing MORE THAN ONCE: ${repeats.length}`);
  for (const [k, n] of repeats.slice(0, 6)) console.log(`     ${k.split('|')[0]} — ${n} times`);
  console.log();
}
await sql.end();
