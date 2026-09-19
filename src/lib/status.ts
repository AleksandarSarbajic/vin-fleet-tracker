import {
  metresToMiles,
  projectDistance,
  type CachedRoute,
  type DistanceBasis,
  type Projection,
} from './routing';
/**
 * The status engine.
 *
 * PURE. No I/O, no database, no clock of its own — every input arrives as an
 * argument, `now` included. This is the file that decides whether a dispatcher
 * phones a broker at 4am, and an engine that fetches is an engine nobody can
 * test at 4am.
 *
 * It emits a semantic status. The UI maps that status to a token; no colour
 * value appears anywhere in this file.
 *
 * The array order is ALSO the urgency sort order, top to bottom.
 */
export const STATUSES = [
  'LATE',
  'STALE_GPS',
  'UNASSIGNED',
  'AT_RISK',
  'NO_APPT',
  'ARRIVED',
  'ON_TIME',
  'TOMORROW',
] as const;

export type Status = (typeof STATUSES)[number];

/** Rank in the urgency sort. Lower sorts higher. */
export function urgencyRank(status: Status): number {
  return STATUSES.indexOf(status);
}

/**
 * design-spec §12.5. These five never cluster on the map, and they are what
 * "0 problems below the fold" counts. ARRIVED, ON_TIME and TOMORROW are not
 * problems.
 */
const PROBLEM = new Set<Status>([
  'LATE',
  'STALE_GPS',
  'UNASSIGNED',
  'AT_RISK',
  'NO_APPT',
]);

export function isProblem(status: Status): boolean {
  return PROBLEM.has(status);
}

/** Everything that is not a problem clusters, ARRIVED included (§12.5). */
export function clusters(status: Status): boolean {
  return !isProblem(status);
}

export const STATUS_LABEL: Record<Status, string> = {
  LATE: 'Late',
  STALE_GPS: 'Stale GPS',
  UNASSIGNED: 'Unassigned',
  AT_RISK: 'At risk',
  NO_APPT: 'No appt',
  ARRIVED: 'Arrived',
  ON_TIME: 'On time',
  TOMORROW: 'Tomorrow',
};

/* ------------------------------ the engine ------------------------------ */

/**
 * Every number the engine uses, in one object (PROJECT_BRIEF). No magic
 * numbers in the rules below.
 *
 * `lateThresholdMinutes` is deliberately absent — §12.1 retired it. The brief
 * stacked a 30-minute grace on top of a ±30 window, which is 90 minutes of
 * slack measured from the start time. The window IS the grace.
 */
export interface StatusConfig {
  /** §12.1. AT_RISK is an ETA within this of the deadline. */
  riskBufferMinutes: number;
  /** §12.3, per-truck. Drives STALE_GPS. */
  staleMinutes: number;
  /** §12.3, fleet-wide. Drives the §5.9 colour withdrawal, not a status. */
  feedStaleMinutes: number;
  avgSpeedMph: number;
  /** Straight line × this ≈ road miles. */
  roadFactor: number;
  /** TOMORROW is measured in THIS zone. Not the stop's, not the browser's. */
  dispatchTz: string;
}

export const STATUS_DEFAULTS = {
  riskBufferMinutes: 45,
  staleMinutes: 45,
  feedStaleMinutes: 5,
  avgSpeedMph: 52,
  roadFactor: 1.25,
} as const satisfies Omit<StatusConfig, 'dispatchTz'>;

export interface StopFacts {
  /** APPT: the appointment. FCFS: the earliest receiving hour (§12.22). */
  apptStartUtc: string | null;
  /** APPT: end of the ± window. FCFS: the latest hour — the deadline. */
  apptEndUtc: string | null;
  apptType: 'APPT' | 'FCFS';
  arrivedAt: string | null;
  /**
   * §12.57. Which KIND of claim `arrivedAt` is — measured, or asserted by a
   * person. Null exactly when `arrivedAt` is, enforced by a check constraint.
   * Nothing in the engine branches on it: a hand-marked arrival is as
   * arrived as a detected one, and pretending otherwise would give the board
   * two kinds of ARRIVED. It rides through so the row and the detail can say
   * which one a dispatcher is looking at.
   */
  arrivedSource: ArrivalSource | null;
  /**
   * Written only by the forward geocoder (§12.24). Null when the address
   * could not be located, or when there is no address at all — `hasAddress`
   * tells those two apart, and the row says which.
   */
  lat: number | null;
  lng: number | null;
  /**
   * How well we know where this is. `street` is interpolated along the
   * matched street segment; `city` is a centroid, several miles wide.
   *
   * Nothing branches on this yet, deliberately. It rides alongside the status
   * so that a future rule can be more cautious about a LATE built on a city
   * centroid — which is the one that puts a dispatcher on the phone to a
   * broker — without having to re-plumb the engine to find out.
   */
  precision: 'street' | 'block' | 'zip' | null;
  /** The ± on those coordinates, when they are not a street match. */
  accuracyMiles: number | null;
  /** True when a dispatcher typed an address, located or not. */
  hasAddress: boolean;
  /**
   * The cached route for this lane (§12.31), or null. Passed in as data like
   * everything else — the engine never routes, and a routing call in here
   * would be a routing call per render.
   */
  route: CachedRoute | null;
  /** True when that route was computed from the truck's CURRENT position. */
  routeFresh: boolean;
}

/**
 * §12.57. Which writer put the timestamp in `stops.arrived_at`.
 *
 * `detected` is a measurement — a GPS fix inside the radius, below the speed
 * threshold, held across two polls. `dispatcher` is a belief, typed by
 * someone who may have it from a phone call. Both are legitimate; telling
 * them apart is not optional, because only one of them can be wrong in a way
 * nothing else on the board would contradict.
 */
export const ARRIVAL_SOURCES = ['detected', 'dispatcher'] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];

export const OVERRIDE_REASONS = [
  'RECEIVER_CONFIRMED_DETENTION',
  'APPT_RESCHEDULED_BY_BROKER',
  'ELD_POSITION_WRONG',
  /** §12.58. The stop's coordinate cannot register an arrival — not the ELD. */
  'ARRIVAL_NOT_DETECTED',
  'DRIVER_REPORTED_DELAY',
  'OTHER',
] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

/** Only the three the modal's segmented control offers (§9.5). */
export const FORCED_STATUSES = ['LATE', 'ARRIVED', 'NO_APPT'] as const;
export type ForcedStatus = (typeof FORCED_STATUSES)[number];

export interface OverrideFacts {
  forcedStatus: ForcedStatus;
  reason: OverrideReason;
  reasonNote: string | null;
  setByName: string | null;
  setAtUtc: string;
  /** Mandatory. There is no "never" (§9.5). */
  expiresAtUtc: string;
}

export interface TruckFacts {
  lat: number | null;
  lng: number | null;
  /** Newest GPS fix. Null for a truck that has never reported. */
  recordedAtUtc: string | null;
  /** An open `assignments` row. UNASSIGNED is computed, never stored. */
  hasDriver: boolean;
  /** The next stop by §12.13, or null when the truck holds no open load. */
  stop: StopFacts | null;
  /** The newest uncleared override, if any. Expiry is checked HERE. */
  override: OverrideFacts | null;
}

/**
 * Why there is no ETA. The UI prints the reason rather than an em dash: a
 * dispatcher has to be able to tell "we can't project this" from "nothing
 * here yet", and the two look identical as a dash.
 */
export type EtaAbsence =
  | 'has-eta'
  | 'arrived'
  | 'no-appointment'
  /**
   * §12.24. Two reasons, not one, because a dispatcher has to be able to
   * tell them apart at a glance:
   *
   *   `address-not-located` — an address was typed and the geocoder could
   *                           not place it. Somebody should look at it.
   *   `no-address`          — nothing was entered yet. Normal, and nobody's
   *                           fault.
   *
   * As a single `no-coordinates` these read identically, and the one that
   * needs attention hides behind the one that does not.
   */
  | 'address-not-located'
  | 'no-address'
  /** An ETA for a truck with no driver is fiction (§5.8). */
  | 'suppressed-unassigned';

export interface StatusResult {
  /** What the row shows. The forced status when an override is live. */
  status: Status;
  /** What the engine itself computed, always, override or not (§9.5). */
  computed: Status;
  /** Live only — an expired override is not returned (expiry on read). */
  override: OverrideFacts | null;
  etaUtc: string | null;
  etaAbsence: EtaAbsence;
  /**
   * Straight-line miles from the truck's last position to the stop, already
   * computed to produce the ETA. Null whenever the ETA is null.
   */
  milesRemaining: number | null;
  /** Weighed by the AT_RISK rule, and by the worker's arrival detection. */
  precision: 'street' | 'block' | 'zip' | null;
  /** The ± to print beside a coarse ETA. Null for a street match. */
  accuracyMiles: number | null;
  /**
   * §12.57. Which kind of arrival this is, for the row and the detail. Null
   * when the truck has not arrived — and null for an override forcing
   * ARRIVED, which sets no timestamp and is not an arrival.
   */
  arrivedSource: ArrivalSource | null;
  /** Routed, estimated from an earlier route, or straight-line (§12.31). */
  distanceBasis: DistanceBasis;
  /** The measured road factor used, when there was one. */
  laneRatio: number | null;
  /** How far the provider moved the stop to reach a road, in metres. */
  snapMeters: number | null;
  /**
   * The ETA the engine would have produced for an UNASSIGNED truck. The row
   * renders it struck through, so the number is visible as history without
   * being read as a promise (§5.8).
   */
  lastComputedEtaUtc: string | null;
  /** `appointment_end_utc ?? appointment_start_utc` (§12.1). */
  deadlineUtc: string | null;
}

/** Coordinate error and snap error, added — see the note at the call site. */
function combinedAccuracy(stop: StopFacts | null | undefined): number | null {
  if (!stop) return null;
  const snapMiles =
    stop.route?.snapToM !== null && stop.route?.snapToM !== undefined ? metresToMiles(stop.route.snapToM) : null;
  if (stop.accuracyMiles === null && snapMiles === null) return null;
  return (stop.accuracyMiles ?? 0) + (snapMiles ?? 0);
}

const MINUTE = 60_000;
const EARTH_MILES = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle miles. */
export function haversineMiles(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Straight line × road factor ÷ average speed, from the truck's last known
 * position (PROJECT_BRIEF). Null when either end has no coordinates.
 *
 * ## The ETA is anchored to the POSITION, not to the clock
 *
 * It departs from `recordedAtUtc` — the instant the GPS fix was taken — not
 * from `now`. This is deliberate and it is load-bearing.
 *
 * `now + travelTime` looks equivalent and is not. It means a truck whose feed
 * froze forty minutes ago has an ETA that slides forward forever: every read
 * re-promises a truck that has not moved, and the board quietly stays
 * optimistic about the one vehicle nobody can see. That is an ETA drifting
 * away from the position it was computed from, with nothing to stop it.
 *
 * Anchoring makes the drift impossible rather than policed. The ETA becomes a
 * pure function of (position, stop coordinates, config), so it cannot
 * disagree with its position — it IS its position, moved forward by the
 * distance left. It changes when and only when a new fix lands, which is what
 * "recompute on each position update" means when there is nothing to
 * recompute. And because `now` is not an input, two renders a second apart
 * produce the same string, which is the hydration-mismatch class closed off
 * at the source rather than patched at the seam.
 *
 * On a fresh fix the two differ by under a minute. On a frozen one the ETA
 * sits in the past, which is honest — and STALE_GPS is already saying so.
 *
 * Phase 2 of the brief swaps this for a routing provider behind the same
 * signature — which is why it takes facts and returns an instant rather than
 * reaching for anything.
 */
export function projectEta(facts: TruckFacts, config: StatusConfig): string | null {
  const projection = project(facts, config);
  return projection?.etaUtc ?? null;
}

/** Miles and ETA together: the distance is computed to produce the time. */
export function project(
  facts: TruckFacts,
  config: StatusConfig,
): { etaUtc: string; miles: number; projection: Projection } | null {
  const stop = facts.stop;
  if (!stop || stop.lat === null || stop.lng === null) return null;
  if (facts.lat === null || facts.lng === null) return null;
  // No fix, no anchor. A truck that has never reported cannot be projected.
  if (facts.recordedAtUtc === null) return null;

  const straight = haversineMiles(
    { lat: facts.lat, lng: facts.lng },
    { lat: stop.lat, lng: stop.lng },
  );

  /**
   * §12.31. `config.roadFactor` is now only the LAST resort. It is the
   * brief's 1.25, which measurement showed to be wrong by up to 162 minutes
   * on a real lane — the spread across our own lanes was 1.070 to 1.460, and
   * no single constant improves it. A route, or a ratio measured from an
   * earlier route on the same lane, beats it every time.
   */
  const projection = projectDistance(
    straight,
    stop.route,
    config.roadFactor,
    config.avgSpeedMph,
    stop.routeFresh,
  );

  const hours = projection.miles / projection.speedMph;
  const from = new Date(facts.recordedAtUtc).getTime();
  if (Number.isNaN(from)) return null;

  return {
    etaUtc: new Date(from + hours * 3_600_000).toISOString(),
    miles: projection.miles,
    projection,
  };
}

/** The calendar date in a zone, as YYYY-MM-DD. */
export function calendarDayInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function isLiveOverride(override: OverrideFacts | null, now: Date): boolean {
  if (!override) return false;
  // Expiry is evaluated ON READ, never by a scheduled job that might not run
  // (§9.5). At expiry the row silently returns to its computed status.
  return new Date(override.expiresAtUtc).getTime() > now.getTime();
}

/**
 * The whole engine.
 *
 * Precedence is NOT urgency rank — see §12.25. Rank orders the list; this
 * orders the questions, and the two disagree in exactly one place, on purpose.
 */
export function evaluate(
  facts: TruckFacts,
  config: StatusConfig,
  now: Date,
): StatusResult {
  const stop = facts.stop;
  const deadlineUtc = stop ? (stop.apptEndUtc ?? stop.apptStartUtc) : null;
  const hasAppointment = Boolean(stop?.apptStartUtc);

  const projection = project(facts, config);
  const etaUtc = projection?.etaUtc ?? null;
  const computed = computeStatus(facts, config, now, {
    hasAppointment,
    deadlineUtc,
    etaUtc,
  });

  const override = isLiveOverride(facts.override, now) ? facts.override : null;

  /** §5.8: an ETA for a truck with no driver is fiction. Kept, not shown. */
  const suppressed = computed === 'UNASSIGNED';

  let etaAbsence: EtaAbsence = 'has-eta';
  if (computed === 'ARRIVED') etaAbsence = 'arrived';
  else if (suppressed) etaAbsence = 'suppressed-unassigned';
  else if (!hasAppointment) etaAbsence = 'no-appointment';
  else if (etaUtc === null) {
    // §12.24: which kind of nothing this is. An address that failed to
    // locate needs somebody to look at it; an empty one does not.
    etaAbsence = stop?.hasAddress ? 'address-not-located' : 'no-address';
  }

  const shown = suppressed || computed === 'ARRIVED' ? null : etaUtc;

  return {
    status: override ? override.forcedStatus : computed,
    computed,
    override,
    etaUtc: shown,
    etaAbsence,
    // Miles follow the ETA exactly. A distance shown next to a withheld time
    // would be the same fiction the suppression exists to avoid (§5.8).
    milesRemaining: shown === null ? null : (projection?.miles ?? null),
    precision: stop?.precision ?? null,
    /**
     * A snapped waypoint compounds with a coarse coordinate: a ZIP centroid
     * 4.4 mi wide, routed from a point the provider moved 0.25 mi to reach a
     * road, is not the same number as a street route. Both are added, so the
     * ± a dispatcher reads describes the whole construction.
     */
    accuracyMiles: combinedAccuracy(stop),
    /** §12.57. Carried, never branched on — see the note on StopFacts. */
    arrivedSource: stop?.arrivedSource ?? null,
    distanceBasis: projection?.projection.basis ?? 'straight-line',
    laneRatio: projection?.projection.laneRatio ?? null,
    snapMeters: stop?.route?.snapToM ?? null,
    lastComputedEtaUtc: suppressed ? etaUtc : null,
    deadlineUtc,
  };
}

function computeStatus(
  facts: TruckFacts,
  config: StatusConfig,
  now: Date,
  ctx: { hasAppointment: boolean; deadlineUtc: string | null; etaUtc: string | null },
): Status {
  const stop = facts.stop;

  // 1. ARRIVED wins outright, however late the truck was. Lateness is then
  //    history, and the row stops competing for attention at the top of the
  //    list.
  if (stop?.arrivedAt) return 'ARRIVED';

  // 2. No live appointment: nothing to be early or late for. §12.3 —
  //    Samsara gateways report on ignition, so a parked truck with no load
  //    goes quiet for hours and must NOT read as a data problem.
  if (!ctx.hasAppointment) return 'NO_APPT';

  // 3. Allocation before measurement (§12.25). An unassigned truck is
  //    usually parked and therefore usually also stale; reporting STALE_GPS
  //    would describe the symptom and hide the cause.
  if (!facts.hasDriver) return 'UNASSIGNED';

  // 4. A truck that is being driven, whose position we no longer trust.
  if (isStale(facts.recordedAtUtc, config.staleMinutes, now)) return 'STALE_GPS';

  // 5-6. §12.1: the deadline is the end of the window, and the window is the
  //      grace. Where no ETA can be projected the clock is the only signal
  //      available, so LATE falls back to it and AT_RISK does not fire —
  //      there is nothing honest to be at risk against (§12.24).
  const deadline = ctx.deadlineUtc ? new Date(ctx.deadlineUtc).getTime() : null;
  if (deadline !== null) {
    const projected = ctx.etaUtc ? new Date(ctx.etaUtc).getTime() : null;

    if (projected !== null) {
      if (projected > deadline) return 'LATE';
      /**
       * §12.30: AT_RISK needs a coordinate the buffer can outrun.
       *
       * The buffer is 45 minutes. A ZIP centroid sits a median 2.14 mi and a
       * p90 5.51 mi from the real address, which is 3 to 8 minutes of ETA —
       * a fraction of the buffer, but AT_RISK is a statement about the last
       * 45 minutes specifically, and inside that window the error is a
       * meaningful share of what is being measured. "He might just miss it"
       * computed from a point four miles from the dock is a guess wearing a
       * number.
       *
       * LATE is different and stays: at hours out, being past the deadline
       * survives five miles of error comfortably, and being late is the fact
       * a dispatcher must act on.
       *
       * `block` keeps AT_RISK — measured at 0.16–0.78 mi, under a minute.
       */
      if (
        stop?.apptType !== 'FCFS' &&
        stop?.precision !== 'zip' &&
        projected > deadline - config.riskBufferMinutes * MINUTE
      ) {
        return 'AT_RISK';
      }
    } else if (now.getTime() > deadline) {
      return 'LATE';
    }
  }

  // 7. TOMORROW is a calendar question, asked in the DISPATCH zone.
  if (stop?.apptStartUtc) {
    const appointmentDay = calendarDayInZone(new Date(stop.apptStartUtc), config.dispatchTz);
    if (appointmentDay > calendarDayInZone(now, config.dispatchTz)) return 'TOMORROW';
  }

  return 'ON_TIME';
}

/** No fix at all counts as stale — we have nothing to trust either way. */
function isStale(recordedAtUtc: string | null, staleMinutes: number, now: Date): boolean {
  if (!recordedAtUtc) return true;
  return now.getTime() - new Date(recordedAtUtc).getTime() > staleMinutes * MINUTE;
}

/**
 * §5.9, fleet-wide: when the FEED is stale the client withdraws schedule
 * colour from every row. A different failure from STALE_GPS and a different
 * threshold (§12.3) — one truck's gateway versus the whole pipe.
 */
export function isFeedStale(
  newestPositionAtUtc: string | null,
  config: Pick<StatusConfig, 'feedStaleMinutes'>,
  now: Date,
): boolean {
  if (!newestPositionAtUtc) return true;
  return (
    now.getTime() - new Date(newestPositionAtUtc).getTime() >
    config.feedStaleMinutes * MINUTE
  );
}
