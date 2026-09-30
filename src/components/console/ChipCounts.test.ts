import { describe, expect, it } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { outsideList, outsideListText, scopeToList } from '@/lib/truck-lists';
import type { FleetRow } from '@/server/fleet-query';
import type { Status } from '@/lib/status';
import { FILTER_KEYS, chipCounts, passesFilters, type FilterKey } from './FilterChips';

/**
 * §12.8 — the chip counts follow the active shared list (§12.90), and every
 * count is the number of rows its chip alone shows, with or without a list.
 */

const row = (
  id: string,
  status: Status,
  over: { driver?: boolean; active?: boolean } = {},
): FleetRow =>
  fleetRow({
    id,
    status,
    computed: status,
    driverName: over.driver === false ? null : 'Sam Driver',
    active: over.active ?? true,
  });

/** In the list: one of each status, a parked driverless truck, two inactive. */
const IN_LIST = [
  row('L1', 'LATE'),
  row('L2', 'AT_RISK'),
  row('L3', 'ON_TIME'),
  row('L4', 'ARRIVED'),
  row('L5', 'TOMORROW'),
  row('L6', 'STALE_GPS'),
  row('L7', 'UNASSIGNED', { driver: false }),
  row('L8', 'NO_APPT', { driver: false }),
  row('L9', 'LATE', { active: false }),
  row('L10', 'NO_APPT', { active: false }),
];
/** Outside it: two late, one unassigned, and things the note ignores. */
const OUTSIDE = [
  row('O1', 'LATE'),
  row('O2', 'LATE'),
  row('O3', 'UNASSIGNED', { driver: false }),
  row('O4', 'ON_TIME'),
  row('O5', 'LATE', { active: false }),
  row('O6', 'NO_APPT', { driver: false }),
];
const FLEET = [...IN_LIST, ...OUTSIDE];
const MEMBERS = new Set(IN_LIST.map((r) => r.id));

/** What the console shows with exactly this one chip on. */
const shownBy = (rows: FleetRow[], key: FilterKey | 'all') =>
  rows.filter((r) => passesFilters(r, new Set(key === 'all' ? [] : [key]))).length;

describe('with a list active, every count is over the list’s trucks', () => {
  it('counts the list, not the fleet', () => {
    expect(chipCounts(scopeToList(FLEET, MEMBERS))).toEqual({
      late: 1,
      risk: 1,
      ontime: 1,
      arrived: 1,
      tomorrow: 1,
      data: 3,
      inactive: 2,
      // Eight active, less the parked driverless one; the Unassigned one stays.
      drivers: 7,
    });
  });

  it('counts the whole fleet with no list, exactly as before', () => {
    expect(chipCounts(scopeToList(FLEET, null))).toEqual({
      late: 3,
      risk: 1,
      ontime: 2,
      arrived: 1,
      tomorrow: 1,
      data: 5,
      inactive: 3,
      drivers: 11,
    });
  });

  it('reads Inactive 0 for a list whose trucks are all active', () => {
    const allActive = new Set(['L1', 'L2', 'L3']);
    expect(chipCounts(scopeToList(FLEET, allActive)).inactive).toBe(0);
  });

  it('keeps the Unassigned exemption in Drivers only', () => {
    const unassignedOnly = new Set(['L7', 'L8']);
    expect(chipCounts(scopeToList(FLEET, unassignedOnly)).drivers).toBe(1);
    expect(
      scopeToList(FLEET, unassignedOnly)
        .filter((r) => passesFilters(r, new Set(['drivers'])))
        .map((r) => r.id),
    ).toEqual(['L7']);
  });
});

describe('a count is what its chip alone shows', () => {
  for (const [scope, members] of [
    ['the fleet', null],
    ['a list', MEMBERS],
  ] as const) {
    it(`for every chip, over ${scope}`, () => {
      const rows = scopeToList(FLEET, members);
      const counts = chipCounts(rows);
      for (const key of FILTER_KEYS) {
        expect({ key, count: counts[key] }).toEqual({ key, count: shownBy(rows, key) });
      }
      // All: the chip row's own count is the active rows.
      expect(rows.filter((r) => r.active).length).toBe(shownBy(rows, 'all'));
    });
  }
});

describe('the note about trucks outside the list', () => {
  it('counts active late and unassigned trucks outside the list', () => {
    const outside = outsideList(FLEET, MEMBERS);
    expect(outside).toEqual({ late: 2, unassigned: 1 });
    expect(outsideListText(outside!)).toBe('Outside this list: 2 late, 1 unassigned');
  });

  it('says only the parts that are not zero', () => {
    expect(outsideListText({ late: 0, unassigned: 3 })).toBe(
      'Outside this list: 3 unassigned',
    );
    expect(outsideListText({ late: 1, unassigned: 0 })).toBe('Outside this list: 1 late');
  });

  it('is absent with no list, or with nothing to report outside it', () => {
    expect(outsideList(FLEET, null)).toBeNull();
    const quietOutside = new Set([...MEMBERS, 'O1', 'O2', 'O3']);
    // O4 is on time, O5 inactive, O6 parked: none of them is news.
    expect(outsideList(FLEET, quietOutside)).toBeNull();
  });
});
