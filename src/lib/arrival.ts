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
 * So anything under 0.15 mi would never have fired on the one real arrival we
 * have. **0.25 mi (~400 m)** clears the measured case with roughly twice
 * the margin while staying about three city blocks — small enough that a
 * truck idling outside an unrelated building is not "arrived".
 *
 * ## Why the radius alone is not enough
 *
 * A truck stopped at a red light near the receiver satisfies "within radius
 * and not moving". What it does not satisfy is holding that for two minutes:
 * `confirmSeconds` is what separates a light from a dock. This feed delivers
 * a fix every 5–8 seconds, so 120 s is roughly 20 corroborating positions,
 * not two.
 */
export const ARRIVAL_DEFAULTS: ArrivalConfig = {
  radiusMiles: 0.25,
  confirmSeconds: 120,
};

export interface StopGeo {
  lat: number;
  lng: number;
  /**
   * §12.30. Arrival detection runs on `street` and NOTHING ELSE.
   *
   * The radius is 0.25 mi. A `block` coordinate is measured 0.16–0.78 mi
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

const isStopped = (fix: Fix): boolean => (fix.speedMph ?? 0) === 0;

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
      isStopped(fix) &&
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
  if ((fixes[0]!.speedMph ?? 0) <= 0) return null;

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
          : !isStopped(newest)
            ? 'moving'
            : // In range and stopped, but the run is not long enough yet —
              // the two-poll confirmation is the only thing left.
              'not-confirmed';

  return { miles, speedMph, blockedBy };
}
