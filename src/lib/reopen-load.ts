import { z } from 'zod';
import { dispatchTime } from './clear-stop';
import {
  ARRIVAL_DEFAULTS,
  departureCentre,
  type ArrivalAnchor,
  type StopGeo,
} from './arrival';
import { LOAD_STATUSES, LOAD_STATUS_LABEL, isTerminal, type LoadStatus } from './loads';
import { haversineMiles, type ArrivalSource } from './status';

/**
 * §12.107 — Reopen load: undo a close made by mistake, from the Edit Stop
 * modal's "Recently closed on this truck".
 *
 * The rules live here, in plain functions, so the confirm step and the
 * transaction that writes are answered by the same code: what status the load
 * returns to, which arrival anchors come back, which departures will be
 * recorded late, and every sentence the dispatcher reads before confirming.
 *
 * `loads` carries no close time and no version, so the close is known from
 * its audit entry: when, by whom, from which status, and (for Clear stop)
 * where each hand-marked arrival's anchor was. That entry's id is also the
 * concurrency check — a reopen names the close it undoes.
 */

/** A close older than this is a history correction, not a dispatch one. */
export const REOPEN_WINDOW_DAYS = 7;
export const REOPEN_WINDOW_MS = REOPEN_WINDOW_DAYS * 86_400_000;
export const REOPEN_AUDIT_SOURCE = 'operator-reopen-load';

export const OPEN_STATUSES = LOAD_STATUSES.filter((s) => !isTerminal(s)) as [
  LoadStatus,
  ...LoadStatus[],
];

export const ReopenRequest = z
  .object({
    truckId: z.string().uuid(),
    loadId: z.string().uuid(),
    /** The close the dispatcher saw. A newer close, or none, refuses. */
    closeAuditId: z.string().uuid(),
    /**
     * Only when the close's record does not say what the load was before:
     * then the dispatcher chooses, and nothing is preselected.
     */
    status: z.enum(OPEN_STATUSES).optional(),
  })
  .strict();
export type ReopenRequest = z.infer<typeof ReopenRequest>;

/* ----------------------------- the close's record ----------------------- */

const Anchor = z.object({ lat: z.number(), lng: z.number(), recordedAtUtc: z.string() });
const Status = z.enum(LOAD_STATUSES);

/** Clear stop's entry (§12.88): entity `load`, the stops' anchors in `before`. */
const ClearStopEntry = z.object({
  before: z.object({
    loadStatus: Status,
    stops: z.array(z.object({ stopId: z.string(), arrivalAnchor: Anchor.nullable().optional() })),
  }),
  after: z.object({ loadStatus: Status, source: z.literal('operator-clear-stop') }),
});

/** The edit modal's entry: entity `stop`, the load's status before and after. */
const StopSaveEntry = z.object({
  before: z.object({ loadStatus: Status.optional() }).nullable(),
  after: z.object({ loadStatus: Status, loadId: z.string() }),
});

export interface CloseRecord {
  closeAuditId: string;
  closedAt: string;
  closedByName: string | null;
  closedStatus: LoadStatus;
  /** The open status the load had before the close, or null when not recorded. */
  statusBefore: LoadStatus | null;
  /**
   * Each stop's anchor as the close found it. Null when the entry records
   * none (the edit modal's): that close never cleared an anchor, so the row
   * still holds whatever it had.
   */
  anchors: Map<string, ArrivalAnchor | null> | null;
}

/**
 * The close an audit row records, or null when the row is not a close: a
 * terminal status written over a status that was not terminal (or over
 * nothing, for a load created closed).
 */
export function readClose(entry: {
  id: string;
  entity: string;
  createdAt: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
}): CloseRecord | null {
  const base = { closeAuditId: entry.id, closedAt: entry.createdAt, closedByName: entry.actorName };
  if (entry.entity === 'load') {
    const parsed = ClearStopEntry.safeParse({ before: entry.before, after: entry.after });
    if (!parsed.success || !isTerminal(parsed.data.after.loadStatus)) return null;
    const { before, after } = parsed.data;
    return {
      ...base,
      closedStatus: after.loadStatus,
      statusBefore: isTerminal(before.loadStatus) ? null : before.loadStatus,
      anchors: new Map(before.stops.map((s) => [s.stopId, s.arrivalAnchor ?? null])),
    };
  }
  if (entry.entity === 'stop') {
    const parsed = StopSaveEntry.safeParse({ before: entry.before, after: entry.after });
    if (!parsed.success || !isTerminal(parsed.data.after.loadStatus)) return null;
    const was = parsed.data.before?.loadStatus;
    if (was !== undefined && isTerminal(was)) return null;
    return {
      ...base,
      closedStatus: parsed.data.after.loadStatus,
      statusBefore: was ?? null,
      anchors: null,
    };
  }
  return null;
}

/* --------------------------------- stops -------------------------------- */

export interface ReopenStop {
  stopId: string;
  /** "Joliet, IL", or the stop type when no place was entered. */
  place: string;
  lat: number | null;
  lng: number | null;
  precision: 'street' | 'block' | 'zip' | null;
  arrivedAt: string | null;
  arrivedSource: ArrivalSource | null;
  departedAt: string | null;
  /** The anchor on the row now. */
  anchor: ArrivalAnchor | null;
}

/**
 * A stop whose departure can only be measured from an anchor (§12.85): marked
 * arrived by hand, not departed, and area-level or unlocated. A street stop is
 * measured from its own coordinate and never needs one.
 */
export function needsAnchor(stop: ReopenStop): boolean {
  return (
    stop.arrivedAt !== null &&
    stop.arrivedSource === 'dispatcher' &&
    stop.departedAt === null &&
    (stop.precision !== 'street' || stop.lat === null || stop.lng === null)
  );
}

export interface AnchorPlan {
  restored: { stopId: string; place: string; anchor: ArrivalAnchor }[];
  /** Needs one, and the close's record has none: left empty, and said so. */
  missing: { stopId: string; place: string }[];
}

/**
 * Which anchors come back. Only from the close's own record — never guessed
 * from where the truck is now. A stop that still holds an anchor keeps it.
 */
export function planAnchors(stops: readonly ReopenStop[], close: CloseRecord): AnchorPlan {
  const plan: AnchorPlan = { restored: [], missing: [] };
  for (const stop of stops) {
    if (!needsAnchor(stop) || stop.anchor !== null) continue;
    const recorded = close.anchors?.get(stop.stopId) ?? null;
    if (recorded) plan.restored.push({ stopId: stop.stopId, place: stop.place, anchor: recorded });
    else plan.missing.push({ stopId: stop.stopId, place: stop.place });
  }
  return plan;
}

/**
 * Stops whose departure the next sweep will record LATE: arrived, not
 * departed, measurable (after the anchors above come back), and the truck's
 * newest position is already outside the departure radius. The sweep only
 * reads fixes after the arrival in its recent window, so the departure it
 * records is the first one it sees after the reopen, not the real one.
 */
export function lateDepartures(
  stops: readonly ReopenStop[],
  plan: AnchorPlan,
  newest: { lat: number; lng: number } | null,
): { stopId: string; place: string }[] {
  if (newest === null) return [];
  const restored = new Map(plan.restored.map((r) => [r.stopId, r.anchor]));
  return stops
    .filter((stop) => {
      if (stop.arrivedAt === null || stop.departedAt !== null) return false;
      const geo: StopGeo = {
        lat: stop.lat,
        lng: stop.lng,
        precision: stop.precision,
        arrivedAt: stop.arrivedAt,
        departedAt: stop.departedAt,
        arrivedSource: stop.arrivedSource,
        anchor: restored.get(stop.stopId) ?? stop.anchor,
      };
      const centre = departureCentre(geo);
      return (
        centre !== null &&
        haversineMiles(newest, { lat: centre.lat, lng: centre.lng }) > ARRIVAL_DEFAULTS.radiusMiles
      );
    })
    .map((stop) => ({ stopId: stop.stopId, place: stop.place }));
}

/* ------------------------------ the confirm step ------------------------- */

export interface OtherOpenLoad {
  loadId: string;
  loadNumber: string | null;
  createdAt: string;
}

const loadName = (n: string | null) => n ?? 'one with no number';
const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;

/** "Reopen load 12120640?" */
export function reopenTitle(loadNumber: string | null): string {
  return loadNumber === null ? 'Reopen this load (no number)?' : `Reopen load ${loadNumber}?`;
}

export const NO_STATUS_LINE =
  'The record of this close does not say what status the load had. Choose one:';
export const MISSING_ANCHOR = "This stop's arrival won't clear by itself; you can untick it.";
export const NOTHING_ELSE = 'Arrival and departure times and addresses are not changed.';

/**
 * Every sentence the confirm step shows, in order. The first says where the
 * load goes back to — or, when the record cannot say, asks (the choice itself
 * is the component's). The rest appear only where they apply.
 */
export function reopenLines(input: {
  truckName: string;
  loadNumber: string | null;
  close: Pick<CloseRecord, 'closedAt' | 'closedByName' | 'closedStatus' | 'statusBefore'>;
  others: readonly OtherOpenLoad[];
  /** Only the places are said; an `AnchorPlan` fits as it is. */
  plan: { restored: readonly { place: string }[]; missing: readonly { place: string }[] };
  late: readonly { place: string }[];
  dispatchTz: string;
  now: Date;
}): string[] {
  const { close, dispatchTz, now } = input;
  const time = dispatchTime(close.closedAt, dispatchTz, now);
  // "at 08:04 CDT" today; "on Sat 08:04 CDT" when the weekday is named.
  const at = /^\d/.test(time) ? `at ${time}` : `on ${time}`;
  const closed = LOAD_STATUS_LABEL[close.closedStatus];
  const lines: string[] = [
    close.statusBefore === null
      ? NO_STATUS_LINE
      : close.closedByName
        ? `It goes back to ${LOAD_STATUS_LABEL[close.statusBefore]}, the status it had before ${close.closedByName} closed it as ${closed} ${at}.`
        : `It goes back to ${LOAD_STATUS_LABEL[close.statusBefore]}, the status it had before it was closed as ${closed} ${at}.`,
  ];

  if (input.others.length > 0) {
    const names = [loadName(input.loadNumber), ...input.others.map((o) => loadName(o.loadNumber))];
    lines.push(
      `Truck ${input.truckName} will hold ${names.length} open loads: ${listOf(names)}. The board follows the earlier deadline and tags the row +1 load.`,
    );
    for (const other of input.others) {
      if (new Date(other.createdAt) > new Date(close.closedAt)) {
        lines.push(
          `${other.loadNumber ?? 'The load with no number'}, entered ${dispatchTime(other.createdAt, dispatchTz, now)}, is not changed.`,
        );
      }
    }
  }

  for (const r of input.plan.restored) {
    lines.push(`${r.place}: arrival anchor restored, so its departure is measured as before.`);
  }
  for (const m of input.plan.missing) lines.push(`${m.place}: ${MISSING_ANCHOR}`);
  for (const l of input.late) {
    lines.push(
      `Truck ${input.truckName} has left ${l.place} since. Its departure will be recorded from the first position after this reopen, so it can be much later than the real one.`,
    );
  }
  lines.push(NOTHING_ELSE);
  return lines;
}

/** One row of "Recently closed on this truck", as the route sends it. */
export interface RecentlyClosed {
  loadId: string;
  loadNumber: string | null;
  close: Omit<CloseRecord, 'anchors'>;
  others: OtherOpenLoad[];
  restored: { stopId: string; place: string }[];
  missing: { stopId: string; place: string }[];
  late: { stopId: string; place: string }[];
}

/** The row in "Recently closed on this truck": `12120640 · Delivered · Sat 08:04 CDT by Dee Dispatcher`. */
export function recentlyClosedLine(
  load: { loadNumber: string | null; close: Pick<CloseRecord, 'closedStatus' | 'closedAt' | 'closedByName'> },
  dispatchTz: string,
  now: Date,
): string {
  const by = load.close.closedByName ? ` by ${load.close.closedByName}` : '';
  return `${load.loadNumber ?? 'No load number'} · ${LOAD_STATUS_LABEL[load.close.closedStatus]} · ${dispatchTime(load.close.closedAt, dispatchTz, now)}${by}`;
}
