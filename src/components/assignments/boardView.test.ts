import { describe, expect, it } from 'vitest';
import type { BoardDriver } from '@/server/assignments';
import {
  filterCounts,
  inFilter,
  matchesSearch,
  phoneDigits,
  sharedPhones,
  type BoardRow,
} from './boardView';

/**
 * §12.137, §12.138. The board's search, tabs and shared-phone rule, without
 * a DOM. Invented names and 555 numbers only.
 */

const driver = (over: Partial<BoardDriver> = {}): BoardDriver => ({
  id: 'd-1',
  name: 'Ada Example',
  active: true,
  source: 'samsara',
  samsaraDriverId: 'sd-1',
  phone: null,
  truckId: null,
  truckLabel: null,
  ...over,
});

const row = (n: number, d: BoardDriver | null): BoardRow => ({
  truck: {
    id: `t-${n}`,
    truckNumber: n,
    samsaraName: `Truck ${n}`,
    driverId: d?.id ?? null,
    driverName: d?.name ?? null,
    driverSource: d?.source ?? null,
    driverSamsaraId: d?.samsaraDriverId ?? null,
    since: null,
  },
  label: String(n),
  driverId: d?.id ?? null,
  driver: d,
});

const ADA = driver({ id: 'd-ada', name: 'Ada Example', phone: '7085550101' });
const BO = driver({ id: 'd-bo', name: 'Bo Sample', phone: null });
const CY = driver({ id: 'd-cy', name: 'Cy Handentered', source: 'app', samsaraDriverId: null, phone: '+1 (708) 555-0102' });
const ROWS = [row(401, ADA), row(404, BO), row(410, null), row(412, CY)];

describe('phoneDigits', () => {
  it('ignores punctuation and a leading US 1', () => {
    expect(phoneDigits('+1 (708) 555-0102')).toBe('7085550102');
    expect(phoneDigits('708.555.0102')).toBe('7085550102');
    expect(phoneDigits(null)).toBe('');
  });
});

describe('the search (§12.137)', () => {
  it('finds a truck by its number', () => {
    expect(ROWS.filter((r) => matchesSearch(r, '41')).map((r) => r.label)).toEqual(['410', '412']);
  });

  it('finds a driver by any part of the name, in any case', () => {
    expect(ROWS.filter((r) => matchesSearch(r, 'sAmP')).map((r) => r.label)).toEqual(['404']);
  });

  it('finds a phone by its digits, whatever punctuation either side has', () => {
    expect(ROWS.filter((r) => matchesSearch(r, '555-0102')).map((r) => r.label)).toEqual(['412']);
    expect(ROWS.filter((r) => matchesSearch(r, '(708) 555 0101')).map((r) => r.label)).toEqual(['401']);
  });

  it('matches every row when blank, and an empty truck only by its number', () => {
    expect(ROWS.every((r) => matchesSearch(r, '   '))).toBe(true);
    expect(matchesSearch(row(410, null), 'ada')).toBe(false);
  });

  it('does not match a phone on letters alone', () => {
    expect(matchesSearch(row(401, ADA), 'zz')).toBe(false);
  });
});

describe('the tabs and their counts (§12.137)', () => {
  const none = new Set<string>();

  it('puts each row in the tabs that describe it', () => {
    const where = (key: Parameters<typeof inFilter>[1]) =>
      ROWS.filter((r) => inFilter(r, key, new Set(['d-ada']))).map((r) => r.label);
    expect(where('all')).toEqual(['401', '404', '410', '412']);
    expect(where('noDriver')).toEqual(['410']);
    expect(where('noPhone')).toEqual(['404']);
    expect(where('noEld')).toEqual(['412']);
    expect(where('sharedPhone')).toEqual(['401']);
  });

  it('counts the rows it is handed, which the board builds from the draft', () => {
    expect(filterCounts(ROWS, none)).toEqual({ all: 4, noDriver: 1, noPhone: 1, noEld: 1, sharedPhone: 0 });
    // The same trucks after an edit: 410 takes Bo, 404 is cleared.
    const edited = [row(401, ADA), row(404, null), row(410, BO), row(412, CY)];
    expect(filterCounts(edited, none)).toEqual({ all: 4, noDriver: 1, noPhone: 1, noEld: 1, sharedPhone: 0 });
    expect(edited.filter((r) => inFilter(r, 'noDriver', none)).map((r) => r.label)).toEqual(['404']);
  });
});

describe('a shared phone is counted by DRIVER, not by row (§12.138)', () => {
  it('groups two different drivers with one number, however it was typed', () => {
    const twin = driver({ id: 'd-twin', name: 'Twin Example', phone: '708-555-0101' });
    const groups = sharedPhones([ADA, BO, CY, twin]);
    expect([...groups.keys()]).toEqual(['7085550101']);
    expect(groups.get('7085550101')!.map((d) => d.id)).toEqual(['d-ada', 'd-twin']);
  });

  it('finds nothing when each number is one driver’s, and ignores no-phone drivers', () => {
    const nobody = driver({ id: 'd-x', phone: null });
    expect(sharedPhones([ADA, BO, CY, nobody]).size).toBe(0);
  });

  it('does not call one driver on two trucks a shared phone', () => {
    // A double-booking is two rows with one driver; the rule never sees rows.
    const rows = [row(401, ADA), row(404, ADA)];
    const shared = new Set([...sharedPhones([ADA, BO]).values()].flat().map((d) => d.id));
    expect(rows.filter((r) => inFilter(r, 'sharedPhone', shared))).toHaveLength(0);
  });
});
