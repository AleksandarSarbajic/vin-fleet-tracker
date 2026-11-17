import { describe, expect, it } from 'vitest';
import { SUGGEST_SHOWN, matchAddresses, placeLine, type PastAddress } from './past-address';

/** Phase 3bx, QoL 2 (§12.164): what Street address suggests, filtered in the browser. */

const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 12) + n * 3_600_000).toISOString();
const p = (addressLine: string, city: string, state: string, zip: string, uses: number, newest: number): PastAddress => ({
  addressLine,
  city,
  state,
  zip,
  uses,
  lastUsedAt: at(newest),
});
const MILL = p('1200 Mill Rd', 'Bolingbrook', 'IL', '60440', 14, 1);
const CREEK = p('1215 Mill Creek Dr', 'Joliet', 'IL', '60433', 3, 5);
const BROOK = p('88 Millbrook Pkwy', 'Memphis', 'TN', '38118', 6, 2);
const DEPOT = p('77 Depot St', 'Tulsa', 'OK', '74103', 11, 9);
const ALL = [DEPOT, CREEK, BROOK, MILL];

describe('matchAddresses (QoL 2)', () => {
  it('needs two characters: one letter matches half the list', () => {
    expect(matchAddresses(ALL, '')).toEqual([]);
    expect(matchAddresses(ALL, 'm')).toEqual([]);
    expect(matchAddresses(ALL, ' m ')).toEqual([]);
    expect(matchAddresses(ALL, 'mi')).toHaveLength(3);
  });

  it('matches anywhere in street, city, state or ZIP, without case or extra spaces', () => {
    expect(matchAddresses(ALL, 'MILL')).toEqual([MILL, BROOK, CREEK]);
    expect(matchAddresses(ALL, 'tulsa')).toEqual([DEPOT]);
    expect(matchAddresses(ALL, '60433')).toEqual([CREEK]);
    expect(matchAddresses(ALL, 'mill   creek')).toEqual([CREEK]);
    expect(matchAddresses(ALL, ' TN ')).toEqual([BROOK]);
  });

  it('most used first, then the newest', () => {
    const twin = { ...BROOK, addressLine: '90 Millbrook Pkwy', lastUsedAt: at(7) };
    expect(matchAddresses([BROOK, twin, MILL], 'millb')).toEqual([twin, BROOK]);
  });

  it(`shows at most ${SUGGEST_SHOWN}`, () => {
    const many = Array.from({ length: 20 }, (_, i) => p(`${i} Mill Rd`, 'Joliet', 'IL', '60433', 20 - i, i));
    const shown = matchAddresses(many, 'mill');
    expect(shown).toHaveLength(SUGGEST_SHOWN);
    expect(shown.map((s) => s.uses)).toEqual([20, 19, 18, 17, 16, 15]);
  });

  it('nothing that does not hold what was typed', () => {
    expect(matchAddresses(ALL, 'harbor')).toEqual([]);
  });

  it('the place line beside the street, with what is missing left out', () => {
    expect(placeLine(MILL)).toBe('Bolingbrook, IL 60440');
    expect(placeLine({ city: null, state: 'IL', zip: null })).toBe('IL');
    expect(placeLine({ city: 'Joliet', state: null, zip: null })).toBe('Joliet');
  });
});
