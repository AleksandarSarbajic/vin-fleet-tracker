import { describe, expect, it } from 'vitest';
import {
  STATUS_DEFAULTS,
  calendarDayInZone,
  evaluate,
  haversineMiles,
  isFeedStale,
  projectEta,
  type StatusConfig,
  type StopFacts,
  type TruckFacts,
} from './status';

/**
 * The engine, which is the file that decides whether a dispatcher phones a
 * broker at 4am.
 *
 * Every instant here is DERIVED from a fixed `now` or from a measured DST
 * boundary. Nothing is pasted from a calendar, because a pasted date is
 * correct until the year turns.
 */

const DISPATCH_TZ = 'America/Chicago';
const config: StatusConfig = { ...STATUS_DEFAULTS, dispatchTz: DISPATCH_TZ };

/** A fixed instant to measure everything from: noon UTC, an ordinary day. */
const NOW = new Date('2026-09-18T12:00:00.000Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

/** New Lenox IL, and a truck 40 miles out — under an hour at 52mph × 1.25. */
const STOP_COORDS = { lat: 41.5117, lng: -87.9656 };
const NEARBY = { lat: 41.7, lng: -88.4 };

const stop = (over: Partial<StopFacts> = {}): StopFacts => ({
  apptStartUtc: at(240),
  apptEndUtc: null,
  apptType: 'APPT',
  arrivedAt: null,
  ...STOP_COORDS,
  ...over,
});

const truck = (over: Partial<TruckFacts> = {}): TruckFacts => ({
  ...NEARBY,
  recordedAtUtc: at(-2),
  hasDriver: true,
  stop: stop(),
  override: null,
  ...over,
});

const statusOf = (facts: Partial<TruckFacts>, now = NOW) =>
  evaluate(truck(facts), config, now).status;

describe('precedence', () => {
  it('ARRIVED wins once arrived_at is set, however late the truck was', () => {
    // The stop was missed by two hours and the truck is still there.
    const missed = truck({
      stop: stop({ apptStartUtc: at(-120), arrivedAt: at(-30) }),
    });
    expect(evaluate(missed, config, NOW).status).toBe('ARRIVED');
    // Lateness became history: the row stops competing at the top of the list.
    expect(evaluate(missed, config, NOW).computed).toBe('ARRIVED');
  });

  it('a parked truck with no load is NO_APPT, never STALE_GPS (§12.3)', () => {
    // Samsara gateways report on ignition, so a legitimately parked truck
    // goes quiet for hours. That is not a data problem.
    expect(statusOf({ stop: null, recordedAtUtc: at(-60 * 20) })).toBe('NO_APPT');
    expect(statusOf({ stop: stop({ apptStartUtc: null }), recordedAtUtc: null })).toBe(
      'NO_APPT',
    );
  });

  it('UNASSIGNED beats STALE_GPS — the cause, not the symptom (§12.25)', () => {
    // Urgency RANK puts STALE_GPS above UNASSIGNED; precedence deliberately
    // does not. An unassigned truck is usually parked and therefore usually
    // also stale, and "Stale GPS" would hide the fact that nobody is driving.
    const both = truck({ hasDriver: false, recordedAtUtc: at(-60 * 6) });
    expect(evaluate(both, config, NOW).status).toBe('UNASSIGNED');
  });

  it('STALE_GPS applies to a truck that HAS a driver and a live appointment', () => {
    expect(statusOf({ recordedAtUtc: at(-config.staleMinutes - 1) })).toBe('STALE_GPS');
    expect(statusOf({ recordedAtUtc: at(-config.staleMinutes + 1) })).not.toBe('STALE_GPS');
  });

  it('treats a truck that has never reported as stale', () => {
    expect(statusOf({ recordedAtUtc: null })).toBe('STALE_GPS');
  });
});

describe('the deadline (§12.1)', () => {
  it('is the end of the window when there is one', () => {
    const windowed = truck({
      stop: stop({ apptStartUtc: at(60), apptEndUtc: at(120) }),
    });
    expect(evaluate(windowed, config, NOW).deadlineUtc).toBe(at(120));
  });

  it('falls back to the start time for an exact appointment', () => {
    expect(evaluate(truck(), config, NOW).deadlineUtc).toBe(at(240));
  });

  it('is LATE at 15:01 on a 14:00–15:00 window, with no extra grace', () => {
    // The window IS the grace. A truck projected one minute past the close is
    // late, which is what a receiver means by it.
    const far = { lat: 34.0, lng: -118.2 }; // ~1,700 miles out: hours of ETA.
    const late = truck({ ...far, stop: stop({ apptStartUtc: at(-60), apptEndUtc: at(1) }) });
    expect(evaluate(late, config, NOW).status).toBe('LATE');
  });

  it('is AT_RISK inside the 45-minute buffer and ON_TIME outside it', () => {
    // Distance fixed; the deadline moves. ~40 miles ≈ 58 minutes at 52mph×1.25.
    const etaMinutes = Math.round(
      (haversineMiles(NEARBY, STOP_COORDS) * config.roadFactor * 60) / config.avgSpeedMph,
    );
    const tight = truck({ stop: stop({ apptStartUtc: at(etaMinutes + 20) }) });
    const roomy = truck({ stop: stop({ apptStartUtc: at(etaMinutes + 120) }) });
    expect(evaluate(tight, config, NOW).status).toBe('AT_RISK');
    expect(evaluate(roomy, config, NOW).status).toBe('ON_TIME');
  });
});

describe('FCFS (§12.22)', () => {
  const receiving = (from: number, to: number) =>
    stop({ apptStartUtc: at(from), apptEndUtc: at(to), apptType: 'FCFS' });

  it('is LATE from PROJECTED ARRIVAL, not from the clock', () => {
    // The whole point: a 16:30 ETA against a 15:00 close reads LATE now,
    // while a dispatcher can still phone the receiver — not at 15:01 when it
    // is already over.
    const farAway = { lat: 39.7, lng: -104.9 }; // Denver-ish, ~900 miles.
    const doomed = truck({ ...farAway, stop: receiving(-60, 180) });

    // The close is three hours away and the clock has not passed it.
    expect(NOW.getTime()).toBeLessThan(new Date(at(180)).getTime());
    expect(evaluate(doomed, config, NOW).status).toBe('LATE');
  });

  it('never reaches AT_RISK — a door closing, not a slot to miss', () => {
    const etaMinutes = Math.round(
      (haversineMiles(NEARBY, STOP_COORDS) * config.roadFactor * 60) / config.avgSpeedMph,
    );
    // The same geometry that produces AT_RISK for an APPT stop.
    const appt = truck({ stop: stop({ apptStartUtc: at(etaMinutes + 20) }) });
    expect(evaluate(appt, config, NOW).status).toBe('AT_RISK');

    const fcfs = truck({ stop: receiving(-120, etaMinutes + 20) });
    expect(evaluate(fcfs, config, NOW).status).toBe('ON_TIME');
  });

  it('uses the LATEST receiving hour as the deadline', () => {
    const facts = truck({ stop: receiving(-60, 120) });
    expect(evaluate(facts, config, NOW).deadlineUtc).toBe(at(120));
  });
});

describe('no coordinates (§12.24)', () => {
  const blind = (over: Partial<StopFacts> = {}) =>
    truck({ stop: stop({ lat: null, lng: null, ...over }) });

  it('says why there is no ETA rather than rendering a dash', () => {
    const result = evaluate(blind(), config, NOW);
    expect(result.etaUtc).toBeNull();
    // A dispatcher has to tell "we cannot project this" from "nothing here".
    expect(result.etaAbsence).toBe('no-coordinates');
  });

  it('falls back to the clock for LATE', () => {
    expect(evaluate(blind({ apptStartUtc: at(-1) }), config, NOW).status).toBe('LATE');
    expect(evaluate(blind({ apptStartUtc: at(60) }), config, NOW).status).not.toBe('LATE');
  });

  it('never emits AT_RISK, because nothing was projected', () => {
    // 20 minutes to a deadline with no ETA is not "at risk", it is unknown.
    expect(evaluate(blind({ apptStartUtc: at(20) }), config, NOW).status).toBe('ON_TIME');
  });
});

describe('TOMORROW is a calendar question in the DISPATCH zone', () => {
  /** The instant of local midnight in `tz` on the day after `from`. */
  const midnightAfter = (from: Date, tz: string): Date => {
    const today = calendarDayInZone(from, tz);
    let probe = from.getTime();
    // Walk forward a minute at a time from an hour before the boundary.
    probe += 20 * 3_600_000;
    while (calendarDayInZone(new Date(probe), tz) === today) probe += 60_000;
    // Narrow to the exact minute the date flips.
    let lo = probe - 60_000;
    while (calendarDayInZone(new Date(lo), tz) !== today) lo -= 60_000;
    return new Date(lo + 60_000);
  };

  it('rolls over at midnight in the dispatch zone, not in UTC or the browser', () => {
    const flip = midnightAfter(NOW, DISPATCH_TZ);
    const justBefore = new Date(flip.getTime() - 60_000);
    const appointment = new Date(flip.getTime() + 9 * 3_600_000).toISOString();

    const far = truck({
      lat: 41.5,
      lng: -87.9, // parked at the stop: the ETA is immediate, not late
      // Fresh AS OF the instant being evaluated, not as of NOW — these two
      // assertions run most of a day later and the fixture would otherwise
      // age into STALE_GPS and mask the rule under test.
      recordedAtUtc: new Date(flip.getTime() - 60_000).toISOString(),
      stop: stop({ apptStartUtc: appointment }),
    });

    // Before local midnight the appointment is tomorrow…
    expect(evaluate(far, config, justBefore).status).toBe('TOMORROW');
    // …and one minute later, in the same UTC hour, it is today.
    expect(evaluate(far, config, flip).status).not.toBe('TOMORROW');
  });

  it('asks the dispatch zone even when the stop keeps a different one', () => {
    // 23:30 Chicago on the boundary day is already tomorrow in Belgrade; the
    // rule must not follow the stop's zone or the viewer's.
    const flip = midnightAfter(NOW, DISPATCH_TZ);
    const beforeFlip = new Date(flip.getTime() - 30 * 60_000);
    const facts = truck({
      lat: 41.5,
      lng: -87.9,
      recordedAtUtc: new Date(beforeFlip.getTime() - 60_000).toISOString(),
      stop: stop({ apptStartUtc: new Date(flip.getTime() + 3_600_000).toISOString() }),
    });
    expect(calendarDayInZone(beforeFlip, 'Europe/Belgrade')).not.toBe(
      calendarDayInZone(beforeFlip, DISPATCH_TZ),
    );
    expect(evaluate(facts, config, beforeFlip).status).toBe('TOMORROW');
  });
});

describe('UNASSIGNED keeps the number it suppresses (§5.8)', () => {
  it('returns no ETA, and the last computed one separately', () => {
    const result = evaluate(truck({ hasDriver: false }), config, NOW);
    expect(result.status).toBe('UNASSIGNED');
    // An ETA for a truck with no driver is fiction…
    expect(result.etaUtc).toBeNull();
    expect(result.etaAbsence).toBe('suppressed-unassigned');
    // …but the UI still strikes the old number through rather than blanking.
    expect(result.lastComputedEtaUtc).not.toBeNull();
  });
});

describe('overrides (§9.5)', () => {
  const override = (over: Partial<NonNullable<TruckFacts['override']>> = {}) => ({
    forcedStatus: 'LATE' as const,
    reason: 'RECEIVER_CONFIRMED_DETENTION' as const,
    reasonNote: null,
    setByName: 'A. Kruk',
    setAtUtc: at(-60),
    expiresAtUtc: at(180),
    ...over,
  });

  it('shows the forced status and keeps computing the real one', () => {
    const result = evaluate(truck({ override: override() }), config, NOW);
    expect(result.status).toBe('LATE');
    // The engine never stops computing; the API returns both because the
    // detail block renders them adjacent.
    expect(result.computed).toBe('ON_TIME');
    expect(result.override).not.toBeNull();
  });

  it('expires on READ, with no job and no toast', () => {
    const expired = truck({ override: override({ expiresAtUtc: at(-1) }) });
    const result = evaluate(expired, config, NOW);
    // Silently back to computed — nothing was decided by a person just then.
    expect(result.status).toBe('ON_TIME');
    expect(result.override).toBeNull();
  });

  it('can force ARRIVED or NO_APPT as well as LATE', () => {
    for (const forced of ['ARRIVED', 'NO_APPT'] as const) {
      expect(evaluate(truck({ override: override({ forcedStatus: forced }) }), config, NOW).status)
        .toBe(forced);
    }
  });
});

describe('the feed, which is not the same as a truck (§12.3)', () => {
  it('goes stale at 5 minutes fleet-wide, against 45 per truck', () => {
    expect(isFeedStale(at(-4), config, NOW)).toBe(false);
    expect(isFeedStale(at(-6), config, NOW)).toBe(true);
    // A truck at six minutes is fine; the FEED at six minutes is not.
    expect(statusOf({ recordedAtUtc: at(-6) })).toBe('ON_TIME');
  });

  it('treats a feed that has never reported as stale', () => {
    expect(isFeedStale(null, config, NOW)).toBe(true);
  });
});

describe('the projection itself', () => {
  it('is straight-line × road factor ÷ average speed', () => {
    const miles = haversineMiles(NEARBY, STOP_COORDS);
    const eta = projectEta(truck(), config, NOW)!;
    const hours = (new Date(eta).getTime() - NOW.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo((miles * config.roadFactor) / config.avgSpeedMph, 6);
  });

  it('is null when either end has no coordinates', () => {
    expect(projectEta(truck({ lat: null, lng: null }), config, NOW)).toBeNull();
    expect(projectEta(truck({ stop: stop({ lat: null }) }), config, NOW)).toBeNull();
  });

  it('measures a known distance correctly', () => {
    // Chicago to Denver is ~920 straight-line miles.
    const miles = haversineMiles({ lat: 41.88, lng: -87.63 }, { lat: 39.74, lng: -104.99 });
    expect(miles).toBeGreaterThan(900);
    expect(miles).toBeLessThan(940);
  });
});
