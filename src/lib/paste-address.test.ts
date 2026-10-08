import { describe, expect, it } from 'vitest';
import { splitPastedAddress } from './paste-address';

/** §12.121. Every address here is invented. */

const filled = (street: string, city: string, state: string, zip: string) => ({
  values: { addressLine: street, city, state, zip },
  checks: {},
  leftOut: [],
});

describe('the formats a rate confirmation writes an address in', () => {
  it('street, then city state ZIP on the next line', () => {
    expect(splitPastedAddress('4001 Main St\nFARGO ND 58102')).toEqual(
      filled('4001 Main St', 'FARGO', 'ND', '58102'),
    );
  });

  it('all on one line, with commas', () => {
    expect(splitPastedAddress('4001 Main St, Fargo, ND 58102')).toEqual(
      filled('4001 Main St', 'Fargo', 'ND', '58102'),
    );
  });

  it('ZIP+4: the +4 is dropped, as the save drops it (§12.21)', () => {
    expect(splitPastedAddress('4001 Main St, Fargo, ND 58102-1234')).toEqual(
      filled('4001 Main St', 'Fargo', 'ND', '58102'),
    );
  });

  it('"CITY, ST  ZIP" under the street, double space and all', () => {
    expect(splitPastedAddress('4001 Main St\nFARGO, ND  58102')).toEqual(
      filled('4001 Main St', 'FARGO', 'ND', '58102'),
    );
  });

  it('a facility name above the street is left out, never put in Street', () => {
    expect(splitPastedAddress('Prairie Cold Storage\n4001 Main St\nFargo, ND 58102')).toEqual({
      ...filled('4001 Main St', 'Fargo', 'ND', '58102'),
      leftOut: ['Prairie Cold Storage'],
    });
    expect(splitPastedAddress('Prairie Cold Storage, 4001 Main St, Fargo, ND 58102')).toEqual({
      ...filled('4001 Main St', 'Fargo', 'ND', '58102'),
      leftOut: ['Prairie Cold Storage'],
    });
  });

  it('a suite or unit line joins the street', () => {
    expect(splitPastedAddress('4001 Main St\nSuite 200\nFargo, ND 58102')?.values.addressLine).toBe(
      '4001 Main St Suite 200',
    );
    expect(splitPastedAddress('4001 Main St\nUnit B\nFargo, ND 58102')?.values.addressLine).toBe(
      '4001 Main St Unit B',
    );
  });

  it('blank lines and trailing commas are ignored', () => {
    expect(splitPastedAddress('\n\n4001 Main St,\n\n Fargo, ND 58102,\n\n')).toEqual(
      filled('4001 Main St', 'Fargo', 'ND', '58102'),
    );
  });

  it('a country line under the city is not "left out"', () => {
    expect(splitPastedAddress('4001 Main St\nFargo, ND 58102\nUSA')).toEqual(
      filled('4001 Main St', 'Fargo', 'ND', '58102'),
    );
  });

  it('a street ending in a word that is also a state code stays a street', () => {
    expect(splitPastedAddress('12 Oak Ct\nSpringfield IL 62701')).toEqual(
      filled('12 Oak Ct', 'Springfield', 'IL', '62701'),
    );
    expect(splitPastedAddress('123 Main St NE\nMinneapolis MN 55413')).toEqual(
      filled('123 Main St NE', 'Minneapolis', 'MN', '55413'),
    );
  });
});

describe('plain text is left exactly as pasted', () => {
  it.each([
    ['a street address', '4001 Main St'],
    ['a city and state with no ZIP', 'Fargo, ND'],
    ['a ZIP with no state', '4001 Main St 58102'],
    ['a facility name', 'Prairie Cold Storage'],
    ['a Canadian address on one line', '120 King St W, Toronto, ON M5H 1A1'],
    ['two lines with no address in them', 'Prairie Cold Storage\nDock 4'],
    ['nothing', '  \n '],
  ])('%s', (_, text) => {
    expect(splitPastedAddress(text)).toBeNull();
  });
});

describe('what the paste does not settle is marked, never guessed', () => {
  it('two lines that could each be the street: neither is used', () => {
    const split = splitPastedAddress('4001 Main St\n90 Dock Rd\nFargo, ND 58102')!;
    expect(split.values).toEqual({ city: 'Fargo', state: 'ND', zip: '58102' });
    expect(split.checks.addressLine).toBe(
      'More than one line could be the street: “4001 Main St” or “90 Dock Rd”.',
    );
  });

  it('no ZIP: the rest is filled, the ZIP marked with what the line said', () => {
    const split = splitPastedAddress('4001 Main St\nFargo ND')!;
    expect(split.values).toEqual({ addressLine: '4001 Main St', city: 'Fargo', state: 'ND' });
    expect(split.checks).toEqual({ zip: 'No ZIP in the paste: “Fargo ND”.' });
  });

  it('no state: the same', () => {
    const split = splitPastedAddress('4001 Main St\nFargo 58102')!;
    expect(split.values).toEqual({ addressLine: '4001 Main St', city: 'Fargo', zip: '58102' });
    expect(split.checks).toEqual({ state: 'No state in the paste: “Fargo 58102”.' });
  });

  it('a street and city run together with no comma: state and ZIP only', () => {
    const split = splitPastedAddress('4001 Main St Fargo ND 58102')!;
    expect(split.values).toEqual({ state: 'ND', zip: '58102' });
    expect(split.checks.addressLine).toBe('The street and city run together: “4001 Main St Fargo”.');
    expect(split.checks.city).toBe(split.checks.addressLine);
  });

  it('a Canadian address on several lines: nothing split, and said so', () => {
    expect(splitPastedAddress('120 King St W\nToronto ON M5H 1A1')).toEqual({
      values: {},
      checks: { addressLine: 'Not a US address, so nothing was split: “120 King St W, Toronto ON M5H 1A1”.' },
      leftOut: [],
    });
  });

  it('a facility name and a street with no city line: the street, and the rest marked', () => {
    const split = splitPastedAddress('Prairie Cold Storage\n4001 Main St')!;
    expect(split.values).toEqual({ addressLine: '4001 Main St' });
    expect(split.leftOut).toEqual(['Prairie Cold Storage']);
    expect(Object.keys(split.checks).sort()).toEqual(['city', 'state', 'zip']);
  });
});
