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

/* ------------------------- the street comparison ------------------------- */

/**
 * §12.55. Whether the street Census matched is the street that was typed.
 *
 * `outcomeFor` checked the state, the city and the ZIP and never the street,
 * so `1907 4TH AVE NW, West Fargo ND 58078` matched `1907 4TH AVE E` — same
 * city, same ZIP, same state, **three miles away on a different street** — and
 * was accepted as `census:in-range`, the top precision level, carrying a
 * ±0.15 mi that understated the real error by twentyfold. Truck 135 sat at
 * its receiver reading AT RISK while the board measured it against a street
 * it had never been on.
 *
 * A match that changes the street is not a match.
 *
 * ## Why this needs a dictionary when `squash` deliberately avoids one
 *
 * `squash` is a cache key: it only has to be stable, and expanding
 * abbreviations there would mean owning a postal table to save a call that
 * costs nothing. This is a different job — it has to decide whether two
 * spellings mean the same place — and that cannot be done without knowing
 * that AVENUE is AVE and NORTHWEST is NW.
 *
 * The dictionary is deliberately small and positional, which is what keeps
 * `squash`'s objection from applying: "ST" is only read as Street when it is
 * the LAST token of the street line, so `St Charles Rd` keeps its saint.
 */

/** Suffixes, canonical form on the right. Positional — only read at the end. */
const STREET_SUFFIX: Record<string, string> = {
  STREET: 'ST', ST: 'ST',
  AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE',
  ROAD: 'RD', RD: 'RD',
  BOULEVARD: 'BLVD', BLVD: 'BLVD',
  DRIVE: 'DR', DR: 'DR',
  LANE: 'LN', LN: 'LN',
  COURT: 'CT', CT: 'CT',
  PLACE: 'PL', PL: 'PL',
  PARKWAY: 'PKWY', PKWY: 'PKWY',
  HIGHWAY: 'HWY', HWY: 'HWY',
  CIRCLE: 'CIR', CIR: 'CIR',
  TERRACE: 'TER', TER: 'TER',
  TRAIL: 'TRL', TRL: 'TRL',
  EXPRESSWAY: 'EXPY', EXPY: 'EXPY',
  TURNPIKE: 'TPKE', TPKE: 'TPKE',
  CROSSING: 'XING', XING: 'XING',
  SQUARE: 'SQ', SQ: 'SQ',
  POINT: 'PT', PT: 'PT',
  RIDGE: 'RDG', RDG: 'RDG',
  WAY: 'WAY', PIKE: 'PIKE', LOOP: 'LOOP', RUN: 'RUN',
};

/** Directionals. These are the ones that carry the error (§12.55). */
const DIRECTIONAL: Record<string, string> = {
  NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S', EAST: 'E', E: 'E', WEST: 'W', W: 'W',
  NORTHEAST: 'NE', NE: 'NE', NORTHWEST: 'NW', NW: 'NW',
  SOUTHEAST: 'SE', SE: 'SE', SOUTHWEST: 'SW', SW: 'SW',
};

/**
 * Everything from here on is about a door, not a street. `UNIT 200` in
 * `1907 4TH AVE NW UNIT 200` must not become part of the name.
 */
const UNIT_MARKER = new Set([
  'UNIT', 'STE', 'SUITE', 'APT', 'APARTMENT', 'BLDG', 'BUILDING', 'FL',
  'FLOOR', 'RM', 'ROOM', 'DEPT', 'DOOR', 'DOCK', 'LOT', 'TRLR', 'SPC',
]);

export interface StreetLine {
  houseNumber: string | null;
  /** The name with directionals and suffix removed: `4TH`, `FULTON INDUSTRIAL`. */
  name: string;
  /** Canonical suffix, or null when the line carries none. */
  suffix: string | null;
  /**
   * Every directional on the line, canonicalised, **position-independent**.
   *
   * A set rather than a pre/post pair because `E 56TH AVE` and `56TH AVE E`
   * are the same street written two ways, and a positional comparison would
   * call them different. What must not be lost is WHICH directional it is.
   */
  directionals: Set<string>;
}

/**
 * Splits a street line into the parts that decide whether it is that street.
 *
 * Takes only the part BEFORE the first comma, because Census returns a whole
 * address (`1907 4TH AVE E, WEST FARGO, ND, 58078`) and `squash` turns commas
 * into spaces — so passing the full string would fold the city, state and ZIP
 * into the street name and make every comparison agree with itself. That is
 * exactly how the first wiring of this guard failed: nine tests went red on a
 * comparator that was right, called with a string it did not expect.
 */
export function parseStreetLine(line: string | null): StreetLine | null {
  const squashed = squash((line ?? '').split(',')[0] ?? null);
  if (squashed === '') return null;

  let tokens = squashed.split(' ').filter(Boolean);
  // A unit marker ends the street: everything after it is interior.
  const marker = tokens.findIndex((t) => UNIT_MARKER.has(t));
  if (marker > 0) tokens = tokens.slice(0, marker);

  let houseNumber: string | null = null;
  if (tokens[0] !== undefined && /^\d+[A-Z]?$/.test(tokens[0])) {
    houseNumber = tokens.shift() ?? null;
  }

  const directionals = new Set<string>();
  // Leading, while more than one token remains — so `1750 S 4800 W` keeps
  // `4800` as the name rather than eating it.
  while (tokens.length > 1 && tokens[0] !== undefined && DIRECTIONAL[tokens[0]]) {
    directionals.add(DIRECTIONAL[tokens.shift()!]!);
  }
  while (
    tokens.length > 1 &&
    tokens[tokens.length - 1] !== undefined &&
    DIRECTIONAL[tokens[tokens.length - 1]!]
  ) {
    directionals.add(DIRECTIONAL[tokens.pop()!]!);
  }

  let suffix: string | null = null;
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && last !== undefined && STREET_SUFFIX[last]) {
    suffix = STREET_SUFFIX[last]!;
    tokens.pop();
  }

  return { houseNumber, name: tokens.join(' '), suffix, directionals };
}

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((v) => b.has(v));

/**
 * Why the matched street is not the typed street, or null when it is.
 *
 * ## The rule, and the evidence for each half
 *
 * Both halves come from real matches in our own data, one wrong and one right:
 *
 *     1907 4TH AVE NW  ->  1907 4TH AVE E        3.02 mi away.  WRONG.
 *     450 E Arthur Gardner -> 450 ARTHUR GARDNER HWY            RIGHT:
 *                                                truck 132 arrived 0.31 mi
 *                                                from it, inside the normal
 *                                                facility spread (§12.54).
 *
 * So a directional **present on one side and absent on the other** is a
 * difference in how the street is written, and refusing on it would have
 * thrown away a match that was correct. A directional **present on both sides
 * and different** is a different street. The set comparison is what separates
 * those two cases, and it is the whole guard.
 *
 * The same asymmetry applies to the suffix: `4801 S California` matched
 * `4801 S CALIFORNIA AVE`, which is right — the dispatcher left the suffix
 * off. `MAIN ST` against `MAIN AVE` is two streets, and both carry one.
 *
 * Absence is never evidence. Disagreement is.
 */
export function streetDisagreement(
  typedLine: string | null,
  matchedLine: string | null,
): string | null {
  const typed = parseStreetLine(typedLine);
  const matched = parseStreetLine(matchedLine);
  // Nothing typed, or nothing to compare against: not this guard's business.
  if (!typed || !matched) return null;

  if (typed.name !== matched.name) {
    return `the street name (${typed.name || '—'} vs ${matched.name || '—'})`;
  }
  if (typed.suffix && matched.suffix && typed.suffix !== matched.suffix) {
    return `the street type (${typed.suffix} vs ${matched.suffix})`;
  }
  if (
    typed.directionals.size > 0 &&
    matched.directionals.size > 0 &&
    !sameSet(typed.directionals, matched.directionals)
  ) {
    const a = [...typed.directionals].join(' ');
    const b = [...matched.directionals].join(' ');
    return `the direction (${a} vs ${b})`;
  }
  return null;
}
