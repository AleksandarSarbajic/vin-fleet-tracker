import { timeInZone } from '@/lib/format';
import type { LOAD_STATUSES } from '@/lib/loads';
import {
  addDays,
  civilDateIn,
  dayIndexIn,
  formatIsoWeek,
  mondayOf,
  monthName,
  rangeLabel,
  weekBounds,
  weekdayIndex,
  zonedWallToUtc,
  type IsoWeek,
} from '@/lib/history-week';

/**
 * §12.101 — the driver history page: one row per driver, one column per day,
 * each load on the day of its first arrival (falling back to its first
 * departure) at the dispatch office. Pure, so every rule below is a unit
 * test; `server/history.ts` only fetches the records.
 *
 * Built from `loads` and `stops` only (option A of the plan). Stage 1
 * (§12.97) is what makes those trustworthy from 2026-10-02: before it, a
 * reached stop was often typed over with the next trip, and the page says so
 * on those weeks.
 */

type LoadStatus = (typeof LOAD_STATUSES)[number];

export interface HistoryStop {
  type: 'PU' | 'DEL';
  sequence: number;
  city: string | null;
  state: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
  /** §12.118. Who recorded the departure. Null with no departure. */
  departedSource: 'detected' | 'dispatcher' | null;
}

export interface HistoryLoad {
  id: string;
  number: string | null;
  status: LoadStatus;
  truckId: string | null;
  truckLabel: string | null;
  createdAt: string;
  stops: HistoryStop[];
}

export interface HistoryAssignment {
  driverId: string;
  driverName: string;
  truckId: string;
  truckLabel: string;
  startedAt: string;
  endedAt: string | null;
}

export type EntryStatus = 'delivered' | 'cancelled' | 'tonu' | 'progress';

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  tonu: 'TONU',
  progress: 'In progress',
};

/** The cell's text: `PU Joliet, IL`, `DEL, no place entered`, `Melrose Park, IL → Fargo, ND`. */
export interface RouteText {
  /** The PU / DEL label, styled apart; null for a route with both ends. */
  pre: 'PU' | 'DEL' | null;
  full: string;
}

export interface HistoryEntry {
  key: string;
  number: string | null;
  status: EntryStatus;
  route: RouteText;
  /** Shown on the load only when the driver used more than one truck this week. */
  truck: string | null;
  tip: {
    title: string;
    route: string;
    stops: { kind: 'Pickup' | 'Delivery'; place: string; arrived: string; departed: string }[];
    missing: string | null;
    meta: string;
  };
}

export interface HistoryRow {
  driverId: string | null;
  name: string;
  trucks: { label: string; days: string | null; partial: boolean }[];
  cells: { entries: HistoryEntry[]; noTruck: boolean }[];
  loadCount: number;
}

export interface HistoryWeekView {
  week: string;
  range: string;
  days: { dow: string; date: number; month: string; iso: string; full: string }[];
  rows: HistoryRow[];
  notReached: {
    loadId: string;
    number: string | null;
    route: RouteText;
    driver: string | null;
    truck: string | null;
    created: string;
  }[];
  noNumber: {
    day: string;
    route: RouteText;
    driver: string | null;
    truck: string | null;
    status: EntryStatus;
  }[];
  counts: { drivers: number; loads: number; notReached: number };
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const NO_DRIVER = 'No driver assigned';

export function entryStatus(status: LoadStatus): EntryStatus {
  if (status === 'DELIVERED') return 'delivered';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'TONU') return 'tonu';
  return 'progress';
}

/** "Fargo, ND", "Fargo", "ND", or null when nothing was entered. */
export function placeOf(stop: Pick<HistoryStop, 'city' | 'state'>): string | null {
  const parts = [stop.city?.trim(), stop.state?.trim()].filter((p): p is string => !!p);
  return parts.length ? parts.join(', ') : null;
}

/** One end, as entered: `DEL Fargo, ND`, or `DEL, no place entered`. */
function oneEnd(stop: HistoryStop): RouteText {
  const place = placeOf(stop);
  return { pre: stop.type, full: place ? `${stop.type} ${place}` : `${stop.type}, no place entered` };
}

const reachedAt = (s: HistoryStop) => s.arrivedAt ?? s.departedAt;

/** First arrival among the stops, else first departure (§12.101's day rule). */
export function anchorOf(stops: readonly HistoryStop[]): number | null {
  const first = (pick: (s: HistoryStop) => string | null) =>
    stops
      .map(pick)
      .filter((t): t is string => t !== null)
      .map((t) => Date.parse(t))
      .sort((a, b) => a - b)[0] ?? null;
  return first((s) => s.arrivedAt) ?? first((s) => s.departedAt);
}

/** A trip: one load, or a pickup load and a delivery load paired by the four rules. */
interface Trip {
  loads: HistoryLoad[];
  stops: HistoryStop[];
  anchor: number;
  truckId: string | null;
  truckLabel: string | null;
  number: string | null;
  status: LoadStatus;
}

const only = (l: HistoryLoad, type: 'PU' | 'DEL') =>
  l.stops.length > 0 && l.stops.every((s) => s.type === type);

/**
 * The four rules, and nothing looser: the same non-empty load number, the
 * same truck, both reached, the pickup first. The earliest qualifying
 * delivery after each pickup, each load used once. A pair the data cannot
 * prove stays two entries.
 */
function pairTrips(loads: readonly HistoryLoad[]): Trip[] {
  const reached = loads
    .map((l) => ({ l, anchor: anchorOf(l.stops) }))
    .filter((x): x is { l: HistoryLoad; anchor: number } => x.anchor !== null)
    .sort((a, b) => a.anchor - b.anchor);
  const used = new Set<string>();
  const trips: Trip[] = [];
  for (const { l: pu, anchor } of reached) {
    if (used.has(pu.id) || !only(pu, 'PU') || !pu.number?.trim() || !pu.truckId) continue;
    const del = reached.find(
      (x) =>
        !used.has(x.l.id) &&
        only(x.l, 'DEL') &&
        x.l.number?.trim() === pu.number!.trim() &&
        x.l.truckId === pu.truckId &&
        x.anchor > anchor,
    );
    if (!del) continue;
    used.add(pu.id).add(del.l.id);
    trips.push({
      loads: [pu, del.l],
      stops: [...pu.stops, ...del.l.stops],
      anchor,
      truckId: pu.truckId,
      truckLabel: pu.truckLabel,
      number: pu.number,
      status: del.l.status,
    });
  }
  for (const { l, anchor } of reached) {
    if (used.has(l.id)) continue;
    trips.push({
      loads: [l],
      stops: [...l.stops].sort((a, b) => a.sequence - b.sequence),
      anchor,
      truckId: l.truckId,
      truckLabel: l.truckLabel,
      number: l.number,
      status: l.status,
    });
  }
  return trips.sort((a, b) => a.anchor - b.anchor);
}

function routeOf(stops: readonly HistoryStop[]): RouteText {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (stops.length > 1 && first.type === 'PU' && last.type === 'DEL') {
    const from = placeOf(first) ?? 'no place entered';
    const to = placeOf(last) ?? 'no place entered';
    return { pre: null, full: `${from} → ${to}` };
  }
  return oneEnd(first);
}

/** The driver on `truckId` at `instant`, if anyone was. */
function driverAt(
  assignments: readonly HistoryAssignment[],
  truckId: string | null,
  instant: number,
): HistoryAssignment | null {
  if (!truckId) return null;
  return (
    assignments
      .filter(
        (a) =>
          a.truckId === truckId &&
          Date.parse(a.startedAt) <= instant &&
          (a.endedAt === null || instant < Date.parse(a.endedAt)),
      )
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null
  );
}

/** "Mon–Wed", "Wed", "Mon, Wed–Fri"; null when it is every day. */
function daySpan(days: readonly boolean[]): string | null {
  if (days.every(Boolean)) return null;
  const runs: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    if (!days[i]) continue;
    let j = i;
    while (j + 1 < 7 && days[j + 1]) j += 1;
    runs.push(i === j ? DOW[i]! : `${DOW[i]}–${DOW[j]}`);
    i = j;
  }
  return runs.join(', ');
}

export function buildHistoryWeek(input: {
  week: IsoWeek;
  timeZone: string;
  loads: readonly HistoryLoad[];
  assignments: readonly HistoryAssignment[];
}): HistoryWeekView {
  const { week, timeZone: tz, loads, assignments } = input;
  const monday = mondayOf(week);
  const { start, end } = weekBounds(week, tz);
  const dayStart = Array.from({ length: 8 }, (_, i) =>
    zonedWallToUtc(addDays(monday, i), 0, 0, tz).getTime(),
  );

  /** "Mon 28 · 06:40 CDT", the day dropped when it matches `sameDayAs`. */
  const stamp = (iso: string, sameDayAs?: string | null): string => {
    const at = new Date(iso);
    const c = civilDateIn(at, tz);
    const time = timeInZone(at, tz);
    if (sameDayAs) {
      const s = civilDateIn(new Date(sameDayAs), tz);
      if (s.y === c.y && s.m === c.m && s.d === c.d) return time;
    }
    return `${DOW[weekdayIndex(c)]} ${c.d} · ${time}`;
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const c = addDays(monday, i);
    return {
      dow: DOW[i]!,
      date: c.d,
      month: monthName(c.m),
      iso: `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`,
      full: `${DOW_FULL[i]}, ${MONTH_FULL[c.m - 1]} ${c.d}, ${c.y}`,
    };
  });

  // Trips in this week, by the pickup's day for a pair.
  const trips = pairTrips(loads).filter((t) => t.anchor >= start.getTime() && t.anchor < end.getTime());

  interface Placed { trip: Trip; day: number; driver: HistoryAssignment | null }
  const placed: Placed[] = trips.map((trip) => ({
    trip,
    day: dayIndexIn(new Date(trip.anchor), week, tz)!,
    driver: driverAt(assignments, trip.truckId, trip.anchor),
  }));

  // Who is on the page: every driver assigned during the week, and anyone a
  // load is attributed to.
  const inWeek = assignments.filter(
    (a) => Date.parse(a.startedAt) < end.getTime() && (a.endedAt === null || Date.parse(a.endedAt) > start.getTime()),
  );
  const drivers = new Map<string, string>();
  for (const a of inWeek) drivers.set(a.driverId, a.driverName);
  for (const p of placed) if (p.driver) drivers.set(p.driver.driverId, p.driver.driverName);

  const rowsFor = (driverId: string | null, name: string): HistoryRow => {
    const mine = placed.filter((p) => (p.driver?.driverId ?? null) === driverId);
    const ownAssignments = driverId === null ? [] : inWeek.filter((a) => a.driverId === driverId);
    const covered = (a: HistoryAssignment, i: number) =>
      Date.parse(a.startedAt) < dayStart[i + 1]! && (a.endedAt === null || Date.parse(a.endedAt) > dayStart[i]!);

    // Trucks, in the order they were first driven this week.
    const truckOrder = [...new Set(
      (driverId === null ? mine.map((p) => p.trip.truckLabel ?? '—') : ownAssignments
        .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
        .map((a) => a.truckLabel)),
    )];
    const trucks = truckOrder.map((label) => {
      if (driverId === null) return { label, days: null, partial: false };
      const spans = Array.from({ length: 7 }, (_, i) =>
        ownAssignments.some((a) => a.truckLabel === label && covered(a, i)),
      );
      const daysText = daySpan(spans);
      return { label, days: daysText, partial: daysText !== null };
    });
    const multi = truckOrder.length > 1;

    const name_ = name;
    const cells = Array.from({ length: 7 }, (_, i) => {
      const entries = mine
        .filter((p) => p.day === i)
        .map((p) => toEntry(p.trip, name_, multi));
      const hasTruck = driverId === null || ownAssignments.some((a) => covered(a, i));
      return { entries, noTruck: !hasTruck && entries.length === 0 };
    });
    return { driverId, name, trucks, cells, loadCount: mine.length };
  };

  const toEntry = (trip: Trip, driverName: string, multi: boolean): HistoryEntry => {
    const kind = entryStatus(trip.status);
    const route = routeOf(trip.stops);
    const unreached = kind === 'progress' ? 'Not yet' : kind === 'delivered' ? 'Not recorded' : 'Not reached';
    const hasPu = trip.stops.some((s) => s.type === 'PU');
    const hasDel = trip.stops.some((s) => s.type === 'DEL');
    const tipRoute =
      route.pre === null
        ? route.full
        : `${route.pre === 'PU' ? 'Pickup' : 'Delivery'}: ${placeOf(trip.stops[0]!) ?? 'no place entered'}`;
    return {
      key: trip.loads.map((l) => l.id).join('+'),
      number: trip.number?.trim() || null,
      status: kind,
      route,
      truck: multi ? trip.truckLabel : null,
      tip: {
        title: trip.number?.trim() ? `Load ${trip.number.trim()}` : 'No load number',
        route: tipRoute,
        stops: trip.stops.map((s) => ({
          kind: s.type === 'PU' ? 'Pickup' : 'Delivery',
          place: placeOf(s) ?? 'No place entered',
          arrived: s.arrivedAt ? stamp(s.arrivedAt) : unreached,
          departed: s.departedAt
            ? // §12.118. A hand departure is said as one, here as on the timeline.
              `${stamp(s.departedAt, s.arrivedAt)}${s.departedSource === 'dispatcher' ? ', marked by hand' : ''}`
            : s.arrivedAt && kind === 'progress'
              ? 'Not yet'
              : unreached,
        })),
        missing: !hasPu
          ? 'No pickup stop in the data for this load.'
          : !hasDel
            ? 'No delivery stop in the data for this load.'
            : null,
        meta: `${driverName} · Truck ${trip.truckLabel ?? '—'}`,
      },
    };
  };

  const rows = [...drivers]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id, name]) => rowsFor(id, name));
  if (placed.some((p) => p.driver === null)) rows.push(rowsFor(null, NO_DRIVER));

  // Created this week, nothing reached.
  const notReached = loads
    .filter((l) => {
      const created = Date.parse(l.createdAt);
      return created >= start.getTime() && created < end.getTime() && !l.stops.some((s) => reachedAt(s));
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((l) => {
      const c = civilDateIn(new Date(l.createdAt), tz);
      const sorted = [...l.stops].sort((a, b) => a.sequence - b.sequence);
      return {
        loadId: l.id,
        number: l.number?.trim() || null,
        route: sorted.length ? routeOf(sorted) : { pre: null, full: 'No stop entered' },
        driver: driverAt(assignments, l.truckId, Date.parse(l.createdAt))?.driverName ?? null,
        truck: l.truckLabel,
        created: `created ${DOW[weekdayIndex(c)]} ${monthName(c.m)} ${c.d}, no arrival recorded`,
      };
    });

  const noNumber = rows.flatMap((row) =>
    row.cells.flatMap((cell, i) =>
      cell.entries
        .filter((e) => e.number === null)
        .map((e) => ({
          day: `${DOW[i]} ${days[i]!.date}`,
          route: e.route,
          driver: row.driverId === null ? null : row.name,
          truck: e.tip.meta.split(' · Truck ')[1] ?? null,
          status: e.status,
        })),
    ),
  );

  return {
    week: formatIsoWeek(week),
    range: rangeLabel(week),
    days,
    rows,
    notReached,
    noNumber,
    counts: {
      drivers: rows.filter((r) => r.driverId !== null).length,
      loads: placed.length,
      notReached: notReached.length,
    },
  };
}
