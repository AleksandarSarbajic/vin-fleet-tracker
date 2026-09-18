'use client';

import { memo } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import { basisShort, precisionNote, type BasisFacts } from '@/lib/eta-basis';
export { basisShort, precisionNote, type BasisFacts };
import type { Status } from '@/lib/status';
import { elapsed, timeInZone } from '@/lib/format';
import { highlight } from '@/lib/search';
import { StatusChip } from './StatusChip';

/**
 * design-spec §4.1, with correction 2 applied: Appt 128 AND Status 128, the
 * extra 22px taken out of the two flexible columns.
 *
 *   fixed  3 + 72 + 148 + 128 + 100 + 128 = 579
 *   gaps   7 x 14                         =  98
 *   pad-r                                 =  16
 *                                   total =  693
 */
export const GRID_8 =
  'grid-cols-[3px_72px_148px_minmax(0,1fr)_minmax(0,1.25fr)_128px_100px_128px]';

/**
 * §12.17. Below 900px of LIST width — not viewport width — Position and ETA
 * are cut. Position is carried by the detail panel and the marker; ETA is
 * derived rather than entered. Type and padding are untouched: a dispatcher
 * at 4am reading a 9px row is the failure this design exists to avoid.
 *
 *   fixed  3 + 72 + 148 + 128 + 128 = 479   gaps 5 x 14 = 70   pad-r 16 = 565
 */
export const GRID_6 = 'grid-cols-[3px_72px_148px_minmax(0,1fr)_128px_128px]';

export const ROW_HEIGHT = 44;

/**
 * The 3px status rail (spec §5.5). A class per state, never a hex: the flat
 * states are token utilities and the two patterned ones are the component
 * classes in globals.css, which read the same token.
 *
 * A static map because Tailwind cannot see a class name assembled at runtime.
 */
const RAIL: Record<Status, string> = {
  LATE: 'bg-status-late-fg',
  AT_RISK: 'bg-status-risk-fg',
  ON_TIME: 'bg-status-ontime-fg',
  ARRIVED: 'bg-status-arrived-fg',
  // The quietest rail in the set: the Tomorrow chip's border, not its ink.
  TOMORROW: 'bg-status-tomorrow-bd',
  UNASSIGNED: 'bg-status-neutral-fg',
  NO_APPT: 'rail-dashed',
  STALE_GPS: 'rail-dotted',
};

/**
 * The Next stop cell: city first, because that is what a dispatcher scans
 * for, then the load number — and ONLY when the truck holds more than one
 * open load (§12.13), since with one load the number is noise in a 191px
 * column.
 *
 * §6.2's truncation ladder began "Next stop drops its dock/door detail". That
 * rung is gone with the column (§12.20); the street address lives in the
 * tooltip, where it does not compete with the city.
 */
function nextStopText(row: FleetRow): string {
  const stop = row.nextStop;
  if (!stop) return '—';
  const place =
    stop.city && stop.state ? `${stop.city}, ${stop.state}` : (stop.addressLine ?? '—');
  return row.openLoadCount > 1 && stop.loadNumber
    ? `${place} · ${stop.loadNumber}`
    : place;
}

/** Everything the cell had to drop, plus the stop-local time (§6.2). */
function stopTitle(row: FleetRow): string | null {
  const stop = row.nextStop;
  if (!stop) return null;
  return [
    stop.type === 'PU' ? 'Pick up' : 'Deliver',
    stop.addressLine,
    [stop.city, stop.state, stop.zip].filter(Boolean).join(', '),
    stop.loadNumber ? `Load ${stop.loadNumber}` : 'No load number yet',
    apptTitle(row) ?? 'no appointment',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The appointment, in the STOP's own zone (§7.1) — a single list carries CST,
 * MST and PST at once, which is why every time is labelled. Computed at
 * render from the instant plus the IANA zone; nothing about the abbreviation
 * is stored.
 *
 * An FCFS stop shows `by 15:00 CDT`: its receiving hours are a door that
 * closes, and the closing time is what the status engine measures projected
 * arrival against (§12.22). The full window is in the tooltip.
 */
function apptText(row: FleetRow): { prefix: string | null; time: string } {
  const stop = row.nextStop;
  if (!stop?.apptTz) return { prefix: null, time: '—' };

  if (stop.apptType === 'FCFS') {
    if (!stop.apptEndUtc) return { prefix: null, time: '—' };
    return { prefix: 'by', time: timeInZone(new Date(stop.apptEndUtc), stop.apptTz) };
  }
  if (!stop.apptStartUtc) return { prefix: null, time: '—' };
  return { prefix: null, time: timeInZone(new Date(stop.apptStartUtc), stop.apptTz) };
}

/**
 * Miles remaining, rounded the way a dispatcher would say it.
 *
 * "412 mi", never "411.7 mi" — the projection is a straight line times a
 * fudge factor, and a decimal place claims a precision it does not have.
 * Under ten miles the number stops being useful at all: what matters then is
 * that he is basically there, so it says so.
 */
export function milesText(miles: number | null): string | null {
  if (miles === null) return null;
  if (miles < 10) return 'arriving';
  return `${Math.round(miles)} mi`;
}

/**
 * What KIND of number this ETA is (§12.30).
 *
 * A dispatcher deciding whether to phone a receiver needs to know whether
 * they are looking at a street address or a ZIP centroid four miles wide.
 * Printing the time alone makes those two look identical, which is the same
 * mistake as the em dash that hid "we cannot project this" behind "nothing
 * entered yet".
 */
/**
 * The ETA cell.
 *
 * An absent ETA says WHY (§12.24), and says WHICH kind of absent: an address
 * that failed to locate needs somebody to look at it, an empty one does not.
 * Both rendered as an em dash before, which is the same as not saying.
 *
 * Miles are NOT here. The column is 128px and already tight with a time in
 * it; the distance goes in the tooltip, and on the map popup where there is
 * room to read it (§12.24).
 *
 * UNASSIGNED keeps its last computed value, struck through by the class
 * above: an ETA with no driver is fiction, but blanking it loses information
 * the dispatcher had a moment ago (§5.8).
 */
function etaText(row: FleetRow, feedStale: boolean): string {
  // Every ETA reads `stale` while the feed is down: the projection is built
  // on a position we no longer trust (§5.9).
  if (feedStale) return 'stale';
  const zone = row.nextStop?.apptTz;
  switch (row.etaAbsence) {
    case 'has-eta':
      return row.etaUtc && zone ? timeInZone(new Date(row.etaUtc), zone) : '—';
    case 'suppressed-unassigned':
      return row.lastComputedEtaUtc && zone
        ? timeInZone(new Date(row.lastComputedEtaUtc), zone)
        : '—';
    case 'address-not-located':
      return 'no ETA';
    case 'no-address':
      return 'no ETA';
    case 'arrived':
      return 'arrived';
    case 'no-appointment':
      return '—';
  }
}

function etaTitle(row: FleetRow): string | undefined {
  switch (row.etaAbsence) {
    case 'has-eta': {
      const miles = milesText(row.milesRemaining);
      if (!miles) return undefined;
      // The ETA departs from the GPS fix, not from the clock — saying so here
      // is what makes a time in the past read as information rather than a bug.
      return `${miles} remaining, from the last GPS fix. ${precisionNote(row)}`.trim();
    }
    case 'address-not-located':
      return 'No ETA — this address could not be located, so nothing can be projected for it.';
    case 'no-address':
      return 'No ETA — no address has been entered for this stop yet.';
    case 'suppressed-unassigned':
      return 'Last computed ETA. No driver is assigned, so it is not a projection any more.';
    case 'arrived':
      return 'The truck is at the stop.';
    default:
      return undefined;
  }
}

function apptTitle(row: FleetRow): string | null {
  const stop = row.nextStop;
  if (!stop?.apptTz || !stop.apptStartUtc) return null;
  const from = timeInZone(new Date(stop.apptStartUtc), stop.apptTz, { weekday: true });
  if (stop.apptType !== 'FCFS' || !stop.apptEndUtc) return from;
  // The whole window, since the cell only had room for the deadline.
  const to = timeInZone(new Date(stop.apptEndUtc), stop.apptTz);
  return `FCFS receiving hours ${from} to ${to} — no slot, the deadline is ${to}`;
}

/** The chip's own Unassigned glyph, at row scale. */
function DriverSlash() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M8 21v-2a4 4 0 0 1 4-4h1" />
      <circle cx="12" cy="7" r="3.5" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  const parts = highlight(text, query);
  if (parts.length <= 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          // A steel plate, never yellow — yellow is spoken for by At risk.
          <span key={i} className="bg-highlight text-text">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

interface Props {
  row: FleetRow;
  /**
   * §5.9, a hard requirement: when the FEED is stale the row withdraws
   * schedule colour entirely. A green row built on nine-minute-old GPS is
   * worse than no row. Appointment times stay full strength — they come from
   * our database, not from the feed.
   */
  feedStale: boolean;
  /**
   * The instant the fleet was fetched, and the reference every age on the row
   * is measured against.
   *
   * NOT `new Date()`. The server renders this row and the browser hydrates it
   * milliseconds later, so a clock read at render time gives "21s" on one
   * side and "24s" on the other — which React reports as a hydration failure
   * and then re-renders the whole tree to recover. Measuring from the fetch
   * instant also states the age more honestly: it is the age of the DATA, not
   * of the paint.
   */
  fetchedAt: string | null;
  columns: 6 | 8;
  selected: boolean;
  query: string;
  onSelect: (id: string) => void;
}

function TruckRowImpl({
  row,
  fetchedAt,
  feedStale,
  columns,
  selected,
  query,
  onSelect,
}: Props) {
  const reference = fetchedAt ? new Date(fetchedAt) : undefined;
  const quiet = !feedStale && row.status === 'TOMORROW';
  const stale = feedStale || row.status === 'STALE_GPS';
  const unassigned = row.status === 'UNASSIGNED';

  const appt = apptText(row);

  const position = stale
    ? `Last seen ${row.cityState ?? '—'}`
    : (row.cityState ?? '—');

  const ground = selected
    ? 'bg-row-selected'
    : unassigned
      ? // Marginally sunken, so it reads as inert rather than urgent — it is a
        // problem of allocation, not of time (design-spec §5.8).
        'bg-row-unassigned'
      : 'hover:bg-row-hover';

  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onSelect(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      style={{ height: ROW_HEIGHT }}
      className={[
        'grid items-center gap-x-[14px] border-b border-line-soft pr-4',
        'cursor-default transition-colors duration-ground outline-offset-[-2px]',
        columns === 8 ? GRID_8 : GRID_6,
        ground,
        // Selection is ground + a 3px steel rail on the LEFT EDGE, so it never
        // fights the status stripe in column one.
        selected ? 'border-l-[3px] border-l-accent' : 'border-l-[3px] border-l-transparent',
      ].join(' ')}
    >
      {/* Every stripe switches to the dotted stale gradient (§5.9). */}
      <div
        className={`h-full ${feedStale ? RAIL.STALE_GPS : RAIL[row.status]}`}
        aria-hidden="true"
      />

      <div
        className={`font-sans text-data tabular-nums ${quiet ? 'font-medium text-text-secondary' : 'font-bold text-text'}`}
      >
        {/* One vehicle in this org is named literally "Truck" — fall back to
            the raw name rather than render a blank cell. */}
        {row.truckNumber ?? row.samsaraName}
      </div>

      <div
        title={row.driverName ?? undefined}
        className={`truncate text-body ${unassigned ? 'text-status-neutral-fg' : quiet ? 'text-text-muted' : 'text-text-secondary'}`}
      >
        {row.driverName ? (
          <Marked text={row.driverName} query={query} />
        ) : (
          /**
           * §12.18: the word `Unassigned` is said ONCE per row, by the chip.
           * Here the absence is the signal — a Driver column that reads as
           * blank scans faster down 23 rows than one repeating a word the
           * chip already carries, and this cell still has to say "no driver"
           * for a truck whose status is NO_APPT rather than UNASSIGNED.
           */
          <span className="flex items-center gap-1.5 text-status-neutral-fg">
            <DriverSlash />
            <span aria-label="No driver assigned">—</span>
          </span>
        )}
      </div>

      {columns === 8 ? (
        <div
          title={row.formattedLocation ?? undefined}
          className={`truncate text-body ${stale ? 'text-status-neutral-fg' : quiet ? 'text-text-secondary font-normal' : 'font-medium text-text'}`}
        >
          <Marked text={position} query={query} />
        </div>
      ) : null}

      <div
        title={stopTitle(row) ?? undefined}
        className={`truncate text-body ${row.nextStop ? 'text-text-secondary' : 'text-text-muted'}`}
      >
        {row.nextStop ? <Marked text={nextStopText(row)} query={query} /> : '—'}
      </div>

      {/**
        * Two slots, not one string.
        *
        * `by 15:00 CDT` as plain text pushes the number left and the column
        * stops aligning — §2 sets tabular numerals on the body precisely so
        * times line up down a column, and a scanning dispatcher loses that
        * the moment one row indents. The prefix gets its own fixed cell, so
        * every time in the column starts at the same x whether or not the
        * row is FCFS, and the marker reads as an annotation rather than as
        * part of the number.
        */}
      <div
        title={apptTitle(row) ?? undefined}
        className={`grid grid-cols-[18px_1fr] items-baseline justify-items-end text-body font-semibold tabular-nums ${quiet ? 'text-text-secondary' : 'text-text'}`}
      >
        <span className="font-cond text-[11px] font-medium uppercase tracking-[.06em] text-text-muted">
          {appt.prefix ?? ''}
        </span>
        <span>{appt.time}</span>
      </div>

      {columns === 8 ? (
        <div
          title={etaTitle(row)}
          className={`truncate text-right text-body tabular-nums ${
            unassigned ? 'text-text-muted line-through' : 'text-text-secondary'
          }`}
        >
          {etaText(row, feedStale)}
        </div>
      ) : null}

      <div className="flex justify-end">
        {/* A dotted neutral chip carrying the age, fleet-wide (§5.9). */}
        <StatusChip
          status={feedStale ? 'STALE_GPS' : row.status}
          forced={!feedStale && row.override !== null}
          label={
            stale ? (elapsed(row.recordedAt, reference) ?? undefined) : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Memoised on the fields that actually change. A poll replaces the array every
 * 20 seconds; without this every visible row re-renders even when its values
 * are identical.
 */
export const TruckRow = memo(TruckRowImpl, (a, b) => {
  return (
    a.row === b.row &&
    a.fetchedAt === b.fetchedAt &&
    a.feedStale === b.feedStale &&
    a.columns === b.columns &&
    a.selected === b.selected &&
    a.query === b.query
  );
});
