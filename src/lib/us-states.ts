/** US state and territory names, paired with their two-letter codes. */
export const US_STATES: ReadonlyArray<readonly [code: string, name: string]> = [
  ['AL', 'alabama'], ['AK', 'alaska'], ['AZ', 'arizona'], ['AR', 'arkansas'],
  ['CA', 'california'], ['CO', 'colorado'], ['CT', 'connecticut'],
  ['DE', 'delaware'], ['DC', 'district of columbia'], ['FL', 'florida'],
  ['GA', 'georgia'], ['HI', 'hawaii'], ['ID', 'idaho'], ['IL', 'illinois'],
  ['IN', 'indiana'], ['IA', 'iowa'], ['KS', 'kansas'], ['KY', 'kentucky'],
  ['LA', 'louisiana'], ['ME', 'maine'], ['MD', 'maryland'],
  ['MA', 'massachusetts'], ['MI', 'michigan'], ['MN', 'minnesota'],
  ['MS', 'mississippi'], ['MO', 'missouri'], ['MT', 'montana'],
  ['NE', 'nebraska'], ['NV', 'nevada'], ['NH', 'new hampshire'],
  ['NJ', 'new jersey'], ['NM', 'new mexico'], ['NY', 'new york'],
  ['NC', 'north carolina'], ['ND', 'north dakota'], ['OH', 'ohio'],
  ['OK', 'oklahoma'], ['OR', 'oregon'], ['PA', 'pennsylvania'],
  ['PR', 'puerto rico'], ['RI', 'rhode island'], ['SC', 'south carolina'],
  ['SD', 'south dakota'], ['TN', 'tennessee'], ['TX', 'texas'], ['UT', 'utah'],
  ['VT', 'vermont'], ['VA', 'virginia'], ['WA', 'washington'],
  ['WV', 'west virginia'], ['WI', 'wisconsin'], ['WY', 'wyoming'],
] as const;

const NAME_BY_CODE = new Map(
  US_STATES.map(([code, name]) => [code.toLowerCase(), name]),
);
const BY_NAME = US_STATES.map(([code, name]) => ({
  code: code.toLowerCase(),
  name,
}));

/** Shortest prefix allowed to stand for a state name. "kan" reaches Kansas. */
const MIN_NAME_PREFIX = 3;

/**
 * Expands a query into every string worth matching, in both directions
 * (design-spec §12.7).
 *
 *   "kan"    -> ["kan", "ks"]       Kansas by prefix. This is what makes the
 *                                   `2d` mockup's otherwise-impossible
 *                                   highlight of "KS" in "Wichita, KS"
 *                                   correct.
 *   "kansas" -> ["kansas", "ks"]
 *   "ks"     -> ["ks", "kansas"]    exact code, expanded to the full name
 *   "new"    -> ["new", "nh", "nj", "nm", "ny"]
 *
 * Name expansion needs three characters, so a two-letter query cannot drag in
 * every state that happens to begin with those letters.
 */
export function expandQuery(raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const out = new Set<string>([q]);

  if (q.length === 2) {
    const name = NAME_BY_CODE.get(q);
    if (name) out.add(name);
  }

  if (q.length >= MIN_NAME_PREFIX) {
    for (const { code, name } of BY_NAME) {
      if (name.startsWith(q)) out.add(code);
    }
  }

  return [...out];
}
