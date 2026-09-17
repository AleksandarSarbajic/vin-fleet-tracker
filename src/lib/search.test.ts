import { describe, expect, it } from 'vitest';
import { filterRows, highlight, matches, type Searchable } from './search';
import { expandQuery } from './us-states';

const row = (over: Partial<Searchable> = {}): Searchable => ({
  truckNumber: 1147,
  samsaraName: 'Truck #1147',
  driverName: 'M. Kowalczyk',
  cityState: 'New Lenox, IL',
  formattedLocation: 'Maple Road, New Lenox, IL, 60451',
  ...over,
});

describe('expandQuery', () => {
  it('reaches a state code from a partial name', () => {
    // The `2d` mockup highlights "KS" for the query "kan". Without this that
    // screenshot is impossible.
    expect(expandQuery('kan')).toContain('ks');
  });

  it('maps a full name to its code', () => {
    expect(expandQuery('kansas')).toContain('ks');
  });

  it('maps a code back to its name', () => {
    expect(expandQuery('ks')).toContain('kansas');
  });

  it('will not expand a two-letter query by prefix', () => {
    // "ne" is Nebraska's code, so the name comes back — but Nevada, New
    // Hampshire, New Jersey, New Mexico and New York must not.
    const out = expandQuery('ne');
    expect(out).toContain('nebraska');
    expect(out).not.toContain('nv');
    expect(out).not.toContain('nj');
  });

  it('expands a three-letter prefix across every state that starts with it', () => {
    const out = expandQuery('new');
    expect(out).toEqual(expect.arrayContaining(['nh', 'nj', 'nm', 'ny']));
  });

  it('is empty for a blank query', () => {
    expect(expandQuery('   ')).toEqual([]);
  });
});

describe('matches', () => {
  it('finds a truck by number', () => expect(matches(row(), '1147')).toBe(true));
  it('finds a truck by surname', () => expect(matches(row(), 'kowalczyk')).toBe(true));
  it('is case-insensitive', () => expect(matches(row(), 'KOWALCZYK')).toBe(true));
  it('finds a truck by city', () => expect(matches(row(), 'new lenox')).toBe(true));

  it('finds a Kansas truck from the query "kan"', () => {
    const wichita = row({
      cityState: 'Wichita, KS',
      formattedLocation: 'Wichita, KS, 67202',
    });
    expect(matches(wichita, 'kan')).toBe(true);
  });

  it('finds the same truck from the code', () => {
    expect(matches(row({ cityState: 'Wichita, KS' }), 'ks')).toBe(true);
  });

  it('does not match across a field boundary', () => {
    // "1147 | Truck #1147 | M. Kowalczyk" must not match "1147 truck" as one
    // run of text.
    expect(matches(row(), '1147 truck')).toBe(false);
  });

  it('returns everything for a blank query', () => {
    expect(matches(row(), '')).toBe(true);
  });

  it('searches the whole stored location, not just city and state', () => {
    expect(matches(row(), 'maple road')).toBe(true);
  });
});

describe('filterRows', () => {
  const rows = [
    row({ truckNumber: 1147, cityState: 'New Lenox, IL' }),
    row({ truckNumber: 1203, driverName: 'D. Petrov', cityState: 'Wichita, KS' }),
    row({ truckNumber: 1088, driverName: 'R. Nowak', cityState: 'Toledo, OH' }),
  ];

  it('removes rows and preserves order', () => {
    const out = filterRows(rows, 'kan');
    expect(out).toHaveLength(1);
    expect(out[0]!.truckNumber).toBe(1203);
  });

  it('never re-sorts what it keeps', () => {
    const out = filterRows(rows, 'o');
    expect(out.map((r) => r.truckNumber)).toEqual(
      rows.filter((r) => out.includes(r)).map((r) => r.truckNumber),
    );
  });

  it('returns the original array for a blank query', () => {
    expect(filterRows(rows, '  ')).toBe(rows);
  });
});

describe('highlight', () => {
  it('marks a direct hit', () => {
    expect(highlight('Kansas City, MO', 'kansas')).toEqual([
      { text: 'Kansas', hit: true },
      { text: ' City, MO', hit: false },
    ]);
  });

  it('marks the expanded state code — the `2d` case', () => {
    expect(highlight('Wichita, KS', 'kan')).toEqual([
      { text: 'Wichita, ', hit: false },
      { text: 'KS', hit: true },
    ]);
  });

  it('marks every occurrence', () => {
    const out = highlight('Laredo, TX to Laredo, TX', 'laredo');
    expect(out.filter((s) => s.hit)).toHaveLength(2);
  });

  it('preserves the original casing of the matched text', () => {
    expect(highlight('Kansas City', 'KANSAS')[0]).toEqual({
      text: 'Kansas',
      hit: true,
    });
  });

  it('returns one plain run when nothing matches', () => {
    expect(highlight('Toledo, OH', 'zzz')).toEqual([
      { text: 'Toledo, OH', hit: false },
    ]);
  });

  it('is empty for null text', () => expect(highlight(null, 'x')).toEqual([]));
});
