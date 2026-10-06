import { describe, expect, it } from 'vitest';
import {
  STATUS_DEFAULTS,
  STATUS_LABEL,
  calendarDayInZone,
  evaluate,
  nextCalendarDay,
  upcomingLabel,
  haversineMiles,
  isFeedStale,
  projectEta,
  type StatusConfig,
  type StopFacts,
  type TruckFacts,
} from './status';
import { eveningBefore, fallBack } from '@/test/dst';
import { fcfsEndDate } from './appointment';
import { wallTimeInstant } from './format';

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
  arrivedSource: null,
  ...STOP_COORDS,
  precision: 'street',
  accuracyMiles: null,
  hasAddress: true,
  route: null,
  routeFresh: false,
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

describe('overnight windows (§12.114) — no rule changed, the deadline is the next-day instant', () => {
  /** The evening the window opens: NOW's own date at the stop. */
  const EVENING = { y: 2026, m: 9, d: 18 };
  expect(calendarDayInZone(NOW, DISPATCH_TZ)).toBe('2026-09-18');

  /** The window as the server builds it: the end on its own day, converted from wall time. */
  const overnight = (
    tz = DISPATCH_TZ,
    date = EVENING,
    type: 'APPT' | 'FCFS' = 'FCFS',
    from = { h: 22, min: 0 },
    to = { h: 6, min: 0 },
  ) =>
    stop({
      apptType: type,
      apptStartUtc: wallTimeInstant(date, from, tz).toISOString(),
      apptEndUtc: wallTimeInstant(fcfsEndDate(date, from, to), to, tz).toISOString(),
    });
  const morning = (h: number, min = 0, tz = DISPATCH_TZ, date = EVENING) =>
    wallTimeInstant(fcfsEndDate(date, { h: 22, min: 0 }, { h: 6, min: 0 }), { h, min }, tz);
  const evening = (h: number, min = 0, tz = DISPATCH_TZ, date = EVENING) =>
    wallTimeInstant(date, { h, min }, tz);

  /**
   * How far ahead of its fix the engine projects this truck. Measured from
   * the engine rather than recomputed, so the tests below can place an ETA
   * exactly where they need it by moving `now`.
   */
  const lead = Date.parse(evaluate(truck(), config, NOW).etaUtc!) - NOW.getTime();
  const arrivingAt = (eta: Date, s: StopFacts) => {
    const now = new Date(eta.getTime() - lead);
    const result = evaluate(
      truck({ stop: s, recordedAtUtc: new Date(now.getTime() - 2 * 60_000).toISOString() }),
      config,
      now,
    );
    expect(Math.abs(Date.parse(result.etaUtc!) - eta.getTime())).toBeLessThan(60_000);
    return result;
  };

  it('takes 06:00 the NEXT morning as the deadline', () => {
    const s = overnight();
    const { deadlineUtc } = evaluate(truck({ stop: s }), config, NOW);
    expect(deadlineUtc).toBe(morning(6).toISOString());
    // Independently of the builder the fixtures use: the 19th, 8 hours on.
    // Without this, a builder that lost the next day would move the
    // fixtures with it and every case below would still pass.
    expect(calendarDayInZone(new Date(deadlineUtc!), DISPATCH_TZ)).toBe('2026-09-19');
    expect(Date.parse(deadlineUtc!) - Date.parse(s.apptStartUtc!)).toBe(8 * 3_600_000);
  });

  it('is ON_TIME for a truck projected at 03:00 — inside the window, after midnight', () => {
    // The case the old same-day reading got wrong: 06:00 on the START's day
    // is before 22:00, so every arrival in the night would have been LATE.
    expect(arrivingAt(morning(3), overnight()).status).toBe('ON_TIME');
  });

  it('is LATE for a truck projected at 06:30 the next morning', () => {
    expect(arrivingAt(morning(6, 30), overnight()).status).toBe('LATE');
  });

  it('never reaches AT_RISK for FCFS, even 20 minutes before the close', () => {
    expect(arrivingAt(morning(5, 40), overnight()).status).toBe('ON_TIME');
  });

  it('is AT_RISK, LATE and ON_TIME for an APPT that runs past midnight', () => {
    // 23:30 with a 60-minute window: the deadline is 00:30 on the next day.
    const appt = () => overnight(DISPATCH_TZ, EVENING, 'APPT', { h: 23, min: 30 }, { h: 0, min: 30 });
    expect(arrivingAt(morning(0, 10), appt()).status).toBe('AT_RISK');
    expect(arrivingAt(morning(0, 45), appt()).status).toBe('LATE');
    expect(arrivingAt(evening(23, 30), appt()).status).toBe('ON_TIME');
  });

  it('with no ETA, is not LATE by the clock until the next-day close passes', () => {
    const blind = { ...overnight(), lat: null, lng: null };
    const at = (now: Date) =>
      evaluate(
        truck({ stop: blind, recordedAtUtc: new Date(now.getTime() - 2 * 60_000).toISOString() }),
        config,
        now,
      ).status;
    expect(at(morning(3))).toBe('ON_TIME');
    expect(at(morning(6, 1))).toBe('LATE');
  });

  it('is ARRIVED once the truck is in, at 02:00, whatever the deadline says', () => {
    const arrived = { ...overnight(), arrivedAt: morning(2).toISOString() };
    expect(evaluate(truck({ stop: arrived }), config, morning(2, 5)).status).toBe('ARRIVED');
  });

  it('keeps 06:00 CST on the fall-back night, nine hours on', () => {
    // An end built as start + 8 hours would close at 05:00 and call this LATE.
    const date = eveningBefore(DISPATCH_TZ, fallBack(DISPATCH_TZ, 2026));
    const s = overnight(DISPATCH_TZ, date);
    expect(Date.parse(s.apptEndUtc!) - Date.parse(s.apptStartUtc!)).toBe(9 * 3_600_000);
    expect(arrivingAt(morning(5, 30, DISPATCH_TZ, date), s).status).toBe('ON_TIME');
  });

  it('leaves a same-day window exactly as it was', () => {
    const day = overnight(DISPATCH_TZ, EVENING, 'FCFS', { h: 7, min: 0 }, { h: 15, min: 0 });
    expect(day.apptEndUtc).toBe(evening(15).toISOString());
    expect(arrivingAt(evening(14), day).status).toBe('ON_TIME');
    expect(arrivingAt(evening(15, 30), day).status).toBe('LATE');
  });

  describe('a stop in a different zone from dispatch', () => {
    const LA = 'America/Los_Angeles';

    it('is TOMORROW when its 22:00 is already tomorrow in dispatch time', () => {
      // 22:00 PDT is 00:00 CDT the next day. TOMORROW asks the DISPATCH
      // calendar (§12.1), so a night that starts tonight in LA is upcoming
      // from 21:00 in Chicago.
      const now = evening(21);
      const la = overnight(LA);
      expect(calendarDayInZone(new Date(la.apptStartUtc!), DISPATCH_TZ)).toBe('2026-09-19');
      expect(evaluate(truck({ stop: la, recordedAtUtc: now.toISOString() }), config, now).status)
        .toBe('TOMORROW');
      // The same wall times in Chicago start tonight.
      expect(
        evaluate(truck({ stop: overnight(), recordedAtUtc: now.toISOString() }), config, now).status,
      ).not.toBe('TOMORROW');
    });

    it('measures its deadline at 06:00 PDT, not 06:00 in dispatch time', () => {
      const result = evaluate(truck({ stop: overnight(LA) }), config, NOW);
      expect(result.deadlineUtc).toBe(morning(6, 0, LA).toISOString());
      expect(Date.parse(result.deadlineUtc!) - morning(6).getTime()).toBe(2 * 3_600_000);
    });
  });
});

describe('no coordinates (§12.24)', () => {
  const blind = (over: Partial<StopFacts> = {}) =>
    truck({ stop: stop({ lat: null, lng: null, ...over }) });

  it('says why there is no ETA rather than rendering a dash', () => {
    const result = evaluate(blind(), config, NOW);
    expect(result.etaUtc).toBeNull();
    // A dispatcher has to tell "we cannot project this" from "nothing here".
    expect(result.etaAbsence).toBe('address-not-located');
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

/**
 * §12.82. The bucket is "any later day"; the row says WHICH. Tomorrow is the
 * next CALENDAR day in dispatch time — not "within 24 hours" — so these probe
 * the edges where the two differ, with every boundary derived, not pasted.
 */
describe('which later day an upcoming row names', () => {
  /** Local midnight in the dispatch zone on the day after `from`. */
  const midnightAfter = (from: Date): Date => {
    const today = calendarDayInZone(from, DISPATCH_TZ);
    let probe = from.getTime();
    while (calendarDayInZone(new Date(probe), DISPATCH_TZ) === today) probe += 60_000;
    return new Date(probe);
  };
  const HOUR = 3_600_000;
  const upcomingAt = (now: Date, appt: Date) =>
    evaluate(
      truck({
        recordedAtUtc: new Date(now.getTime() - 60_000).toISOString(),
        stop: stop({ apptStartUtc: appt.toISOString() }),
      }),
      config,
      now,
    );

  it('names the bucket "Upcoming", not "Tomorrow"', () => {
    expect(STATUS_LABEL.TOMORROW).toBe('Upcoming');
  });

  it('says tomorrow for an appointment on the next dispatch day', () => {
    const appt = new Date(midnightAfter(NOW).getTime() + 10 * HOUR);
    const result = upcomingAt(NOW, appt);
    expect(result.status).toBe('TOMORROW');
    expect(result.upcoming).toEqual({ day: calendarDayInZone(appt, DISPATCH_TZ), tomorrow: true });
    expect(upcomingLabel(result.upcoming!)).toBe('Tomorrow');
  });

  it('dates an appointment two days out, weekday and month/day in dispatch time', () => {
    const appt = new Date(midnightAfter(midnightAfter(NOW)).getTime() + 10 * HOUR);
    const result = upcomingAt(NOW, appt);
    expect(result.status).toBe('TOMORROW');
    expect(result.upcoming?.tomorrow).toBe(false);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DISPATCH_TZ,
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(appt);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    expect(upcomingLabel(result.upcoming!)).toBe(`${part('weekday')} ${part('month')}/${part('day')}`);
  });

  it('is a calendar question: 23:30 tonight, an appointment 25 hours out is still tomorrow', () => {
    const flip = midnightAfter(NOW);
    const now = new Date(flip.getTime() - 30 * 60_000);
    // 23:59 tomorrow evening — more than 24 hours away, still tomorrow.
    const lateTomorrow = new Date(midnightAfter(flip).getTime() - 60_000);
    expect(lateTomorrow.getTime() - now.getTime()).toBeGreaterThan(24 * HOUR);
    expect(upcomingAt(now, lateTomorrow).upcoming?.tomorrow).toBe(true);
    // And one minute past that midnight it is the day after.
    const dayAfter = midnightAfter(flip);
    expect(upcomingAt(now, new Date(dayAfter.getTime() + 60_000)).upcoming?.tomorrow).toBe(false);
  });

  it('holds across the fall-back day, whose 25 hours a 24-hour rule would miss', () => {
    // Find the 25-hour dispatch day after NOW rather than pasting its date.
    let midnight = midnightAfter(NOW);
    for (let i = 0; i < 400; i += 1) {
      const next = midnightAfter(midnight);
      if (next.getTime() - midnight.getTime() === 25 * HOUR) break;
      midnight = next;
    }
    const nextMidnight = midnightAfter(midnight);
    expect(nextMidnight.getTime() - midnight.getTime()).toBe(25 * HOUR);
    const now = new Date(midnight.getTime() + 30 * 60_000); // 00:30 on the long day
    const lateTomorrow = new Date(midnightAfter(nextMidnight).getTime() - 60_000);
    expect(upcomingAt(now, lateTomorrow).upcoming?.tomorrow).toBe(true);
  });

  it('is null for anything not in the upcoming bucket', () => {
    expect(upcomingAt(NOW, new Date(NOW.getTime() + 4 * HOUR)).upcoming).toBeNull();
  });

  it('steps calendar days across a month, a year and a leap day', () => {
    expect(nextCalendarDay('2026-09-30')).toBe('2026-10-01');
    expect(nextCalendarDay('2026-12-31')).toBe('2027-01-01');
    expect(nextCalendarDay('2028-02-28')).toBe('2028-02-29');
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
    const facts = truck();
    const eta = projectEta(facts, config)!;
    // Measured from the FIX, not from `now` — see below.
    const from = new Date(facts.recordedAtUtc!).getTime();
    const hours = (new Date(eta).getTime() - from) / 3_600_000;
    expect(hours).toBeCloseTo((miles * config.roadFactor) / config.avgSpeedMph, 6);
  });

  it('is null when either end has no coordinates', () => {
    expect(projectEta(truck({ lat: null, lng: null }), config)).toBeNull();
    expect(projectEta(truck({ stop: stop({ lat: null }) }), config)).toBeNull();
  });

  it('is null for a truck that has never reported a position', () => {
    expect(projectEta(truck({ recordedAtUtc: null }), config)).toBeNull();
  });

  /* ------------------------ anchored, not floating --------------------- */

  /**
   * The ETA departs from the GPS fix, not from the clock.
   *
   * `now + travelTime` means a truck whose feed froze has an ETA that slides
   * forward forever — the board quietly re-promising a vehicle that has not
   * moved. Anchoring makes that drift impossible rather than policed.
   */
  describe('the ETA is anchored to the position (§12.24)', () => {
    it('does not move when only the clock moves', () => {
      const facts = truck();
      const first = evaluate(facts, config, NOW);
      const anHourLater = evaluate(facts, config, new Date(NOW.getTime() + 60 * 60_000));
      expect(anHourLater.etaUtc).toBe(first.etaUtc);
    });

    it('moves when a new fix lands, and only then', () => {
      const before = evaluate(truck(), config, NOW);
      // Same truck, same stop, a fix taken ten minutes later.
      const after = evaluate(truck({ recordedAtUtc: at(8) }), config, NOW);
      expect(after.etaUtc).not.toBe(before.etaUtc);
      expect(new Date(after.etaUtc!).getTime() - new Date(before.etaUtc!).getTime()).toBe(
        10 * 60_000,
      );
    });

    it('puts a frozen truck’s ETA in the past rather than sliding it forward', () => {
      // A fix from four hours ago, on a truck 40 miles out. Honest: the
      // arrival it implies has already been and gone.
      const frozen = truck({ recordedAtUtc: at(-240) });
      const result = evaluate(frozen, config, NOW);
      expect(new Date(result.etaUtc!).getTime()).toBeLessThan(NOW.getTime());
    });
  });

  /* ------------------------------- miles ------------------------------- */

  describe('miles remaining (§12.24)', () => {
    /**
     * ROAD miles, not straight-line — changed in §12.31.
     *
     * The row used to show the great-circle distance, which is not a number
     * anyone in freight uses: a dispatcher reads that column against a rate
     * confirmation, and straight-line is short by 7% to 46% depending on the
     * lane. With no route available this is still the brief's 1.25, but it is
     * at least the same KIND of number the routed value will be.
     */
    it('is road miles, not the straight line', () => {
      const result = evaluate(truck(), config, NOW);
      const straight = haversineMiles(NEARBY, STOP_COORDS);
      expect(result.milesRemaining).toBeCloseTo(straight * config.roadFactor, 6);
      expect(result.milesRemaining).toBeGreaterThan(straight);
      expect(result.distanceBasis).toBe('straight-line');
    });

    it('is null exactly when the ETA is null', () => {
      const noCoords = evaluate(truck({ stop: stop({ lat: null, lng: null }) }), config, NOW);
      expect(noCoords.etaUtc).toBeNull();
      expect(noCoords.milesRemaining).toBeNull();
    });

    /** §5.8: a distance beside a withheld time is the same fiction. */
    it('is withheld with the ETA on an unassigned truck', () => {
      const unassigned = evaluate(truck({ hasDriver: false }), config, NOW);
      expect(unassigned.etaUtc).toBeNull();
      expect(unassigned.milesRemaining).toBeNull();
      expect(unassigned.lastComputedEtaUtc).not.toBeNull();
    });
  });

  /* ------------------------ which kind of nothing ---------------------- */

  describe('the absence says which kind it is (§12.24)', () => {
    it('reads `address-not-located` when an address was typed', () => {
      const result = evaluate(
        truck({ stop: stop({ lat: null, lng: null, hasAddress: true }) }),
        config,
        NOW,
      );
      expect(result.etaAbsence).toBe('address-not-located');
    });

    it('reads `no-address` when nothing was entered', () => {
      const result = evaluate(
        truck({ stop: stop({ lat: null, lng: null, hasAddress: false }) }),
        config,
        NOW,
      );
      expect(result.etaAbsence).toBe('no-address');
    });
  });

  /** Nothing branches on precision yet — it rides along for a future rule. */
  it('carries the coordinate precision beside the status', () => {
    expect(evaluate(truck(), config, NOW).precision).toBe('street');
    expect(
      evaluate(truck({ stop: stop({ precision: 'zip' }) }), config, NOW).precision,
    ).toBe('zip');
  });

  it('measures a known distance correctly', () => {
    // Chicago to Denver is ~920 straight-line miles.
    const miles = haversineMiles({ lat: 41.88, lng: -87.63 }, { lat: 39.74, lng: -104.99 });
    expect(miles).toBeGreaterThan(900);
    expect(miles).toBeLessThan(940);
  });
});

/* -------------------------------------------------------------------------
 * §12.30 — AT_RISK needs a coordinate the buffer can outrun
 * ---------------------------------------------------------------------- */

describe('AT_RISK and coordinate precision (§12.30)', () => {
  /** Inside the 45-minute buffer but not past the deadline. */
  const nearlyLate = () =>
    truck({
      // ~40 miles out is about 58 minutes; put the deadline just beyond it.
      stop: stop({ apptStartUtc: at(75), apptEndUtc: null }),
    });

  it('fires at street precision — the case it exists for', () => {
    expect(statusOf(nearlyLate())).toBe('AT_RISK');
  });

  /**
   * A ZIP centroid is a median 2.14 mi from the real address, p90 5.51 mi.
   * That is 3–8 minutes of ETA, and AT_RISK is a claim about the last 45
   * minutes specifically — inside that window the error is a meaningful share
   * of what is being measured.
   */
  it('does NOT fire on a ZIP centroid', () => {
    const facts = nearlyLate();
    const zipStop = { ...facts.stop!, precision: 'zip' as const, accuracyMiles: 4.4 };
    expect(statusOf({ ...facts, stop: zipStop })).not.toBe('AT_RISK');
    expect(statusOf({ ...facts, stop: zipStop })).toBe('ON_TIME');
  });

  /** Measured at 0.16–0.78 mi — under a minute. The buffer outruns it easily. */
  it('still fires at block precision', () => {
    const facts = nearlyLate();
    expect(
      statusOf({ ...facts, stop: { ...facts.stop!, precision: 'block', accuracyMiles: 0.8 } }),
    ).toBe('AT_RISK');
  });

  /**
   * LATE is the one that must survive a coarse coordinate. At hours out,
   * being past the deadline is robust to five miles of error, and it is the
   * fact a dispatcher has to act on — the whole reason the fallback exists.
   */
  it('still reports LATE on a ZIP centroid', () => {
    const late = truck({
      stop: stop({
        apptStartUtc: at(-60),
        apptEndUtc: null,
        precision: 'zip',
        accuracyMiles: 4.4,
      }),
    });
    expect(statusOf(late)).toBe('LATE');
  });
});
