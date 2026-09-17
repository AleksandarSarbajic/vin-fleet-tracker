import { describe, expect, it } from 'vitest';
import {
  formatAddress,
  hasStreetLine,
  isAddressEmpty,
  normalizeAddress,
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
