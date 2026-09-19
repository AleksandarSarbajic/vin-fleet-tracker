import { haversineMiles } from './status';

/**
 * Arrival and departure detection. Pure — no I/O, no database, no clock.
 *
 * §12.27. `stops.arrived_at` and `stops.departed_at` have existed since phase
 * 1 and nothing has ever written them, so ARRIVED was unreachable and a truck
 * parked at its receiver read ON TIME forever. The engine was right; the
 * state simply never arrived.
 *
 * Everything here takes fixes as an argument for the same reason status.ts
 * does: this decides whether a stop is done, and a function that fetches is a
 * function nobody can test against a real track.
 */

export interface ArrivalConfig {
  /** How close counts as "at the stop". */
  radiusMiles: number;
  /**
   * At or below this, the truck counts as stopped. See `STOPPED_BELOW_MPH`.
   */
  stoppedBelowMph: number;
  /** How long the condition must hold before it is believed. */
  confirmSeconds: number;
}

/**
 * ## The radius, measured rather than guessed
 *
 * Truck 143 parked at its Grand Forks receiver and sat at **0.119–0.135 mi**
 * from the stop's coordinates for seven minutes at 0 mph. That distance is
 * the real gap between where a truck stops and where a geocoder puts the
 * address, and it is made of two things:
 *
 *  - Census returns a point interpolated along the street centreline from a
 *    house-number range (§12.24), not a parcel or a dock door.
 *  - Trucks park in a yard, which on a distribution centre is a few hundred
 *    metres of its own.
 *
 * ## The number, re-measured (§12.54)
 *
 * §12.27 sized this from ONE arrival — truck 143 at Grand Forks, 0.119–0.135
 * mi — and doubled it to 0.25. That measured a truck's parked jitter at one
 * facility, not the offset across facilities, and the offset is the thing the
 * radius has to clear.
 *
 * Re-measured over 89,101 fixes: a PARKING PLACE is one truck at speed 0,
 * fixes rounded to ~110 m, held 20 minutes or more; the distance is to the
 * nearest street-precision stop. 13 places, 8 trucks, 4 facilities:
 *
 *     0.101  0.103  0.116  0.123  0.124  0.128  0.133  0.152
 *     0.312  0.318  0.320  0.321  0.516
 *
 * The method reproduces §12.27 independently: two different trucks at that
 * same Grand Forks facility land at 0.128 and 0.133.
 *
 * **0.25 mi reaches 8 of 13. 0.35 reaches 12.** The binding case is Hazleton
 * at 0.3086–0.3124, held for the whole of a 249-minute dwell. 0.40 and 0.50
 * reach no further than 0.35 in this data, so 0.35 is the smallest value that
 * clears the measured cases with margin.
 *
 * §12.27's "twice the margin" heuristic is deliberately NOT reapplied: against
 * 0.312 it gives ~0.6 mi, which is three times the distance at which the
 * short stationary episodes already cluster.
 *
 * ## What the radius is actually sizing
 *
 * Not geocoder error. Without the dwell filter the closest single stationary
 * fix at Burlington is **0.0105 mi** — the truck passes within 17 metres of
 * the geocoded point and then parks 0.12 mi away. `route_samples.snap_to_m`
 * agrees: street destinations snap to a road in 0.0–12.9 m, average 5.4.
 *
 * The point is on the road centreline. Trucks drive over it and park off it.
 * So this number is **interpolation offset plus facility footprint**, and
 * parked-truck data cannot separate them. At one drop yard (275 W Laraway,
 * Joliet) the same facility spans 0.101 to 0.321.
 *
 * n=13 across 4 facilities is thin. Re-derive it on real loads.
 *
 * ## Why the radius alone is not enough
 *
 * A truck stopped at a red light near the receiver satisfies "within radius
 * and not moving". What it does not satisfy is holding that for two minutes:
 * `confirmSeconds` is what separates a light from a dock. This feed delivers
 * a fix every 5–8 seconds, so 120 s is roughly 20 corroborating positions,
 * not two.
 *
 * Measurement confirms `confirmSeconds` is carrying that load and the radius
 * never was. Of the stationary episodes over 120 s within a mile of a street
 * stop, widening 0.25 → 0.35 admits exactly ONE more short episode (2 minutes,
 * 4 fixes, at 0.316 mi) — because seven of the eight short episodes already
 * sit at 0.039–0.188 mi, geometrically inside the old circle. The red-light
 * exposure was never held off by the radius.
 */
/**
 * §12.56. "Stopped" is at or below a walking pace, not exactly zero.
 *
 * `=== 0` was too strict for the thing it was measuring. Truck 135's approach
 * reported 0.603, 1.856 and 2.482 mph on four fixes while it was manoeuvring
 * in the yard, and each one broke a confirmation run — so a truck that had
 * genuinely arrived kept restarting its own two-minute clock.
 *
 * ## The number
 *
 * Measured over the fixes of trucks that were demonstrably parked (a dwell of
 * 20 minutes or more, bounded by anything above 3 mph). **7.8% of fixes from a
 * stationary truck report a non-zero speed:**
 *
 *     exactly 0   92.17%          1 < v <= 1.5   0.72%
 *     0 < v <= .5  3.53%        1.5 < v <= 2     0.77%
 *     .5 < v <= 1  1.97%          2 < v <= 2.5   0.51%
 *                                2.5 < v <= 3    0.31%
 *
 * A tolerance of 3 captures 99.98% of them; 2 captures 99.16% and would still
 * have been broken by truck 135's 2.482.
 *
 * ## What it costs, measured rather than reasoned
 *
 * Runs of at least 120 s within 0.35 mi of a street stop — the ones that
 * would actually confirm — counted at every tolerance:
 *
 *     tolerance   0     1     2     3     5
 *     runs       22    22    22    22    19
 *
 * **Flat.** The tolerance admits no new confirmable runs; it merges fragments
 * of the same events into longer ones, which is the entire intent. (The drop
 * at 5 is more merging, not fewer events.)
 *
 * And the geometric bound: at 3 mph a truck covers **161 m** during the
 * 120-second window, against a 563 m radius. It cannot drift in from outside
 * and confirm — `confirmedRun` only counts fixes that are inside the radius
 * AND slow, so the clock starts at the boundary and the truck is 161 m deeper
 * by the end. A confirmed arrival means 120 unbroken seconds within 0.35 mi
 * at no more than a brisk walk, which is what being at a receiver looks like.
 *
 * 5 mph was rejected on that bound alone: 268 m is half the radius.
 */
export const STOPPED_BELOW_MPH = 3;

const isStopped = (fix: Fix, config: ArrivalConfig): boolean =>
  (fix.speedMph ?? 0) <= config.stoppedBelowMph;

export const ARRIVAL_DEFAULTS: ArrivalConfig = {
  radiusMiles: 0.35,
  confirmSeconds: 120,
  stoppedBelowMph: STOPPED_BELOW_MPH,
};

export interface StopGeo {
  lat: number;
  lng: number;
  /**
   * §12.30. Arrival detection runs on `street` and NOTHING ELSE.
   *
   * The radius is 0.35 mi (§12.54). A `block` coordinate is measured 0.16–0.78 mi
   * from truth and a `zip` centroid a median 2.14 mi, so a 0.25 mi circle
   * around either is noise: it would mark trucks ARRIVED four miles from the
   * dock, and §12.27 never unsets `arrived_at`. A wrong arrival is not a
   * cosmetic error — it removes the stop from every urgency signal that
   * would otherwise chase it.
   *
   * Null means the stop has no coordinates at all, which also cannot arrive.
   */
  precision: 'street' | 'block' | 'zip' | null;
  /** Already arrived. Never re-detected, never unset by the worker. */
  arrivedAt: string | null;
  departedAt: string | null;
}

export interface Fix {
  lat: number;
  lng: number;
  /** Samsara reports 0 on a stationary vehicle. Null is "not reported". */
  speedMph: number | null;
  recordedAtUtc: string;
}

/** `fixes` are NEWEST FIRST, exactly as `order by recorded_at desc` returns. */
function confirmedRun(
  fixes: Fix[],
  config: ArrivalConfig,
  holds: (fix: Fix) => boolean,
): Fix[] | null {
  /**
   * The LONGEST qualifying run anywhere in the window, not the one at the head
   * (§12.41).
   *
   * This used to `break` on the first fix that failed, so the run had to start
   * at the newest fix — the truck had to still be there. Truck 116 parked at
   * its receiver for 21 minutes while the worker was stalled (§12.39); by the
   * time it polled again the truck had left, the newest fix was moving, and
   * the dwell sitting two fixes behind it could never be found. The arrival
   * was lost permanently.
   *
   * §12.27 claimed the 30-minute window bounded post-outage inaccuracy. It did
   * not, and could not: the window decides how far back we LOOK, and this
   * decided that looking back was pointless.
   *
   * Scanning the whole window costs one pass over at most a few dozen fixes
   * and makes an arrival recoverable for as long as its evidence is retained.
   */
  let best: Fix[] | null = null;
  let run: Fix[] = [];

  const close = () => {
    if (qualifies(run, config) && (best === null || run.length > best.length)) {
      best = run;
    }
    run = [];
  };

  for (const fix of fixes) {
    if (holds(fix)) run.push(fix);
    else close();
  }
  close();

  return best;
}

/** Both the count and the span have to clear, or a burst of readings passes. */
function qualifies(run: Fix[], config: ArrivalConfig): boolean {
  // Two fixes six seconds apart are not two minutes of evidence.
  if (run.length < 2) return false;
  const newest = run[0]!;
  const oldest = run[run.length - 1]!;
  const spanSeconds =
    (new Date(newest.recordedAtUtc).getTime() - new Date(oldest.recordedAtUtc).getTime()) / 1000;
  return spanSeconds >= config.confirmSeconds;
}


/**
 * When the truck arrived, or null.
 *
 * The instant returned is the OLDEST fix of the confirmed run, not the newest
 * and never the poll's own clock. The confirmation window is how we became
 * sure; the first stationary fix inside the radius is when it actually
 * happened. Recording the moment we noticed instead would put every arrival
 * two minutes late and make dwell time wrong for everyone downstream — the
 * same anchoring rule the ETA follows (§12.24).
 */
export function detectArrival(
  stop: StopGeo,
  fixes: Fix[],
  config: ArrivalConfig = ARRIVAL_DEFAULTS,
): string | null {
  if (stop.arrivedAt !== null) return null;
  // Coarse coordinates cannot be arrived at, however close the truck gets.
  if (stop.precision !== 'street') return null;

  const run = confirmedRun(
    fixes,
    config,
    (fix) =>
      isStopped(fix, config) &&
      haversineMiles({ lat: fix.lat, lng: fix.lng }, { lat: stop.lat, lng: stop.lng }) <=
        config.radiusMiles,
  );
  return run ? run[run.length - 1]!.recordedAtUtc : null;
}

/**
 * When the truck left, or null.
 *
 * §12.13's next-stop rule is "lowest sequence with no departed_at", so
 * without this a truck never advances to its second stop however far away it
 * drives.
 *
 * Requires an arrival first — you cannot leave somewhere you were never
 * recorded as reaching — and requires the newest fix to be MOVING. Being
 * outside the radius is not departure on its own: a parked truck whose GPS
 * wanders, or one whose stop was re-geocoded further away, is not leaving.
 */
export function detectDeparture(
  stop: StopGeo,
  fixes: Fix[],
  config: ArrivalConfig = ARRIVAL_DEFAULTS,
): string | null {
  if (stop.arrivedAt === null || stop.departedAt !== null) return null;
  // Symmetric with arrival: a coarse coordinate cannot be left either, and
  // an arrival it could not have produced is a dispatcher's to undo.
  if (stop.precision !== 'street') return null;
  if (fixes.length === 0) return null;
  /**
   * §12.56. The complement of `isStopped`, not `> 0`.
   *
   * Once "stopped" means "at or below a walking pace", "moving" has to mean
   * the same threshold from the other side. Leaving this at `> 0` would make
   * a truck creeping at 2 mph neither stopped nor moving — able to satisfy
   * the departure test while still in the yard.
   */
  if (isStopped(fixes[0]!, config)) return null;

  const run = confirmedRun(
    fixes,
    config,
    (fix) =>
      haversineMiles({ lat: fix.lat, lng: fix.lng }, { lat: stop.lat, lng: stop.lng }) >
      config.radiusMiles,
  );
  if (!run) return null;

  // Never claim it left before it arrived, whatever the fixes say.
  const left = run[run.length - 1]!.recordedAtUtc;
  return new Date(left) > new Date(stop.arrivedAt) ? left : null;
}

/**
 * Why the nearest candidate did NOT arrive (§12.36).
 *
 * `arrived: 0` means two completely different things — every truck is
 * hundreds of miles away, or one is sitting in the receiver's yard and the
 * rule is one poll short — and the log could not tell them apart. Arrival
 * detection ran for a week reporting zero, and nothing in that number said
 * whether it was working.
 */
export type ArrivalBlock =
  | 'too-far'
  | 'moving'
  | 'not-confirmed'
  | 'coarse-precision'
  | 'already-arrived';

export interface NearestCandidate {
  stopId: string;
  truckNumber: number | null;
  miles: number;
  speedMph: number | null;
  blockedBy: ArrivalBlock;
}

/**
 * How close this truck GOT within the window, and what stopped it counting.
 *
 * The closest fix, not the newest one. "How close did it get" is the question
 * a silent sweep has to answer, and the newest fix cannot answer it: a truck
 * that pulled into the yard and left again reads as far away, which is the
 * same reading as never having been there.
 */
export function explainNearest(
  stop: StopGeo,
  fixes: Fix[],
  config: ArrivalConfig = ARRIVAL_DEFAULTS,
): { miles: number; speedMph: number | null; blockedBy: ArrivalBlock } | null {
  if (fixes.length === 0) return null;

  let closest = fixes[0]!;
  let miles = haversineMiles(
    { lat: closest.lat, lng: closest.lng },
    { lat: stop.lat, lng: stop.lng },
  );
  for (const fix of fixes) {
    const d = haversineMiles({ lat: fix.lat, lng: fix.lng }, { lat: stop.lat, lng: stop.lng });
    if (d < miles) {
      miles = d;
      closest = fix;
    }
  }
  const newest = closest;
  const speedMph = closest.speedMph;

  const blockedBy: ArrivalBlock =
    stop.arrivedAt !== null
      ? 'already-arrived'
      : stop.precision !== 'street'
        ? 'coarse-precision'
        : miles > config.radiusMiles
          ? 'too-far'
          : !isStopped(newest, config)
            ? 'moving'
            : // In range and stopped, but the run is not long enough yet —
              // the two-poll confirmation is the only thing left.
              'not-confirmed';

  return { miles, speedMph, blockedBy };
}
