import { describe, expect, it } from 'vitest';
import {
  formatAddress,
  hasStreetLine,
  isAddressEmpty,
  normalizeAddress,
  parseStreetLine,
  streetDisagreement,
  type AddressParts,
} from './address';

/**
 * These tests are load-bearing in a way that is easy to miss: this function
 * decides BOTH whether two stops share a cached geocode AND whether a save
 * spends a provider call. Too loose and two different warehouses share
 * coordinates; too tight and editing an appointment time buys a geocode.
 */

const parts = (over: Partial<AddressParts> = {}): AddressParts => ({
  addressLine: '1804 North Washington Street',
  city: 'Grand Forks',
  state: 'ND',
  zip: '58203',
  ...over,
});

describe('normalizeAddress', () => {
  it('ignores how it was typed', () => {
    const typed = normalizeAddress(parts());
    expect(normalizeAddress(parts({ addressLine: '1804 n. washington st.' }))).not.toBe(typed);

    // Case, punctuation and whitespace are typing, not address.
    expect(
      normalizeAddress(parts({ addressLine: '  1804   North Washington Street  ' })),
    ).toBe(typed);
    expect(normalizeAddress(parts({ city: 'grand forks' }))).toBe(typed);
    expect(normalizeAddress(parts({ state: 'nd' }))).toBe(typed);
  });

  it('collapses ZIP+4 to the 5-digit ZIP', () => {
    expect(normalizeAddress(parts({ zip: '58203-1234' }))).toBe(normalizeAddress(parts()));
  });

  it('turns punctuation into a space rather than removing it', () => {
    // "ST.PAUL" must not become "STPAUL", which would never match "ST PAUL".
    expect(normalizeAddress(parts({ city: 'St.Paul' }))).toBe(
      normalizeAddress(parts({ city: 'ST PAUL' })),
    );
  });

  it('keeps empty fields positional, so a short address cannot collide', () => {
    // A stop whose CITY is "Chicago" and one whose STREET is "Chicago".
    const cityOnly = normalizeAddress({
      addressLine: null,
      city: 'Chicago',
      state: 'IL',
      zip: null,
    });
    const streetOnly = normalizeAddress({
      addressLine: 'Chicago',
      city: null,
      state: 'IL',
      zip: null,
    });
    expect(cityOnly).not.toBe(streetOnly);
  });

  it('separates two different addresses in the same city', () => {
    expect(normalizeAddress(parts({ addressLine: '1806 North Washington Street' }))).not.toBe(
      normalizeAddress(parts()),
    );
  });

  /** The rule that stops an appointment-time edit spending a call. */
  it('is stable when nothing about the address changed', () => {
    expect(normalizeAddress(parts())).toBe(normalizeAddress(parts()));
  });
});

describe('isAddressEmpty', () => {
  it('is true only when every field is blank', () => {
    expect(isAddressEmpty({ addressLine: null, city: null, state: null, zip: null })).toBe(true);
    expect(isAddressEmpty({ addressLine: '  ', city: '', state: null, zip: '' })).toBe(true);
    expect(isAddressEmpty(parts({ addressLine: null, zip: null, state: null }))).toBe(false);
  });
});

describe('hasStreetLine', () => {
  it('decides which confidence tier applies', () => {
    expect(hasStreetLine(parts())).toBe(true);
    expect(hasStreetLine(parts({ addressLine: null }))).toBe(false);
    expect(hasStreetLine(parts({ addressLine: '   ' }))).toBe(false);
  });
});

describe('formatAddress', () => {
  it('reads the way a dispatcher wrote it', () => {
    expect(formatAddress(parts())).toBe(
      '1804 North Washington Street, Grand Forks, ND 58203',
    );
  });

  it('drops missing pieces without leaving punctuation behind', () => {
    expect(formatAddress({ addressLine: null, city: 'Joliet', state: 'IL', zip: null })).toBe(
      'Joliet, IL',
    );
  });
});

/* --------------------- the street comparison (§12.55) -------------------- */

describe('streetDisagreement — a match that changes the street is not a match', () => {
  /**
   * The two real matches that define the rule, one wrong and one right. Both
   * came out of our own data, and they are the reason the test is a set
   * comparison rather than "any difference refuses".
   */
  it('refuses the match that put truck 135 three miles away', () => {
    // Same city, same ZIP, same state — so every other check passed.
    expect(
      streetDisagreement('1907 4TH AVE NW UNIT 200', '1907 4TH AVE E, WEST FARGO, ND, 58078'),
    ).toBe('the direction (NW vs E)');
  });

  it('accepts the match truck 132 actually arrived at', () => {
    // A directional on ONE side only. Refusing this would have thrown away a
    // match measured 0.31 mi from where the truck parked (§12.54).
    expect(
      streetDisagreement('450 E Arthur Gardner', '450 ARTHUR GARDNER HWY, HAZLETON, PA, 18201'),
    ).toBeNull();
  });

  describe('the variations that must survive', () => {
    const good: [string, string][] = [
      // Spelled-out directional and suffix.
      ['5500 East 56th Avenue', '5500 E 56TH AVE, DENVER, CO, 80022'],
      ['2611 South Westmoreland Road', '2611 S WESTMORELAND RD, DALLAS, TX, 75211'],
      ['1804 North Washington St', '1804 N WASHINGTON ST, GRAND FORKS, ND, 58203'],
      // Suffix the dispatcher left off entirely.
      ['4801 S California', '4801 S CALIFORNIA AVE, CHICAGO, IL, 60632'],
      // Trailing directional, both sides.
      ['4400 Fulton Industrial Boulevard SW', '4400 FULTON INDUSTRIAL BLVD SW, ATLANTA, GA, 30336'],
      // A grid address where the "name" is itself a number and a direction.
      ['1750 South 4800 West', '1750 S 4800 W, SALT LAKE CITY, UT, 84104'],
      // Lower case, and a unit the match does not carry.
      ['275 w laraway rd', '275 W LARAWAY RD, JOLIET, IL, 60436'],
      ['1907 4TH AVE NW UNIT 200', '1907 4TH AVE NW, WEST FARGO, ND, 58078'],
      // Ordinal spelling and punctuation.
      ['1285 208th St', '1285 208TH ST, SAINT CROIX FALLS, WI, 54024'],
      ['3636 W STOLLEY PARK RD', '3636 W STOLLEY PARK RD, GRAND ISLAND, NE, 68803'],
    ];
    it.each(good)('accepts %s', (typed, matched) => {
      expect(streetDisagreement(typed, matched)).toBeNull();
    });
  });

  describe('the differences that are a different street', () => {
    it('refuses a different name', () => {
      expect(streetDisagreement('1804 N Washington St', '1804 N MAIN ST, GRAND FORKS, ND')).toBe(
        'the street name (WASHINGTON vs MAIN)',
      );
    });

    it('refuses a different suffix when both carry one', () => {
      // Main St and Main Ave are two streets in a great many towns.
      expect(streetDisagreement('100 Main Street', '100 MAIN AVE, ANYTOWN, MN')).toBe(
        'the street type (ST vs AVE)',
      );
    });

    it('refuses opposite directionals', () => {
      expect(streetDisagreement('100 N Main St', '100 S MAIN ST, ANYTOWN, MN')).toBe(
        'the direction (N vs S)',
      );
    });
  });

  describe('what it refuses to guess about', () => {
    it('says nothing when there is no street line to compare', () => {
      // A city-only stop is the geocoder's business, not this guard's.
      expect(streetDisagreement(null, '1804 N WASHINGTON ST, GRAND FORKS, ND')).toBeNull();
      expect(streetDisagreement('1804 N Washington St', null)).toBeNull();
    });

    it('treats a directional on one side as a spelling difference, not a street', () => {
      // Both directions of the same asymmetry, because it is the half of the
      // rule that a stricter comparison would have got wrong.
      expect(streetDisagreement('450 E Arthur Gardner', '450 ARTHUR GARDNER HWY')).toBeNull();
      expect(streetDisagreement('450 Arthur Gardner', '450 E ARTHUR GARDNER HWY')).toBeNull();
    });

    it('does not read a leading saint as a street suffix', () => {
      // `squash` refuses a suffix dictionary for exactly this reason. The
      // dictionary here is positional, so ST is only Street at the end.
      const parsed = parseStreetLine('1200 St Charles Rd');
      expect(parsed?.name).toBe('ST CHARLES');
      expect(parsed?.suffix).toBe('RD');
    });

    it('keeps a numeric street name out of the house number', () => {
      const parsed = parseStreetLine('1750 S 4800 W');
      expect(parsed?.houseNumber).toBe('1750');
      expect(parsed?.name).toBe('4800');
      expect([...(parsed?.directionals ?? [])].sort()).toEqual(['S', 'W']);
    });
  });
});
