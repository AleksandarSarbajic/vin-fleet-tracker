/**
 * §12.101 — the driver history page's calendar.
 *
 * A week is an ISO week (`2026-W40`), Monday 00:00 to the next Monday 00:00
 * at the DISPATCH office, America/Chicago. Pure and shared: the server loads
 * a week's records with these bounds and the page labels the same week with
 * them, so the two cannot disagree about where Sunday ends.
 *
 * Calendar arithmetic is done on civil dates (`{y, m, d}`) through
 * `Date.UTC`, which has no daylight saving; only the step from a wall time
 * to an instant touches a zone. That is what makes the fall-back week 169
 * hours long instead of a day short or a day long.
 */

export interface CivilDate {
  y: number;
  /** 1–12. */
  m: number;
  d: number;
}

export interface IsoWeek {
  year: number;
  week: number;
}

const DAY_MS = 86_400_000;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utcOf = (c: CivilDate) => Date.UTC(c.y, c.m - 1, c.d);
const civilOfUtc = (ms: number): CivilDate => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export const addDays = (c: CivilDate, n: number): CivilDate => civilOfUtc(utcOf(c) + n * DAY_MS);

/** Monday 0 … Sunday 6. */
export const weekdayIndex = (c: CivilDate): number => (new Date(utcOf(c)).getUTCDay() + 6) % 7;

export const sameDate = (a: CivilDate, b: CivilDate): boolean =>
  a.y === b.y && a.m === b.m && a.d === b.d;

/** Whole days from `a` to `b`. */
export const daysBetween = (a: CivilDate, b: CivilDate): number =>
  Math.round((utcOf(b) - utcOf(a)) / DAY_MS);

/** The ISO week a date falls in: the week of its Thursday. */
export function isoWeekOf(c: CivilDate): IsoWeek {
  const thursday = addDays(c, 3 - weekdayIndex(c));
  const dayOfYear = daysBetween({ y: thursday.y, m: 1, d: 1 }, thursday);
  return { year: thursday.y, week: Math.floor(dayOfYear / 7) + 1 };
}

/** Week 1 is the week holding January 4th. */
export function mondayOf(w: IsoWeek): CivilDate {
  const jan4 = { y: w.year, m: 1, d: 4 };
  return addDays(jan4, (w.week - 1) * 7 - weekdayIndex(jan4));
}

/** 52 or 53: a year has 53 weeks when December 28th is in week 53. */
export const weeksIn = (year: number): number => isoWeekOf({ y: year, m: 12, d: 28 }).week;

export const formatIsoWeek = (w: IsoWeek): string =>
  `${w.year}-W${String(w.week).padStart(2, '0')}`;

/** `2026-W40`, exactly. Anything else is not a week. */
export function parseIsoWeek(s: string): IsoWeek | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= weeksIn(year) ? { year, week } : null;
}

export const shiftWeek = (w: IsoWeek, n: number): IsoWeek => isoWeekOf(addDays(mondayOf(w), n * 7));

/** How many weeks `w` is after `from` (negative when before). */
export const weeksFrom = (from: IsoWeek, w: IsoWeek): number =>
  Math.round(daysBetween(mondayOf(from), mondayOf(w)) / 7);

/** The date an instant falls on, in `timeZone`. */
export function civilDateIn(instant: Date, timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in `timeZone`. Solved by checking the
 * offset at the first guess and again at the answer, which settles across a
 * transition. Midnight is never in Chicago's skipped hour (2 a.m.), so the
 * week bounds are always exact.
 */
export function zonedWallToUtc(c: CivilDate, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(c.y, c.m - 1, c.d, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  return new Date(wall - offsetAt(first, timeZone));
}

/** Monday 00:00 to the next Monday 00:00, at the dispatch office. */
export function weekBounds(w: IsoWeek, timeZone: string): { start: Date; end: Date } {
  const monday = mondayOf(w);
  return {
    start: zonedWallToUtc(monday, 0, 0, timeZone),
    end: zonedWallToUtc(addDays(monday, 7), 0, 0, timeZone),
  };
}

/** 0 = Monday … 6 = Sunday, or null when the instant is outside the week. */
export function dayIndexIn(instant: Date, w: IsoWeek, timeZone: string): number | null {
  const n = daysBetween(mondayOf(w), civilDateIn(instant, timeZone));
  return n >= 0 && n <= 6 ? n : null;
}

export const currentIsoWeek = (now: Date, timeZone: string): IsoWeek =>
  isoWeekOf(civilDateIn(now, timeZone));

/** "Sep 28 – Oct 4, 2026", "Sep 21 – 27, 2026", "Dec 28, 2026 – Jan 3, 2027". */
export function rangeLabel(w: IsoWeek): string {
  const a = mondayOf(w);
  const b = addDays(a, 6);
  if (a.y !== b.y) return `${MONTH[a.m - 1]} ${a.d}, ${a.y} – ${MONTH[b.m - 1]} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${MONTH[a.m - 1]} ${a.d} – ${MONTH[b.m - 1]} ${b.d}, ${b.y}`;
  return `${MONTH[a.m - 1]} ${a.d} – ${b.d}, ${b.y}`;
}

/** "Current week", "Last week", "12 weeks ago". */
export function weekTag(w: IsoWeek, current: IsoWeek): string {
  const n = -weeksFrom(current, w);
  if (n === 0) return 'Current week';
  if (n === 1) return 'Last week';
  return n > 1 ? `${n} weeks ago` : 'Upcoming';
}

export const monthName = (m: number): string => MONTH[m - 1]!;
