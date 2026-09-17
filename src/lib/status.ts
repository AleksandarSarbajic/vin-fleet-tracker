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
  /** Null on every stop a dispatcher typed — see `etaAbsence`. */
  lat: number | null;
  lng: number | null;
}

export const OVERRIDE_REASONS = [
  'RECEIVER_CONFIRMED_DETENTION',
  'APPT_RESCHEDULED_BY_BROKER',
  'ELD_POSITION_WRONG',
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
  /** §12.24: the stop has no coordinates, so nothing can be projected. */
  | 'no-coordinates'
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
   * The ETA the engine would have produced for an UNASSIGNED truck. The row
   * renders it struck through, so the number is visible as history without
   * being read as a promise (§5.8).
   */
  lastComputedEtaUtc: string | null;
  /** `appointment_end_utc ?? appointment_start_utc` (§12.1). */
  deadlineUtc: string | null;
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
 * Phase 2 of the brief swaps this for a routing provider behind the same
 * signature — which is why it takes facts and returns an instant rather than
 * reaching for anything.
 */
export function projectEta(
  facts: TruckFacts,
  config: StatusConfig,
  now: Date,
): string | null {
  const stop = facts.stop;
  if (!stop || stop.lat === null || stop.lng === null) return null;
  if (facts.lat === null || facts.lng === null) return null;

  const miles = haversineMiles(
    { lat: facts.lat, lng: facts.lng },
    { lat: stop.lat, lng: stop.lng },
  );
  const hours = (miles * config.roadFactor) / config.avgSpeedMph;
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
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

  const etaUtc = projectEta(facts, config, now);
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
  else if (etaUtc === null) etaAbsence = 'no-coordinates';

  return {
    status: override ? override.forcedStatus : computed,
    computed,
    override,
    etaUtc: suppressed || computed === 'ARRIVED' ? null : etaUtc,
    etaAbsence,
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
      // §12.22: an FCFS stop has a door closing, not a slot to miss.
      if (
        stop?.apptType !== 'FCFS' &&
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
