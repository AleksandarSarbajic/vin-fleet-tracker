import { ZONE_BY_STATE } from './geo/zone-by-state';

/**
 * §12.121. An address pasted into Street, split into street, city, state and
 * ZIP. Pure: no React, no network.
 *
 * Certain or marked, never guessed. What the text settles is returned in
 * `values`; what it does not — two lines that could each be the street, a
 * missing state or ZIP, a street and city run together — is returned in
 * `checks`, with the pasted text, and left for the dispatcher. A facility
 * name is never a street: it goes to `leftOut`.
 *
 * Null means "not an address to split": the paste goes in as pasted. That
 * is every single line without a US state AND a ZIP, so a plain street
 * address pastes unchanged.
 */

export type AddressField = 'addressLine' | 'city' | 'state' | 'zip';

export interface PastedAddress {
  values: Partial<Record<AddressField, string>>;
  /** Why a field was not filled, quoting what the paste said. */
  checks: Partial<Record<AddressField, string>>;
  /** Lines that went nowhere — a facility name, an attention line. */
  leftOut: string[];
}

const US = new Set(Object.keys(ZONE_BY_STATE));

/** ` ST 58102`, ` ST 58102-1234`, ` ST` — the end of a city line. */
const CITY_LINE = /^(.*?)[,\s]+([A-Za-z]{2})\.?(?:[,\s]+(\d{5})(?:[-\s]?\d{4})?)?$/;
/** ` 58102` with no state. */
const ZIP_ONLY = /^(.*?)[,\s]+(\d{5})(?:[-\s]?\d{4})?$/;
/** A house number, or a PO box: what a street line starts with. */
const STREET = /^(\d+[A-Za-z]?(?:-\d+)?\s+\S|p\.?\s*o\.?\s*box\b)/i;
/** A unit inside a building — belongs on the street line. */
const UNIT = /^(suite|ste|unit|bldg|building|apt|floor|fl|room|rm|dock|door)\b\.?\s*\S|^#\s*\w/i;
const COUNTRY = /^(usa|us|u\.s\.a?\.?|united states( of america)?)$/i;
/** A Canadian postal code, or a name that says the address is not American. */
const NOT_US = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b(canada|mexico|méxico)\b/i;

const quote = (text: string) => `“${text}”`;

export function splitPastedAddress(text: string): PastedAddress | null {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim().replace(/[\s,]+$/, '').replace(/^[\s,]+/, ''))
    .filter((l) => l !== '');
  if (lines.length === 0) return null;

  if (lines.some((l) => NOT_US.test(l))) {
    if (lines.length === 1) return null;
    return {
      values: {},
      checks: {
        addressLine: `Not a US address, so nothing was split: ${quote(lines.join(', '))}.`,
      },
      leftOut: [],
    };
  }

  // One line: it has to end in a US state and a ZIP, or it is left alone.
  // Its comma parts before the state are read as lines would be, below.
  const segments = lines;
  if (lines.length === 1) {
    const match = CITY_LINE.exec(lines[0]!);
    if (!match || !match[3] || !US.has(match[2]!.toUpperCase())) return null;
  }

  // The city line: the last one ending in a US state (with or without a ZIP),
  // or failing that, in a ZIP alone.
  let cityAt = -1;
  let found: { city: string; state: string | null; zip: string | null } | null = null;
  for (let i = segments.length - 1; i >= 0 && !found; i -= 1) {
    const match = CITY_LINE.exec(segments[i]!);
    if (!match || !US.has(match[2]!.toUpperCase())) continue;
    // Without a ZIP, "123 Main St NE" would read as a city in Nebraska.
    if (!match[3] && STREET.test(match[1]!)) continue;
    cityAt = i;
    found = { city: match[1]!, state: match[2]!.toUpperCase(), zip: match[3] ?? null };
  }
  for (let i = segments.length - 1; i >= 0 && !found; i -= 1) {
    const match = ZIP_ONLY.exec(segments[i]!);
    if (!match || STREET.test(match[1]!)) continue;
    cityAt = i;
    found = { city: match[1]!, state: null, zip: match[2]! };
  }

  // A city line may carry the street too: "4001 Main St, Fargo, ND 58102".
  let above = cityAt === -1 ? segments : segments.slice(0, cityAt);
  const below = cityAt === -1 ? [] : segments.slice(cityAt + 1);
  let city = found?.city.trim() ?? '';
  if (found && city.includes(',')) {
    const parts = commaParts(city);
    city = parts.pop()!;
    above = [...above, ...parts];
  }

  const streets = above.filter((l) => STREET.test(l));
  const units = above.filter((l) => !STREET.test(l) && UNIT.test(l));
  const names = above.filter((l) => !STREET.test(l) && !UNIT.test(l));
  const leftOut = [...names, ...below.filter((l) => !COUNTRY.test(l))];

  // Nothing in it looks like an address at all: paste it as it came.
  if (!found && streets.length === 0) return null;

  const values: PastedAddress['values'] = {};
  const checks: PastedAddress['checks'] = {};

  if (streets.length === 1) {
    values.addressLine = [streets[0]!, ...units].join(' ');
  } else if (streets.length > 1) {
    checks.addressLine = `More than one line could be the street: ${streets.map(quote).join(' or ')}.`;
  } else if (STREET.test(city)) {
    // "4001 Main St Fargo ND 58102": where the street ends and the city
    // begins is not written down.
    const both = `The street and city run together: ${quote(city)}.`;
    checks.addressLine = both;
    checks.city = both;
    city = '';
  } else {
    checks.addressLine = 'No street line in the paste.';
  }

  if (city !== '') values.city = city;
  else if (!checks.city) checks.city = 'No city in the paste.';

  if (found?.state) values.state = found.state;
  else checks.state = found ? `No state in the paste: ${quote(segments[cityAt]!)}.` : 'No state in the paste.';

  if (found?.zip) values.zip = found.zip;
  else checks.zip = found ? `No ZIP in the paste: ${quote(segments[cityAt]!)}.` : 'No ZIP in the paste.';

  return { values, checks, leftOut };
}

function commaParts(line: string): string[] {
  return line
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
}
