'use client';

import { memo } from 'react';
import type { FleetRow } from '@/server/fleet-query';
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
 * for, then the dock detail (§6.2 step 1 of the truncation ladder — the dock
 * is the first thing to go, so it only rides along in the wide layout), then
 * the load number, and ONLY when the truck holds more than one open load
 * (§12.13) — with one load the number is noise in a 191px column.
 */
function nextStopText(row: FleetRow, columns: 6 | 8): string {
  const stop = row.nextStop;
  if (!stop) return '—';
  const place =
    stop.city && stop.state ? `${stop.city}, ${stop.state}` : (stop.facilityName ?? '—');
  const parts = [place];
  if (columns === 8 && stop.dockDoor) parts.push(stop.dockDoor);
  if (row.openLoadCount > 1) parts.push(stop.loadNumber);
  return parts.join(' · ');
}

/** Everything the cell had to drop, plus the stop-local time (§6.2). */
function stopTitle(row: FleetRow): string | null {
  const stop = row.nextStop;
  if (!stop) return null;
  const when =
    stop.apptStartUtc && stop.apptTz
      ? timeInZone(new Date(stop.apptStartUtc), stop.apptTz, { weekday: true })
      : 'no appointment';
  return [
    `${stop.type === 'PU' ? 'Pick up' : 'Deliver'} — ${stop.facilityName ?? 'facility unnamed'}`,
    [stop.city, stop.state].filter(Boolean).join(', '),
    stop.dockDoor,
    `Load ${stop.loadNumber}`,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The appointment, in the STOP's own zone (§7.1) — a single list carries
 * CST, MST and PST at once, which is exactly why every time is labelled.
 * Computed at render from the instant plus the IANA zone; nothing about the
 * abbreviation is stored.
 */
function apptText(row: FleetRow): string {
  const stop = row.nextStop;
  if (!stop?.apptStartUtc || !stop.apptTz) return '—';
  return timeInZone(new Date(stop.apptStartUtc), stop.apptTz);
}

function apptTitle(row: FleetRow): string | null {
  const stop = row.nextStop;
  if (!stop?.apptStartUtc || !stop.apptTz) return null;
  const full = timeInZone(new Date(stop.apptStartUtc), stop.apptTz, { weekday: true });
  // FCFS is a facility cutoff, not a slot (§12.2) — the row says so on hover
  // rather than inventing a glyph the design never drew.
  return stop.apptType === 'FCFS' ? `${full} · FCFS cutoff, not a slot` : full;
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
  columns: 6 | 8;
  selected: boolean;
  query: string;
  onSelect: (id: string) => void;
}

function TruckRowImpl({ row, columns, selected, query, onSelect }: Props) {
  const quiet = row.status === 'TOMORROW';
  const stale = row.status === 'STALE_GPS';
  const unassigned = row.status === 'UNASSIGNED';

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
      <div className={`h-full ${RAIL[row.status]}`} aria-hidden="true" />

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
        {row.nextStop ? <Marked text={nextStopText(row, columns)} query={query} /> : '—'}
      </div>

      <div
        title={apptTitle(row) ?? undefined}
        className={`text-right text-body font-semibold tabular-nums ${quiet ? 'text-text-secondary' : 'text-text'}`}
      >
        {apptText(row)}
      </div>

      {columns === 8 ? (
        <div
          className={`text-right text-body tabular-nums text-text-muted ${unassigned ? 'line-through' : ''}`}
        >
          {/* TODO(phase 5): projected ETA from the status engine. */}
          {stale ? 'stale' : '—'}
        </div>
      ) : null}

      <div className="flex justify-end">
        <StatusChip
          status={row.status}
          label={stale ? (elapsed(row.recordedAt) ?? undefined) : undefined}
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
    a.columns === b.columns &&
    a.selected === b.selected &&
    a.query === b.query
  );
});
