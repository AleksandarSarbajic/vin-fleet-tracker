/**
 * Display formatting. Every one of these is pure so it can be unit tested,
 * and none of them stores what it produces.
 */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Heading degrees to a compass point, for the popup's "62 mph · heading W".
 *
 * Null in, null out — and the worker already stores NULL on stationary
 * vehicles, because 0 there means "no heading", not "north".
 */
export function compassPoint(heading: number | null): string | null {
  if (heading === null || !Number.isFinite(heading)) return null;
  const normalised = ((heading % 360) + 360) % 360;
  const index = Math.round(normalised / 45) % 8;
  return COMPASS[index] ?? null;
}

/**
 * Elapsed time, in the one format the design uses everywhere: "12s",
 * "9m", "2h 40m". No "GPS" prefix — the chip icon carries that (§12.11).
 */
export function elapsed(
  fromIso: string | null,
  now: Date = new Date(),
): string | null {
  if (!fromIso) return null;
  const then = Date.parse(fromIso);
  if (Number.isNaN(then)) return null;

  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Locales tried, in order, when resolving a zone abbreviation.
 *
 * This list exists because `timeZoneName: 'short'` is LOCALE-dependent, and
 * no single locale gives short names for both sides of the Atlantic:
 *
 *   en-GB, America/Chicago   -> "GMT-5"   en-GB, Europe/Belgrade -> "CEST"
 *   en-US, America/Chicago   -> "CDT"     en-US, Europe/Belgrade -> "GMT+2"
 *
 * The console shows both clocks at once ("CDT · DISPATCH" beside
 * "CET · YOU"), so picking one locale would print an offset in one of them.
 * Try each and take the first real abbreviation.
 */
const ABBREV_LOCALES = ['en-US', 'en-GB'] as const;

/**
 * The zone abbreviation for an instant, computed at render.
 *
 * NEVER stored, never concatenated, never hardcoded — this function is the
 * only place in the product that produces one. Falls back to whatever Intl
 * offers (a "GMT+2" style offset) rather than guessing, because a wrong
 * abbreviation is worse than an ugly true one.
 */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  let fallback = '';
  for (const locale of ABBREV_LOCALES) {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!name) continue;
    if (!fallback) fallback = name;
    if (!name.startsWith('GMT') && !name.startsWith('UTC')) return name;
  }
  return fallback;
}

/**
 * Wall-clock time in a given IANA zone, with its abbreviation, computed at
 * render time from the instant plus the zone.
 *
 * `zone: false` drops the abbreviation, for the one caller whose zone is
 * already printed beside it (§12.80): the header's stale-sync label, which is
 * always dispatch time and sits next to the clock that reads `CDT · DISPATCH`.
 * Every other time on screen keeps it — a list carries CST, MST and PST at
 * once (§7.1).
 */
export function timeInZone(
  instant: Date,
  timeZone: string,
  opts: { weekday?: boolean; zone?: boolean } = {},
): string {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(opts.weekday ? { weekday: 'short' } : {}),
  }).format(instant);
  return opts.zone === false ? clock : `${clock} ${zoneAbbreviation(instant, timeZone)}`;
}

/** Speed for the popup. One decimal is noise on a truck. */
export function mph(speed: number | null): string | null {
  if (speed === null || !Number.isFinite(speed)) return null;
  return `${Math.round(speed)} mph`;
}
