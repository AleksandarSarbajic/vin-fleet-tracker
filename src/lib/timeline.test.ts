import { describe, expect, it } from 'vitest';
import {
  currentStopId,
  groupByLoad,
  minutesLate,
  overrideState,
  stopPlace,
  stopState,
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
   * Read off the timestamps, never off `loads.status`. A load marked
   * AT_RECEIVER can still have its second of three stops ahead of it.
   */
  it('ignores the load status', () => {
    expect(stopState(stop({ loadStatus: 'AT_RECEIVER' }))).toBe('ahead');
    expect(
      stopState(
        stop({ loadStatus: 'AVAILABLE', departedAt: '2026-09-23T15:00:00.000Z' }),
      ),
    ).toBe('done');
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
