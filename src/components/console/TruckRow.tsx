'use client';

import { memo } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import {
  basisShort,
  etaCaution,
  etaDetails,
  etaMilesLine,
  type BasisFacts,
} from '@/lib/eta-basis';
import { NoEldTag, needsNoEldTag } from '@/components/DriverName';
export { basisShort, etaCaution, etaDetails, type BasisFacts };
import type { Status } from '@/lib/status';
import { elapsed, timeInZone } from '@/lib/format';
import { highlight } from '@/lib/search';
import { StatusChip } from './StatusChip';
import { ROW_HEIGHT, type Density } from '@/lib/density';

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

/**
 * Status ink for the ETA cell (§12.49).
 *
 * The design colours the ETA and nothing else in the row. Verified cell by
 * cell against the drawn LATE row: the stripe and the chip carry
 * `status.late.fg`, the ETA `17:05` carries it at weight 500, and the Next
 * stop address stays `text.secondary`. Same across every drawn state —
 * AT_RISK `08:50` in `status.risk.fg`, ON_TIME `07:30` in `status.ontime.fg`.
 *
 * The Appt time is `text.DEFAULT` in every one of them, which is what §5.9
 * means by "appointment times stay full strength": it is the one number that
 * never carries feed-derived colour, and that is what makes it trustworthy
 * when the feed dies.
 *
 * A static map because Tailwind cannot see a class name assembled at runtime.
 */
const ETA_INK: Record<Status, string> = {
  LATE: 'text-status-late-fg',
  AT_RISK: 'text-status-risk-fg',
  ON_TIME: 'text-status-ontime-fg',
  ARRIVED: 'text-status-arrived-fg',
  TOMORROW: 'text-status-tomorrow-fg',
  // The three neutral states share one ink here exactly as they do in the
  // chip. §5.1: they are told apart by border, icon and pattern, never hue.
  NO_APPT: 'text-status-neutral-fg',
  STALE_GPS: 'text-status-neutral-fg',
  UNASSIGNED: 'text-status-neutral-fg',
};

/**
 * §14 feature 5. The height is a density token now, not a constant. Re-exported
 * from lib/density so a component and the virtualiser cannot end up reading
 * two different numbers.
 */
export { ROW_HEIGHT };

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
/**
 * §12.49. Which ink the ETA cell takes, and the four cases that refuse it.
 *
 * Measured against every row ground before shipping (§12.49): the worst pair
 * is LATE on a SELECTED row at exactly **7.00** — the floor, with no margin.
 */
function etaInk(row: FleetRow, feedStale: boolean): string {
  /**
   * §5.9, hard requirement. The feed is stale, so the whole board withdraws
   * schedule colour — a green ETA built on nine-minute-old GPS is worse than
   * no ETA. The cell already reads `stale`; it must not read it in green.
   */
  if (feedStale) return 'text-text-muted';

  /**
   * §5.8. The strike-through says this number is not being maintained.
   * Status ink would argue the opposite in the same glance.
   */
  if (row.status === 'UNASSIGNED') return 'text-text-muted line-through';

  /**
   * `no ETA`, `—` and the like are not times, and a status colour on them
   * would make "we cannot project this" look like a schedule judgement.
   */
  if (row.etaAbsence !== 'has-eta' && row.etaAbsence !== 'arrived') {
    return 'text-text-secondary';
  }

  /**
   * `row.status`, not `row.computed` — so a forced override colours the ETA
   * to match the chip it is showing (§9.5: a forced chip keeps the status
   * colour). The two must never disagree on the same row.
   */
  return ETA_INK[row.status];
}

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
      /**
       * §12.57. Two words, because they are two different claims.
       *
       * `arrived` is a measurement: a fix inside the radius, stopped, held
       * across two polls. `marked` is somebody's word for it — typed because
       * the stop's coordinate cannot register an arrival, or because the one
       * that did was wrong. Same slot, same weight, different word, in the
       * same way `NO ELD` says which kind of driver row you are reading.
       *
       * Not a suffix, a badge or a colour: this cell is 44px of a scanned
       * list and the distinction has to survive being read sideways.
       */
      return row.nextStop?.arrivedSource === 'dispatcher' ? 'marked' : 'arrived';
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
      return `${miles} remaining, from the last GPS fix. ${etaCaution(row)}`.trim();
    }
    case 'address-not-located':
      return 'No ETA — this address could not be located, so nothing can be projected for it.';
    case 'no-address':
      return 'No ETA — no address has been entered for this stop yet.';
    case 'suppressed-unassigned':
      return 'Last computed ETA. No driver is assigned, so it is not a projection any more.';
    case 'arrived':
      return row.nextStop?.arrivedSource === 'dispatcher'
        ? 'Marked arrived by a dispatcher. No GPS fix confirmed it — open the stop to see or correct the time.'
        : 'The truck is at the stop. Detected from its GPS position.';
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
  /** §14 feature 5. Drives the row height and the chip size. */
  density: Density;
  selected: boolean;
  query: string;
  onSelect: (id: string) => void;
  /**
   * §12.48. Double-click opens the edit modal — the mouse equivalent of the
   * Enter binding (§12.10), not a new behaviour.
   */
  onEdit: (id: string) => void;
}

function TruckRowImpl({
  row,
  fetchedAt,
  feedStale,
  columns,
  density,
  selected,
  query,
  onSelect,
  onEdit,
}: Props) {
  const reference = fetchedAt ? new Date(fetchedAt) : undefined;
  const quiet = !feedStale && row.status === 'TOMORROW';
  const stale = feedStale || row.status === 'STALE_GPS';
  const unassigned = row.status === 'UNASSIGNED';
  /** §12.47. Null means the cell keeps its single line. */
  const milesLine = columns === 8 ? etaMilesLine(row, feedStale, milesText) : null;

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
      /**
       * §12.46. How the ONE Enter handler, up in Console, knows which row has
       * focus. Tab moves DOM focus without moving the selection, so the two
       * cursors can disagree and the key has to resolve which one it means.
       */
      data-row-id={row.id}
      onClick={() => onSelect(row.id)}
      /**
       * §12.48. The whole row, because a gesture that works on five cells of
       * eight is unlearnable — a dispatcher who finds it on the driver column
       * and finds it dead on the truck column concludes the app is broken.
       *
       * The status chip is the one exclusion: it is the only cell likely to
       * grow a click target of its own.
       *
       * `removeAllRanges` because nothing here is `select-none` and double
       * click's existing meaning is "select a word". Clearing the selection
       * rather than disabling it keeps click-drag copying of a load number or
       * an address working, and loses only the stray word-select that the
       * modal would have covered anyway.
       */
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-no-dblclick]')) return;
        window.getSelection()?.removeAllRanges();
        onEdit(row.id);
      }}
      onKeyDown={(e) => {
        /**
         * Space only. Enter used to be handled here TOO — this selected, the
         * event bubbled to Console's window listener, and that opened the
         * modal on the `selectedId` in its effect closure, which was the
         * value from before this handler ran.
         *
         * So Tab from a selected row A to row B and press Enter, and the
         * modal opened on A. Two owners agreeing by luck is not agreement;
         * Console owns Enter now, and knows about this row through
         * `data-row-id`.
         */
        if (e.key === ' ') {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      style={{ height: ROW_HEIGHT[density] }}
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
          <span className="inline-flex items-baseline gap-1.5">
            <Marked text={row.driverName} query={query} />
            {/* §12.37: the tag goes wherever the name goes. */}
            {needsNoEldTag({
              source: row.driverSource,
              samsaraDriverId: row.driverSamsaraId,
            }) ? (
              <NoEldTag />
            ) : null}
          </span>
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

      {/**
        * The time, with the miles hanging under it (§12.47).
        *
        * The second line is ABSOLUTELY positioned, which is the whole trick.
        * Stacked normally, the two lines form a 35.3px block that `items-
        * center` centres in a 44px row — and measured in Chromium, that puts
        * the ETA time 8.6px above the Appt time in the very next column. Two
        * adjacent numeric columns out of line by 8.6px reads as a bug.
        *
        * Out of flow, the time stays exactly where it was (measured: 22px
        * from the row top, identical to before) and the miles sit at 42.6px
        * in a 44px row.
        */}
      {columns === 8 ? (
        <div title={etaTitle(row)} className="relative text-right">
          <div className={`truncate text-body tabular-nums ${etaInk(row, feedStale)}`}>
            {etaText(row, feedStale)}
          </div>
          {milesLine ? (
            /**
             * `-mt-1` pulls the pair together and off the row's edge (§12.47).
             * At `top-full` alone the baseline sat 14.2px under the time's and
             * 1.9px off the row boundary — it read as belonging to the row
             * below. Measured after: 9.2px under the time, 6.9px of clearance.
             *
             * `text-micro` with `tracking-normal`: the micro size is drawn for
             * uppercase condensed labels and carries .11em, which is wrong
             * under a number.
             *
             * Always muted — one token below the time. The time is the
             * decision; these are supporting detail.
             */
            <div className="absolute inset-x-0 -mt-1 top-full truncate text-micro tracking-normal tabular-nums text-text-muted">
              {milesLine}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end" data-no-dblclick="">
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
    a.density === b.density &&
    a.selected === b.selected &&
    a.query === b.query
  );
});
