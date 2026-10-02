'use client';

import type { FleetRow } from '@/server/fleet-query';
import { upcomingLabel } from '@/lib/status';
import { elapsed } from '@/lib/format';
import type { EmptyState } from '@/lib/empty-state';
import { ChipFlip } from '../ChipFlip';
import { apptText } from '../TruckRow';

/**
 * §12.96, stage 2 — the phone's list: one two-line card per truck, below
 * 768px only (`md:hidden`; the desktop list beside it is `max-md:hidden`).
 *
 *   line 1  truck number                                  status chip
 *   line 2  driver · next-stop city · Appt 14:30 CDT
 *
 * The time is the desktop's Appt cell exactly — `by 15:00 CDT` for an FCFS
 * stop — because that is the column the desktop keeps when it is narrow
 * (§12.17 cuts ETA first). The ETA is the truck sheet's (stage 3).
 *
 * No checkboxes, no status rail, no copy or pin buttons: a phone checks the
 * board, it does not work it. Nothing truncates — a long name wraps — so
 * every field reads whole at 320px. Cards carry `data-phone-card`, never
 * `data-row-id`, so no selector for the desktop's rows finds a card too.
 */
export function PhoneCardList({
  rows,
  selectedId,
  feedStale,
  fetchedAt,
  reducedMotion,
  empty,
  onTap,
}: {
  /** In the console's order: chips, search and urgency applied, pinned included. */
  rows: FleetRow[];
  selectedId: string | null;
  feedStale: boolean;
  fetchedAt: string | null;
  reducedMotion: boolean;
  /** Why there are no cards, or null when there are. */
  empty: EmptyState | null;
  onTap: (id: string) => void;
}) {
  return (
    <div
      data-phone-cards=""
      className="h-full min-h-0 overflow-y-auto overscroll-contain bg-surface-base md:hidden"
    >
      {empty ? (
        <div className="px-4 py-6">
          <p className="font-sans text-[15px] font-semibold text-text">{empty.headline}</p>
          <p className="mt-1 font-sans text-[14px] text-text-secondary">{empty.detail}</p>
        </div>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <Card
                row={row}
                selected={row.id === selectedId}
                feedStale={feedStale}
                fetchedAt={fetchedAt}
                reducedMotion={reducedMotion}
                onTap={onTap}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({
  row,
  selected,
  feedStale,
  fetchedAt,
  reducedMotion,
  onTap,
}: {
  row: FleetRow;
  selected: boolean;
  feedStale: boolean;
  fetchedAt: string | null;
  reducedMotion: boolean;
  onTap: (id: string) => void;
}) {
  const stale = feedStale || row.status === 'STALE_GPS';
  const quiet = !feedStale && row.status === 'TOMORROW';
  const stop = row.nextStop;
  const city = stop
    ? stop.city && stop.state
      ? `${stop.city}, ${stop.state}`
      : (stop.addressLine ?? 'No address')
    : 'No next stop';
  const appt = apptText(row);
  // "Appt" says what kind of time it is (stage 3): never mistaken for an ETA.
  const time =
    appt.time === '—' ? 'No appt' : `Appt ${appt.prefix ? `${appt.prefix} ` : ''}${appt.time}`;

  return (
    <button
      type="button"
      data-phone-card={row.id}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onTap(row.id)}
      className={`flex min-h-11 w-full flex-col gap-1.5 border-b border-l-[3px] border-b-line-soft px-3 py-2.5 text-left ${
        selected ? 'border-l-accent bg-row-selected' : 'border-l-transparent'
      } ${row.status === 'UNASSIGNED' && !selected ? 'bg-row-unassigned' : ''}`}
    >
      <span className="flex w-full items-center justify-between gap-3">
        <span
          data-card-field="truck"
          className={`font-sans text-[16px] tabular-nums ${quiet ? 'font-medium text-text-secondary' : 'font-bold text-text'}`}
        >
          {row.truckNumber ?? row.samsaraName}
        </span>
        <span data-card-field="status" className="flex shrink-0 items-center">
          {/* The row's own chip, with the row's own label: the stale age, or which later day. */}
          <ChipFlip
            status={feedStale ? 'STALE_GPS' : row.status}
            forced={!feedStale && row.override !== null}
            label={
              stale
                ? (elapsed(row.recordedAt, fetchedAt ? new Date(fetchedAt) : undefined) ?? undefined)
                : !feedStale && row.status === 'TOMORROW' && row.upcoming
                  ? upcomingLabel(row.upcoming)
                  : undefined
            }
            reducedMotion={reducedMotion}
          />
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-sans text-[14px] leading-snug">
        <span
          data-card-field="driver"
          className={`min-w-0 break-words ${row.driverName ? (quiet ? 'text-text-muted' : 'text-text-secondary') : 'text-status-neutral-fg'}`}
        >
          {row.driverName ?? 'No driver'}
        </span>
        <span aria-hidden="true" className="text-text-muted">
          ·
        </span>
        <span
          data-card-field="city"
          className={`min-w-0 break-words ${stop ? 'text-text-secondary' : 'text-text-muted'}`}
        >
          {city}
        </span>
        <span aria-hidden="true" className="text-text-muted">
          ·
        </span>
        <span
          data-card-field="time"
          className={`min-w-0 font-semibold tabular-nums ${quiet ? 'text-text-secondary' : 'text-text'}`}
        >
          {time}
        </span>
      </span>
    </button>
  );
}
