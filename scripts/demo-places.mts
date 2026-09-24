/**
 * The places demo stops use. Shared by `seed:demo` and `demo:relocate` so the
 * two cannot drift — they write the same addresses to the same columns and a
 * divergence would show up as demo data that geocodes in one path and not the
 * other.
 *
 * REAL addresses, deliberately, with no coordinates written here. The seed
 * routes them through the same forward geocode a dispatcher's save uses, so
 * demo data exercises the path real data will. They used to be
 * "1 DEMO Industrial Park" with hand-written lat/lng, which made the demo the
 * one thing on the board that could never exercise the geocoder.
 *
 * Every one of these is verified to resolve against the Census geocoder.
 * `1400 Laraway Road, New Lenox IL` was the first choice and returns ZERO
 * matches — a real road that TIGER does not carry at those numbers — so it
 * was swapped for a Joliet address that does. That is the coverage tradeoff
 * in §12.24, met on the first seven addresses anyone tried.
 */
export const PLACES = [
  { address: '500 East Laraway Road', city: 'Joliet', state: 'IL', zip: '60433', tz: 'America/Chicago' },
  { address: '3902 Main Avenue', city: 'Fargo', state: 'ND', zip: '58103', tz: 'America/Chicago' },
  { address: '5500 East 56th Avenue', city: 'Denver', state: 'CO', zip: '80216', tz: 'America/Denver' },
  { address: '4747 West Buckeye Road', city: 'Phoenix', state: 'AZ', zip: '85043', tz: 'America/Phoenix' },
  { address: '2611 South Westmoreland Road', city: 'Dallas', state: 'TX', zip: '75212', tz: 'America/Chicago' },
  { address: '4400 Fulton Industrial Boulevard SW', city: 'Atlanta', state: 'GA', zip: '30336', tz: 'America/New_York' },
  { address: '1750 South 4800 West', city: 'Salt Lake City', state: 'UT', zip: '84104', tz: 'America/Denver' },
] as const;

/**
 * Re-exported, not redefined. The clear command matches on this exact string,
 * and two copies that drift by one character produce a `--clear` that reports
 * success while leaving the data behind — which is §12.21's failure again by
 * a different route.
 */
export { DEMO_NOTE } from '../src/server/demo-data.ts';

/**
 * Which real place replaces each ORIGINAL seeded city, for `demo:relocate`.
 * Keyed on the city the first seed wrote, which is what is still in the
 * database on rows nobody has edited.
 */
export const RELOCATE_BY_CITY: Record<string, (typeof PLACES)[number]> = {
  'New Lenox': PLACES[0],
  Fargo: PLACES[1],
  Denver: PLACES[2],
  Phoenix: PLACES[3],
  Dallas: PLACES[4],
  Atlanta: PLACES[5],
  'Salt Lake City': PLACES[6],
};
