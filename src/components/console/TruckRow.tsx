'use client';

import { memo } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import type { Status } from '@/lib/status';
import { elapsed } from '@/lib/format';
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
          'Unassigned'
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

      {/* TODO(phase 4): Next stop comes from stops — facility, city and dock.
          Left empty rather than invented; fabricating destinations is how the
          design document ended up with a load-number format nobody asked for. */}
      <div className="truncate text-body text-text-muted">—</div>

      <div
        className={`text-right text-body tabular-nums ${quiet ? 'text-text-secondary' : 'font-semibold text-text-muted'}`}
      >
        {/* TODO(phase 4): appointment, rendered in the STOP's zone. */}
        — : —
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
