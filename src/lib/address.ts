/**
 * Address normalisation. Pure — no I/O, no provider, no database.
 *
 * Two jobs, and they are the same function:
 *
 *  1. The geocode cache key. The same DC typed by two dispatchers on two days
 *     must hit one cache row, or the cache saves nothing.
 *  2. The "did the address change?" test in the stop save. If this says the
 *     address is unchanged, no geocoding call is made — so an appointment-time
 *     edit spends nothing (§12.24).
 *
 * Both jobs want the same thing: a string that ignores how it was typed and
 * changes when the place changes. Getting this wrong is quiet — too loose and
 * two different addresses share coordinates, too tight and every save spends a
 * call. Hence the unit tests.
 */

export interface AddressParts {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Deliberately NOT a street-suffix dictionary.
 *
 * "ST" is Street and also Saint; "DR" is Drive and also Doctor. Expanding
 * abbreviations here would mean owning a US postal abbreviation table and
 * being wrong about the edge cases, to save a geocoding call that costs
 * nothing. The provider normalises far better than we can. All this does is
 * remove the differences that are purely typing: case, punctuation, runs of
 * whitespace.
 */
function squash(value: string | null): string {
  if (value === null) return '';
  return value
    .toUpperCase()
    // Punctuation to spaces, not to nothing: "ST.PAUL" must not become
    // "STPAUL", which would never match "ST PAUL".
    .replace(/[.,#/\\'"()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** US ZIP+4 down to the 5-digit ZIP; the +4 is below geocoding resolution. */
function zip5(value: string | null): string {
  const digits = squash(value).replace(/\D/g, '');
  return digits.slice(0, 5);
}

/**
 * The cache key and the change-detection key.
 *
 * Pipe-separated with empty fields kept, so a stop with no street line
 * ("|CHICAGO|IL|60601") can never collide with one whose street line happens
 * to read "CHICAGO".
 */
export function normalizeAddress(parts: AddressParts): string {
  return [
    squash(parts.addressLine),
    squash(parts.city),
    squash(parts.state),
    zip5(parts.zip),
  ].join('|');
}

/** True when there is nothing to geocode — not a failure, just an empty stop. */
export function isAddressEmpty(parts: AddressParts): boolean {
  return normalizeAddress(parts).replace(/\|/g, '') === '';
}

/**
 * Whether the address is specific enough to expect a building.
 *
 * Drives the confidence cutoff: with a street line we demand that the street
 * number and street both matched; without one, a city centroid is the best
 * anyone could do and refusing it would throw away a usable ETA.
 */
export function hasStreetLine(parts: AddressParts): boolean {
  return squash(parts.addressLine) !== '';
}

/** For the modal warning and the audit payload — human order, human spacing. */
export function formatAddress(parts: AddressParts): string {
  const line = [parts.addressLine, parts.city].filter(Boolean).join(', ');
  const tail = [parts.state, parts.zip].filter(Boolean).join(' ');
  return [line, tail].filter((s) => s !== '').join(', ');
}
