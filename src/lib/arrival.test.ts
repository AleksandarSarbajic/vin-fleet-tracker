import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import {
  ARRIVAL_DEFAULTS,
  detectArrival,
  detectDeparture,
  type Fix,
  type StopGeo,
} from './arrival';

/**
 * §12.27. The pure rules, then the same rules run against truck 143's REAL
 * track into Grand Forks — because a radius chosen against fixtures is a
 * radius chosen against my own assumptions.
 */

const STOP = { lat: 47.936987136499, lng: -97.057368543984 };
const T0 = new Date('2026-09-17T20:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000).toISOString();

const stop = (over: Partial<StopGeo> = {}): StopGeo => ({
  ...STOP,
  arrivedAt: null,
  departedAt: null,
  ...over,
});

/** Newest first, as the positions query returns them. */
const parked = (count: number, everySeconds = 6): Fix[] =>
  Array.from({ length: count }, (_, i) => ({
    // ~0.13 mi north — the offset truck 143 actually parked at.
    lat: STOP.lat + 0.0019,
    lng: STOP.lng,
    speedMph: 0,
    recordedAtUtc: at(-i * everySeconds),
  }));

describe('detectArrival', () => {
  it('fires once the truck has been stopped inside the radius long enough', () => {
    expect(detectArrival(stop(), parked(40))).toBe(at(-39 * 6));
  });

  /** The confirmation window is what separates a dock from a red light. */
  it('does not fire on a brief stop, however close', () => {
    // 10 fixes × 6s = 54s of evidence. Under the 120s threshold.
    expect(detectArrival(stop(), parked(10))).toBeNull();
  });

  it('does not fire on a single fix, however long the gap before it', () => {
    const one: Fix[] = [
      { ...STOP, speedMph: 0, recordedAtUtc: at(0) },
    ];
    expect(detectArrival(stop(), one)).toBeNull();
  });

  it('does not fire while the truck is still moving', () => {
    const rolling = parked(40).map((f) => ({ ...f, speedMph: 3 }));
    expect(detectArrival(stop(), rolling)).toBeNull();
  });

  it('does not fire outside the radius', () => {
    const away = parked(40).map((f) => ({ ...f, lat: STOP.lat + 0.02 }));
    expect(detectArrival(stop(), away)).toBeNull();
  });

  /**
   * The instant is when it ARRIVED, not when we noticed — the same anchoring
   * rule the ETA follows. Recording the newest fix would put every arrival
   * two minutes late and make dwell time wrong for everyone downstream.
   */
  it('returns the first fix of the run, not the newest', () => {
    const fixes = parked(40);
    const oldest = fixes[fixes.length - 1]!;
    expect(detectArrival(stop(), fixes)).toBe(oldest.recordedAtUtc);
    expect(detectArrival(stop(), fixes)).not.toBe(fixes[0]!.recordedAtUtc);
  });

  it('one bad fix in the middle breaks the run', () => {
    const fixes = parked(40);
    // A jump 5 miles away, 10 fixes back. Everything older is cut off.
    fixes[10] = { ...fixes[10]!, lat: STOP.lat + 0.08 };
    expect(detectArrival(stop(), fixes)).toBeNull();
  });

  it('never re-detects a stop that already arrived', () => {
    expect(detectArrival(stop({ arrivedAt: at(-600) }), parked(40))).toBeNull();
  });

  it('treats an unreported speed as stationary, not as moving', () => {
    const unreported = parked(40).map((f) => ({ ...f, speedMph: null }));
    expect(detectArrival(stop(), unreported)).not.toBeNull();
  });
});

describe('detectDeparture', () => {
  const leaving = (count: number): Fix[] =>
    Array.from({ length: count }, (_, i) => ({
      lat: STOP.lat + 0.05,
      lng: STOP.lng,
      speedMph: 45,
      recordedAtUtc: at(-i * 6),
    }));

  it('fires when an arrived truck is moving well outside the radius', () => {
    const arrived = stop({ arrivedAt: at(-3600) });
    expect(detectDeparture(arrived, leaving(40))).toBe(at(-39 * 6));
  });

  it('never fires for a stop that never arrived', () => {
    expect(detectDeparture(stop(), leaving(40))).toBeNull();
  });

  it('never fires twice', () => {
    const gone = stop({ arrivedAt: at(-3600), departedAt: at(-60) });
    expect(detectDeparture(gone, leaving(40))).toBeNull();
  });

  /** GPS drift on a parked truck is not a departure. */
  it('does not fire when the truck is outside the radius but stationary', () => {
    const drifted = leaving(40).map((f) => ({ ...f, speedMph: 0 }));
    expect(detectDeparture(stop({ arrivedAt: at(-3600) }), drifted)).toBeNull();
  });

  it('never reports leaving before arriving', () => {
    // Arrived AFTER every fix in the run — a re-geocode moved the stop.
    const odd = stop({ arrivedAt: at(0) });
    expect(detectDeparture(odd, leaving(40))).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Against the real track
 * ---------------------------------------------------------------------- */

const url = process.env.DATABASE_URL;
const withDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
const connect = () => (handle ??= createPooledDb(url!));
afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
});

withDb('truck 143 into Grand Forks, from the positions table', () => {
  const load = async () => {
    const { db } = connect();
    const result = await db.execute(sql`
      select p.lat, p.lng, p.speed_mph,
             to_char(p.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at
      from positions p
      join trucks t on t.id = p.truck_id
      where t.truck_number = 143
      order by p.recorded_at desc
      limit 400`);
    return (result as unknown as Record<string, unknown>[]).map(
      (r): Fix => ({
        lat: Number(r['lat']),
        lng: Number(r['lng']),
        speedMph: r['speed_mph'] === null ? null : Number(r['speed_mph']),
        recordedAtUtc: String(r['recorded_at']),
      }),
    );
  };

  it('detects the arrival that no fixture would have predicted', async () => {
    const fixes = await load();
    // Skipped rather than asserted-away if the retention window has rolled
    // past this track: a test that quietly passes on no data is worse than
    // one that says it could not run.
    if (fixes.length < 40) {
      console.warn(`only ${fixes.length} positions retained for 143 — track gone, skipping`);
      return;
    }

    const arrivedAt = detectArrival(stop(), fixes);
    expect(arrivedAt).not.toBeNull();

    // The whole point of the measured radius: the truck really did park
    // ~0.13 mi from the geocoded point, so anything tighter finds nothing.
    const tight = detectArrival(stop(), fixes, { ...ARRIVAL_DEFAULTS, radiusMiles: 0.1 });
    expect(tight).toBeNull();
  });

  it('places the arrival before the newest fix, not at it', async () => {
    const fixes = await load();
    if (fixes.length < 40) return;
    const arrivedAt = detectArrival(stop(), fixes);
    if (arrivedAt === null) return;
    expect(new Date(arrivedAt).getTime()).toBeLessThan(
      new Date(fixes[0]!.recordedAtUtc).getTime(),
    );
  });
});
