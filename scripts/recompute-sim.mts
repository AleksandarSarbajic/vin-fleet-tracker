/**
 * What a tighter recompute rule would COST, replayed over real tracks.
 * `npm run route:simulate`
 *
 * §12.31 chose `max(10 mi, 15%)` from a simulation over lane LENGTHS. This
 * replays the same decision over the actual position history — every fix the
 * fleet reported — so the answer is a count of calls that would really have
 * been made, not a model of them.
 *
 * Spends nothing: `needsRecompute` is pure, so this never touches HERE.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { needsRecompute, ROUTE_PROVIDER, ROUTING_DEFAULTS, type CachedRoute } from '../src/lib/routing.ts';
import { haversineMiles } from '../src/lib/status.ts';

loadEnv({ path: '.env.local' });
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);
const HOURS = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 24);

interface Row {
  truck: number | null;
  stop_id: string;
  stop_lat: number;
  stop_lng: number;
  appt: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
}

const rows = (await db.execute(sql`
  select t.truck_number as truck, ns.stop_id, ns.stop_lat, ns.stop_lng, ns.appt,
         p.lat, p.lng, p.recorded_at
  from trucks t
  join lateral (
    select s.id::text as stop_id, s.lat as stop_lat, s.lng as stop_lng,
           s.appointment_start_utc as appt
    from loads l join stops s on s.load_id = l.id
    where l.truck_id = t.id and l.status not in ('DELIVERED','TONU','CANCELLED')
      and s.departed_at is null and s.lat is not null
    order by s.appointment_start_utc asc nulls last, s.sequence asc limit 1
  ) ns on true
  join positions p on p.truck_id = t.id
  where t.active and p.recorded_at > now() - make_interval(hours => ${HOURS})
  order by t.truck_number, p.recorded_at`)) as unknown as Row[];

/** One variant of the rule. */
interface Variant {
  name: string;
  /** Thresholds for a lane whose appointment is inside 24 h. */
  floorMiles: number;
  fraction: number;
  /** Thresholds for every other lane. Null keeps the current ones. */
  otherFloor?: number;
  otherFraction?: number;
}
const VARIANTS: Variant[] = [
  { name: 'current    10mi/15% all', floorMiles: 10, fraction: 0.15 },
  { name: 'today  5mi/8%,  rest as-is', floorMiles: 5, fraction: 0.08 },
  { name: 'today  2mi/5%,  rest as-is', floorMiles: 2, fraction: 0.05 },
  { name: 'today  1mi/3%,  rest as-is', floorMiles: 1, fraction: 0.03 },
  /**
   * The trade, not the increase. Spend the calls where the deadline is close
   * and stop spending them 1,400 miles out, where a 15% error self-corrects
   * long before anyone reads it.
   */
  { name: 'today  2mi/5%,  rest 25/25%', floorMiles: 2, fraction: 0.05, otherFloor: 25, otherFraction: 0.25 },
  { name: 'today  1mi/3%,  rest 25/25%', floorMiles: 1, fraction: 0.03, otherFloor: 25, otherFraction: 0.25 },
  { name: 'today  1mi/3%,  rest 40/35%', floorMiles: 1, fraction: 0.03, otherFloor: 40, otherFraction: 0.35 },
];

/** Is the appointment inside the next 24 hours? That is "today" for dispatch. */
const isToday = (appt: string | null, at: Date) => {
  if (!appt) return false;
  const d = new Date(appt).getTime() - at.getTime();
  return d > -12 * 3_600_000 && d < 24 * 3_600_000;
};

const byTruck = new Map<string, Row[]>();
for (const r of rows) {
  const key = `${r.truck}|${r.stop_id}`;
  if (!byTruck.has(key)) byTruck.set(key, []);
  byTruck.get(key)!.push(r);
}

console.log(`${rows.length} fixes across ${byTruck.size} truck-lanes, last ${HOURS}h\n`);

const results = VARIANTS.map((v) => {
  let calls = 0;
  let lanesToday = 0;
  for (const track of byTruck.values()) {
    const first = track[0]!;
    const today = isToday(first.appt, new Date(first.recorded_at));
    if (today) lanesToday += 1;
    // A lane the variant does not target keeps the current thresholds.
    const cfg = {
      ...ROUTING_DEFAULTS,
      floorMiles: today ? v.floorMiles : (v.otherFloor ?? ROUTING_DEFAULTS.floorMiles),
      fraction: today ? v.fraction : (v.otherFraction ?? ROUTING_DEFAULTS.fraction),
    };
    let cached: CachedRoute | null = null;
    let lastSweep = 0;
    for (const fix of track) {
      const at = new Date(fix.recorded_at);
      // The sweep runs every 30 s, not per fix.
      if (at.getTime() - lastSweep < 30_000) continue;
      lastSweep = at.getTime();
      const straight = haversineMiles(
        { lat: fix.lat, lng: fix.lng },
        { lat: fix.stop_lat, lng: fix.stop_lng },
      );
      if (straight < 0.5) continue; // MIN_ROUTABLE_MILES
      const reason = needsRecompute(
        cached,
        { truckLat: fix.lat, truckLng: fix.lng, stopLat: fix.stop_lat, stopLng: fix.stop_lng, provider: ROUTE_PROVIDER },
        at,
        cfg,
      );
      if (reason === null) continue;
      calls += 1;
      cached = {
        provider: ROUTE_PROVIDER,
        routedMiles: straight * 1.25,
        routedDurationS: (straight * 1.25 / 52) * 3600,
        fromLat: fix.lat, fromLng: fix.lng,
        straightAtRouteMiles: straight,
        laneRatio: 1.25,
        stopLat: fix.stop_lat, stopLng: fix.stop_lng,
        snapFromM: 5, snapToM: 5,
        computedAtUtc: at.toISOString(),
      };
    }
  }
  return { v, calls, lanesToday };
});

const base = results[0]!.calls;
const perDay = (c: number) => (c / HOURS) * 24;
console.log('rule                          calls   calls/day   /month(31d)   vs current   % of 3,000');
for (const r of results) {
  const d = perDay(r.calls);
  const m = d * 31;
  console.log(
    `${r.v.name.padEnd(28)} ${String(r.calls).padStart(6)} ${d.toFixed(1).padStart(11)} ${Math.round(m).toString().padStart(13)} ${(r.calls === base ? '—' : `${r.calls > base ? '+' : ''}${(((r.calls - base) / base) * 100).toFixed(0)}%`).padStart(12)} ${((m / 3000) * 100).toFixed(0).padStart(11)}%`,
  );
}
console.log(`\nlanes with an appointment inside 24h: ${results[0]!.lanesToday} of ${byTruck.size}`);
console.log('Ceiling is 3,000/month (§12.59). Worker restarts add ~24 calls each.');
await client.end();
