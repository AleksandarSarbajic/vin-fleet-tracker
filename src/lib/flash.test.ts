import { describe, expect, it } from 'vitest';
import { FLASH_GROUND, detectFlashes, flashClock } from './flash';
import type { FleetSnapshot } from './toast';
import { STATUS_LABEL } from './status';

/**
 * §14 feature 6. The mirror image of `toast.test.ts`: those tests exist to
 * prove things do not happen, and half of these exist to prove things DO —
 * because the flash deliberately drops three of the toast's six suppressions,
 * and a rule dropped by accident looks exactly like a rule dropped on purpose
 * until something asserts it.
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

const NOW = 1_700_000_000_000;

const detect = (
  before: FleetSnapshot[] | null,
  after: FleetSnapshot[],
  over: Partial<Parameters<typeof detectFlashes>[0]> = {},
) =>
  detectFlashes({
    previous: before === null ? null : asMap(before),
    next: after,
    feedStaleBefore: false,
    feedStaleNow: false,
    now: NOW,
    ...over,
  });

describe('what flashes', () => {
  it('flashes on any status change, not only the ones worth a toast', () => {
    const found = detect([truck({ status: 'ON_TIME' })], [truck({ status: 'AT_RISK' })]);
    expect(found.get('t-1')).toEqual({ status: 'AT_RISK', at: NOW });
  });

  it('flashes on the pleasant transitions too', () => {
    expect(detect([truck({ status: 'LATE' })], [truck({ status: 'ON_TIME' })]).size).toBe(
      1,
    );
    expect(
      detect([truck({ status: 'ON_TIME' })], [truck({ status: 'ARRIVED' })]).size,
    ).toBe(1);
  });

  /**
   * The one that justifies putting `forced` in the comparison. A bulk force
   * of LATE onto four trucks, two of which were ALREADY late: without this,
   * exactly those two give no sign the act reached them, and the dispatcher
   * has no way to tell "it worked" from "it silently skipped them".
   */
  it('flashes when a status is forced onto the status it already had', () => {
    const found = detect(
      [truck({ status: 'LATE', forced: false })],
      [truck({ status: 'LATE', forced: true })],
    );
    expect(found.get('t-1')?.status).toBe('LATE');
  });

  it('flashes when an override lifts and the status underneath is unchanged', () => {
    expect(
      detect(
        [truck({ status: 'LATE', forced: true })],
        [truck({ status: 'LATE', forced: false })],
      ).size,
    ).toBe(1);
  });

  it('does not flash a row that changed neither status nor forcing', () => {
    expect(detect([truck()], [truck()]).size).toBe(0);
  });

  /** No ledger, no debounce: the flap that rations a toast does not ration this. */
  it('flashes the same truck again on the next change', () => {
    const one = detect([truck({ status: 'ON_TIME' })], [truck({ status: 'LATE' })]);
    const two = detect([truck({ status: 'LATE' })], [truck({ status: 'ON_TIME' })]);
    expect(one.size).toBe(1);
    expect(two.size).toBe(1);
  });
});

describe('what does not flash', () => {
  it('flashes nothing on first load', () => {
    expect(
      detect(null, [truck({ status: 'LATE' }), truck({ id: 't-2', status: 'AT_RISK' })])
        .size,
    ).toBe(0);
  });

  /**
   * §5.9. The feed dying takes every row to STALE_GPS in one poll and the
   * recovery brings them all back together. Twenty-three rows flashing about
   * one event that happened to none of them is worse than no flash at all.
   */
  it('flashes nothing on either edge of feed staleness', () => {
    const before = [truck({ status: 'ON_TIME' }), truck({ id: 't-2', status: 'LATE' })];
    const after = [
      truck({ status: 'STALE_GPS' }),
      truck({ id: 't-2', status: 'STALE_GPS' }),
    ];
    expect(detect(before, after, { feedStaleNow: true }).size).toBe(0);
    expect(detect(after, before, { feedStaleBefore: true }).size).toBe(0);
  });

  it('does not flash a truck that was not on the board a poll ago', () => {
    const found = detect([truck()], [truck(), truck({ id: 't-9', status: 'LATE' })]);
    expect(found.has('t-9')).toBe(false);
  });
});

describe('grounds', () => {
  it('gives every status a ground', () => {
    for (const status of Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]) {
      expect(FLASH_GROUND[status]).toBeDefined();
    }
  });

  /**
   * §5.1: the three neutral states differ by border, icon and pattern, never
   * by hue. A ground per status rather than per family would have been the
   * first place in the console where they differ by colour.
   */
  it('gives the three neutral states the same ground', () => {
    expect(FLASH_GROUND.NO_APPT).toBe('neutral');
    expect(FLASH_GROUND.STALE_GPS).toBe('neutral');
    expect(FLASH_GROUND.UNASSIGNED).toBe('neutral');
  });
});

describe('the reduced-motion tag clock', () => {
  /**
   * Derived, never pasted (CLAUDE.md). The instant is built from a UTC
   * timestamp and the offset is whatever the zone database says it is on that
   * date — so this test keeps passing across a DST change rather than
   * becoming a twice-yearly failure.
   */
  it('reads the wall clock of the dispatch zone', () => {
    const instant = new Date('2026-06-15T09:11:00Z');
    const offsetMinutes =
      (new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' })).getTime() -
        new Date(
          instant.toLocaleString('en-US', { timeZone: 'America/Chicago' }),
        ).getTime()) /
      60_000;
    const expected = new Date(instant.getTime() - offsetMinutes * 60_000)
      .toISOString()
      .slice(11, 16);
    expect(flashClock(instant, 'America/Chicago')).toBe(expected);
  });

  it('pads to two digits so the tag never changes width', () => {
    expect(flashClock(new Date('2026-06-15T09:05:00Z'), 'UTC')).toBe('09:05');
    expect(flashClock(new Date('2026-06-15T04:05:00Z'), 'UTC')).toBe('04:05');
  });
});
