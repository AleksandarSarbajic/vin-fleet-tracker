import { describe, expect, it } from 'vitest';
import { detectToasts, dispatchDay, toastKey, type FleetSnapshot } from './toast';

/**
 * §12.50. Every one of these tests exists to prove something does NOT happen,
 * which is the only kind of rule a toast set lives or dies by. A toast that
 * fires when it should not is not a small bug — it is the thing that teaches
 * people to ignore every other toast.
 */

const truck = (over: Partial<FleetSnapshot> = {}): FleetSnapshot => ({
  id: 't-1',
  truckNumber: 137,
  samsaraName: 'Truck #137',
  status: 'ON_TIME',
  stopId: 's-1',
  forced: false,
  ...over,
});

const asMap = (rows: FleetSnapshot[]) => new Map(rows.map((r) => [r.id, r]));

const detect = (
  before: FleetSnapshot[] | null,
  after: FleetSnapshot[],
  over: Partial<Parameters<typeof detectToasts>[0]> = {},
) =>
  detectToasts({
    previous: before === null ? null : asMap(before),
    next: after,
    feedStaleBefore: false,
    feedStaleNow: false,
    alreadyToday: new Set<string>(),
    ...over,
  });

describe('the one transition worth interrupting for', () => {
  it('fires when a truck crosses into LATE', () => {
    const found = detect([truck({ status: 'AT_RISK' })], [truck({ status: 'LATE' })]);
    expect(found).toHaveLength(1);
    expect(found[0]?.truckLabel).toBe('137');
    expect(found[0]?.status).toBe('LATE');
  });

  /**
   * Measured: all four AT_RISK crossings in the window were followed by a
   * LATE crossing on the same truck and stop 20-45 minutes later. An AT_RISK
   * toast flags no truck LATE does not, and interrupts twice for one problem.
   */
  it('does not fire for AT_RISK', () => {
    expect(detect([truck({ status: 'ON_TIME' })], [truck({ status: 'AT_RISK' })])).toEqual([]);
  });

  it('does not fire for the pleasant transitions', () => {
    expect(detect([truck({ status: 'LATE' })], [truck({ status: 'ON_TIME' })])).toEqual([]);
    expect(detect([truck({ status: 'ON_TIME' })], [truck({ status: 'ARRIVED' })])).toEqual([]);
    // The midnight rollover, which is nobody's problem.
    expect(detect([truck({ status: 'ON_TIME' })], [truck({ status: 'TOMORROW' })])).toEqual([]);
  });

  it('does not fire when nothing changed', () => {
    expect(detect([truck({ status: 'LATE' })], [truck({ status: 'LATE' })])).toEqual([]);
  });

  it('falls back to the Samsara name for a truck with no number', () => {
    const odd = { truckNumber: null, samsaraName: 'Truck' };
    const found = detect([truck({ ...odd, status: 'ON_TIME' })], [truck({ ...odd, status: 'LATE' })]);
    expect(found[0]?.truckLabel).toBe('Truck');
  });
});

describe('rule 1 — first load is a starting position, not a transition', () => {
  it('says nothing at all on the first poll', () => {
    // Every LATE truck on the board is not news. It is the board.
    expect(detect(null, [truck({ status: 'LATE' }), truck({ id: 't-2', status: 'LATE' })])).toEqual(
      [],
    );
  });
});

describe('rule 2 — the feed', () => {
  /** 23 toasts for one event, none of them about a truck (§5.9). */
  it('says nothing while the feed is going stale', () => {
    expect(
      detect([truck({ status: 'ON_TIME' })], [truck({ status: 'LATE' })], { feedStaleNow: true }),
    ).toEqual([]);
  });

  it('says nothing on the way back either', () => {
    // The return is as synchronised as the departure — every row recovers in
    // the same poll, and several will land on LATE at once.
    expect(
      detect([truck({ status: 'ON_TIME' })], [truck({ status: 'LATE' })], {
        feedStaleBefore: true,
      }),
    ).toEqual([]);
  });
});

describe('rule 3 — a truck that was not there a poll ago', () => {
  it('does not toast a truck that appears already LATE', () => {
    // It has not crossed anything; it has arrived in the query.
    expect(detect([], [truck({ status: 'LATE' })])).toEqual([]);
  });

  it('does not care about a truck that leaves', () => {
    expect(detect([truck({ status: 'ON_TIME' })], [])).toEqual([]);
  });
});

describe('rule 4 — the fog states', () => {
  /**
   * The rule the real data forced. Truck 138 reports GPS once an hour, so it
   * cycled LATE → STALE_GPS (at the 45-minute threshold) → LATE three times
   * in one morning, while being continuously and unchangingly late.
   */
  it('does not treat coming back from STALE_GPS as becoming late', () => {
    expect(detect([truck({ status: 'STALE_GPS' })], [truck({ status: 'LATE' })])).toEqual([]);
  });

  it('does not fire when a stop or a driver appears', () => {
    expect(detect([truck({ status: 'NO_APPT' })], [truck({ status: 'LATE' })])).toEqual([]);
    expect(detect([truck({ status: 'UNASSIGNED' })], [truck({ status: 'LATE' })])).toEqual([]);
  });

  it('still fires from a state that means something', () => {
    // Proving rule 4 is an exclusion rather than a switched-off feature.
    expect(detect([truck({ status: 'ON_TIME' })], [truck({ status: 'LATE' })])).toHaveLength(1);
  });

  /** The whole hourly cycle, end to end, producing exactly one toast. */
  it('survives a truck that reports once an hour', () => {
    const seen = new Set<string>();
    const cycle: FleetSnapshot['status'][] = [
      'ON_TIME',
      'LATE',
      'STALE_GPS',
      'LATE',
      'STALE_GPS',
      'LATE',
    ];
    let fired = 0;
    for (let i = 1; i < cycle.length; i += 1) {
      const found = detect([truck({ status: cycle[i - 1]! })], [truck({ status: cycle[i]! })], {
        alreadyToday: seen,
      });
      for (const t of found) seen.add(t.id);
      fired += found.length;
    }
    expect(fired).toBe(1);
  });
});

describe('rule 5 — a forced status', () => {
  it('does not tell a dispatcher what they just typed', () => {
    expect(
      detect([truck({ status: 'ON_TIME' })], [truck({ status: 'LATE', forced: true })]),
    ).toEqual([]);
  });

  it('fires when an override lifts to reveal a real LATE', () => {
    // Checked on the NEW row, so this is a genuine crossing, not an echo.
    expect(
      detect([truck({ status: 'ON_TIME', forced: true })], [truck({ status: 'LATE' })]),
    ).toHaveLength(1);
  });
});

describe('rule 6 — once per truck and stop per dispatch day', () => {
  it('will not repeat for a pair already toasted', () => {
    const already = new Set([toastKey('t-1', 's-1')]);
    expect(
      detect([truck({ status: 'ON_TIME' })], [truck({ status: 'LATE' })], {
        alreadyToday: already,
      }),
    ).toEqual([]);
  });

  it('keys by STOP, so the same truck going late on its next load still toasts', () => {
    const already = new Set([toastKey('t-1', 's-1')]);
    const found = detect(
      [truck({ status: 'ON_TIME', stopId: 's-2' })],
      [truck({ status: 'LATE', stopId: 's-2' })],
      { alreadyToday: already },
    );
    expect(found).toHaveLength(1);
  });

  it('handles a truck with no stop without colliding with another', () => {
    const a = toastKey('t-1', null);
    const b = toastKey('t-2', null);
    expect(a).not.toBe(b);
  });
});

describe('dispatchDay', () => {
  it('counts the day in the DISPATCH zone, not UTC and not the browser', () => {
    // 04:30 UTC is still the previous evening in Chicago — the difference
    // between resetting the ledger mid-shift and resetting it overnight.
    const at = new Date('2026-09-19T04:30:00.000Z');
    expect(dispatchDay(at, 'America/Chicago')).toBe('2026-09-18');
    expect(dispatchDay(at, 'UTC')).toBe('2026-09-19');
  });
});
