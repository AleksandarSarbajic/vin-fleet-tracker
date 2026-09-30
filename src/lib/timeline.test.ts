import { describe, expect, it } from 'vitest';
import {
  closedLoadLabel,
  currentStopId,
  groupByLoad,
  minutesLate,
  overrideState,
  stopPlace,
  stopState,
  timelineStay,
  TIMELINE_KEEP_HOURS,
} from './timeline';
import type { TimelineOverride, TimelineStop } from '@/server/timeline';

/** §14 feature 15. */

const stop = (over: Partial<TimelineStop> = {}): TimelineStop => ({
  stopId: 's1',
  loadId: 'l1',
  loadNumber: 'LD-4417',
  loadStatus: 'DISPATCHED',
  loadCreatedAt: '2026-09-23T06:00:00.000Z',
  sequence: 1,
  type: 'DEL',
  addressLine: '2500 N 11th ST',
  city: 'Moorhead',
  state: 'MN',
  zip: '56560',
  apptStartUtc: '2026-09-23T14:00:00.000Z',
  apptEndUtc: null,
  apptTz: 'America/Chicago',
  apptType: 'APPT',
  arrivedAt: null,
  arrivedSource: null,
  departedAt: null,
  dispatcherNote: null,
  noteAt: null,
  overrides: [],
  ...over,
});

const override = (over: Partial<TimelineOverride> = {}): TimelineOverride => ({
  forcedStatus: 'ARRIVED',
  reason: 'ELD_POSITION_WRONG',
  reasonNote: null,
  setAt: '2026-09-23T12:00:00.000Z',
  expiresAt: '2026-09-23T18:00:00.000Z',
  clearedAt: null,
  setByName: 'Sam Leasar',
  ...over,
});

describe('where a stop is in its own life', () => {
  it('is ahead before anything has happened', () => {
    expect(stopState(stop())).toBe('ahead');
  });

  it('is here once it has been arrived at', () => {
    expect(stopState(stop({ arrivedAt: '2026-09-23T13:50:00.000Z' }))).toBe('here');
  });

  it('is done once it has been departed', () => {
    expect(
      stopState(
        stop({
          arrivedAt: '2026-09-23T13:50:00.000Z',
          departedAt: '2026-09-23T15:00:00.000Z',
        }),
      ),
    ).toBe('done');
  });

  /**
   * Read off the timestamps, never off an OPEN `loads.status`. A load marked
   * AT_RECEIVER can still have its second of three stops ahead of it.
   */
  it('ignores the status of an open load', () => {
    expect(stopState(stop({ loadStatus: 'AT_RECEIVER' }))).toBe('ahead');
    expect(
      stopState(
        stop({ loadStatus: 'AVAILABLE', departedAt: '2026-09-23T15:00:00.000Z' }),
      ),
    ).toBe('done');
  });
});

/**
 * §12.88. A closed load — Delivered, TONU, Cancelled — is the exception: the
 * work is over, and the timestamps alone made a delivered stop still at the
 * dock read `here`, with the live dot.
 */
describe('a stop on a closed load', () => {
  const arrived = '2026-09-23T13:50:00.000Z';

  it('is never on site: arrived and not departed on a delivered load is closed', () => {
    expect(stopState(stop({ loadStatus: 'DELIVERED', arrivedAt: arrived }))).toBe(
      'closed',
    );
  });

  it('is closed after a departure too, and on every closed status', () => {
    for (const loadStatus of ['DELIVERED', 'TONU', 'CANCELLED'] as const) {
      expect(stopState(stop({ loadStatus, arrivedAt: arrived }))).toBe('closed');
      expect(
        stopState(
          stop({
            loadStatus,
            arrivedAt: arrived,
            departedAt: '2026-09-23T15:00:00.000Z',
          }),
        ),
      ).toBe('closed');
    }
  });

  it('is not visited when the truck never got there, rather than ahead', () => {
    expect(stopState(stop({ loadStatus: 'CANCELLED' }))).toBe('unvisited');
    expect(stopState(stop({ loadStatus: 'DELIVERED' }))).toBe('unvisited');
  });

  it('carries the load’s own word, TONU included', () => {
    expect(closedLoadLabel('DELIVERED')).toBe('Load delivered');
    expect(closedLoadLabel('CANCELLED')).toBe('Load cancelled');
    expect(closedLoadLabel('TONU')).toBe('Load TONU');
    expect(closedLoadLabel('AT_RECEIVER')).toBeNull();
  });
});

describe('how late it was', () => {
  it('measures from the end of the window, not its start (§12.1)', () => {
    const late = minutesLate(
      stop({
        apptStartUtc: '2026-09-23T14:00:00.000Z',
        apptEndUtc: '2026-09-23T16:00:00.000Z',
        arrivedAt: '2026-09-23T15:00:00.000Z',
      }),
    );
    // Inside the window: an hour early against the deadline, not an hour late
    // against the start.
    expect(late).toBe(-60);
  });

  it('is positive when the truck missed the deadline', () => {
    expect(minutesLate(stop({ arrivedAt: '2026-09-23T14:25:00.000Z' }))).toBe(25);
  });

  /** Nothing to measure, and nothing to measure against. */
  it('is null before the truck arrives', () => {
    expect(minutesLate(stop())).toBeNull();
  });

  it('is null when there is no appointment to be late for', () => {
    expect(
      minutesLate(
        stop({
          apptStartUtc: null,
          apptEndUtc: null,
          arrivedAt: '2026-09-23T14:00:00.000Z',
        }),
      ),
    ).toBeNull();
  });
});

describe('what happened to an override', () => {
  const NOW = Date.parse('2026-09-23T15:00:00.000Z');

  it('is live while it is set and unexpired', () => {
    expect(overrideState(override(), NOW)).toBe('live');
  });

  /**
   * Three states, not two. Cleared is a dispatcher changing their mind;
   * expired is §9.5 working as designed. Printing both as "ended" would lose
   * the only interesting difference between them.
   */
  it('tells cleared apart from expired', () => {
    expect(overrideState(override({ clearedAt: '2026-09-23T13:00:00.000Z' }), NOW)).toBe(
      'cleared',
    );
    expect(overrideState(override({ expiresAt: '2026-09-23T14:00:00.000Z' }), NOW)).toBe(
      'expired',
    );
  });

  it('calls a cleared-and-expired override cleared, because that came first', () => {
    expect(
      overrideState(
        override({
          clearedAt: '2026-09-23T13:00:00.000Z',
          expiresAt: '2026-09-23T14:00:00.000Z',
        }),
        NOW,
      ),
    ).toBe('cleared');
  });
});

describe('grouping', () => {
  it('keeps each load together, in the order it was given', () => {
    const loads = groupByLoad([
      stop({ stopId: 'a', loadId: 'l1', sequence: 1 }),
      stop({ stopId: 'b', loadId: 'l1', sequence: 2 }),
      stop({ stopId: 'c', loadId: 'l2', sequence: 1 }),
    ]);
    expect(loads.map((l) => l.loadId)).toEqual(['l1', 'l2']);
    expect(loads[0]?.stops.map((s) => s.stopId)).toEqual(['a', 'b']);
  });

  it('does not merge two runs of the same load back together', () => {
    // The query orders by load, so this cannot happen — and if the ordering
    // ever changed, silently merging would hide it rather than show it.
    const loads = groupByLoad([
      stop({ stopId: 'a', loadId: 'l1' }),
      stop({ stopId: 'b', loadId: 'l2' }),
      stop({ stopId: 'c', loadId: 'l1' }),
    ]);
    expect(loads).toHaveLength(3);
  });

  it('is empty for a truck with nothing on it', () => {
    expect(groupByLoad([])).toEqual([]);
  });
});

describe('the now line', () => {
  it('sits on the first stop that has not been departed', () => {
    expect(
      currentStopId([
        stop({ stopId: 'a', departedAt: '2026-09-23T10:00:00.000Z' }),
        stop({ stopId: 'b' }),
        stop({ stopId: 'c' }),
      ]),
    ).toBe('b');
  });

  /**
   * §12.88. The "+1 load" truck: the load closed first was also created
   * first, so its undeparted receiver stop came first in the list and took the
   * line — pointing away from the load the truck is actually running.
   */
  it('lands only on an open load, never on a closed one listed before it', () => {
    expect(
      currentStopId([
        stop({
          stopId: 'closed',
          loadId: 'l1',
          loadStatus: 'DELIVERED',
          arrivedAt: '2026-09-23T13:50:00.000Z',
        }),
        stop({ stopId: 'unvisited', loadId: 'l1', loadStatus: 'DELIVERED', sequence: 2 }),
        stop({ stopId: 'open', loadId: 'l2', loadStatus: 'DISPATCHED' }),
      ]),
    ).toBe('open');
  });

  it('is not drawn when the only undeparted stops are on closed loads', () => {
    expect(currentStopId([stop({ stopId: 'a', loadStatus: 'CANCELLED' })])).toBeNull();
  });

  /** Drawing one under the last row would suggest something is still due. */
  it('is not drawn at all when everything is done', () => {
    expect(
      currentStopId([stop({ stopId: 'a', departedAt: '2026-09-23T10:00:00.000Z' })]),
    ).toBeNull();
  });
});

describe('naming the place', () => {
  it('prefers the city', () => {
    expect(stopPlace(stop())).toBe('Moorhead, MN');
  });

  it('falls back to the street line', () => {
    expect(stopPlace(stop({ city: null, state: null }))).toBe('2500 N 11th ST');
  });

  it('says so plainly when there is no address yet', () => {
    expect(stopPlace(stop({ city: null, state: null, addressLine: null }))).toBe(
      'Address not given yet',
    );
  });
});

/**
 * §12.88. The ONE rule for how long a load stays on the timeline — the query
 * filters with it and Clear stop's confirm step words its sentence from it.
 */
describe('how long a load stays on the timeline', () => {
  const NOW = Date.parse('2026-09-23T18:00:00.000Z');
  const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
  const leg = (arrivedAt: string | null, departedAt: string | null = null) => ({
    arrivedAt,
    departedAt,
  });

  it('keeps an open load whatever its times', () => {
    expect(timelineStay({ status: 'DISPATCHED', stops: [leg(ago(90))] }, NOW)).toEqual({
      kind: 'open',
    });
  });

  it('keeps a closed load until 24 hours after its last arrival', () => {
    expect(timelineStay({ status: 'DELIVERED', stops: [leg(ago(2))] }, NOW)).toEqual({
      kind: 'until',
      untilUtc: new Date(NOW + (TIMELINE_KEEP_HOURS - 2) * 3_600_000).toISOString(),
      after: 'arrival',
    });
  });

  it('measures from the latest event on any stop, a departure included', () => {
    const stay = timelineStay(
      { status: 'DELIVERED', stops: [leg(ago(30), ago(29)), leg(ago(5), ago(3))] },
      NOW,
    );
    expect(stay).toEqual({
      kind: 'until',
      untilUtc: new Date(NOW + (TIMELINE_KEEP_HOURS - 3) * 3_600_000).toISOString(),
      after: 'departure',
    });
  });

  it('drops a load whose last arrival was 30 hours ago', () => {
    expect(timelineStay({ status: 'DELIVERED', stops: [leg(ago(30))] }, NOW)).toEqual({
      kind: 'gone',
      reason: 'stale',
      lastUtc: ago(30),
      after: 'arrival',
    });
  });

  it('drops a closed load none of whose stops was reached', () => {
    expect(
      timelineStay({ status: 'CANCELLED', stops: [leg(null), leg(null)] }, NOW),
    ).toEqual({
      kind: 'gone',
      reason: 'never-reached',
    });
  });

  it('still shows it at exactly 24 hours, as the query did with >=', () => {
    expect(timelineStay({ status: 'DELIVERED', stops: [leg(ago(24))] }, NOW).kind).toBe(
      'until',
    );
    expect(
      timelineStay(
        {
          status: 'DELIVERED',
          stops: [leg(new Date(NOW - 24 * 3_600_000 - 1).toISOString())],
        },
        NOW,
      ).kind,
    ).toBe('gone');
  });
});
