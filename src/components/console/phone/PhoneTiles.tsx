'use client';

import type { FleetRow } from '@/server/fleet-query';
import { chipCounts, type FilterKey } from '../FilterChips';
import type { HeaderNote } from '../ConsoleHeader';

/**
 * §12.96, stage 1 — the phone's first line under the top bar: All, Late and
 * At risk as 44px+ tiles, each a filter (the same toggles as the desktop
 * chips, counted over the same rows, §12.8), and More, which opens the sheet
 * holding every other filter. Below 768px only.
 */

const TILE_INK = {
  all: 'text-text border-line-control',
  late: 'text-status-late-fg border-status-late-bd',
  risk: 'text-status-risk-fg border-status-risk-bd',
} as const;

/** The chips the tiles do not carry; More says how many of them are on. */
export const MORE_KEYS: FilterKey[] = [
  'ontime',
  'arrived',
  'tomorrow',
  'data',
  'inactive',
  'drivers',
];

export function PhoneTiles({
  rows,
  chips,
  onToggle,
  onReset,
  onMore,
  moreOpen,
}: {
  /** Every truck in scope — the fleet, or the active list's (§12.8). */
  rows: FleetRow[];
  chips: Set<FilterKey>;
  onToggle: (key: FilterKey) => void;
  onReset: () => void;
  onMore: () => void;
  moreOpen: boolean;
}) {
  const counts = chipCounts(rows);
  const all = rows.filter((r) => r.active).length;
  const moreOn = MORE_KEYS.filter((k) => chips.has(k)).length;

  return (
    <div
      role="group"
      // Not the desktop chips' "Filter by status": a label of its own, so no
      // existing selector finds the tiles as well as the chips.
      aria-label="Status tiles"
      className="grid shrink-0 grid-cols-4 gap-2 border-b border-line-soft bg-surface-bar px-3 py-2 md:hidden"
    >
      <Tile
        tile="all"
        label="All"
        count={all}
        selected={chips.size === 0}
        onClick={onReset}
      />
      <Tile
        tile="late"
        label="Late"
        count={counts.late}
        selected={chips.has('late')}
        onClick={() => onToggle('late')}
      />
      <Tile
        tile="risk"
        label="At risk"
        count={counts.risk}
        selected={chips.has('risk')}
        onClick={() => onToggle('risk')}
      />
      <button
        type="button"
        data-phone-more=""
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-label={moreOn > 0 ? `More filters, ${moreOn} on` : 'More filters'}
        onClick={onMore}
        className={`flex h-[52px] min-w-0 flex-col items-center justify-center gap-1 border ${
          moreOn > 0 ? 'border-accent bg-surface-overlay' : 'border-line-control'
        }`}
      >
        <span className="font-sans text-[16px] font-semibold leading-none text-text">
          {moreOn > 0 ? `${moreOn} on` : '···'}
        </span>
        <span className="font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em] text-text-secondary">
          More
        </span>
      </button>
    </div>
  );
}

function Tile({
  tile,
  label,
  count,
  selected,
  onClick,
}: {
  tile: keyof typeof TILE_INK;
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-count-tile={tile}
      aria-pressed={selected}
      aria-label={`${label}, ${count}`}
      onClick={onClick}
      className={`flex h-[52px] min-w-0 flex-col items-center justify-center gap-1 border ${TILE_INK[tile]} ${
        selected ? '!border-accent bg-surface-overlay' : ''
      }`}
    >
      <span
        className={`font-sans text-[20px] font-semibold leading-none tabular-nums ${
          tile === 'all' ? 'text-accent' : ''
        }`}
      >
        {count}
      </span>
      <span className="truncate font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em]">
        {label}
      </span>
    </button>
  );
}

/**
 * The desktop's row-2 notes (§12.8, §12.78, §12.90), which the phone would
 * otherwise lose with that row: a hidden truck is never hidden without a
 * word. Each undoes what it reports, as on the desktop. Only drawn when
 * there is something to say.
 */
export function PhoneNotes({ notes }: { notes: HeaderNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-x-4 border-b border-line-soft bg-surface-bar px-3 md:hidden">
      {notes.map((note) => (
        <button
          key={note.id}
          type="button"
          data-phone-note={note.id}
          onClick={note.onClick}
          className={`min-h-11 text-left font-sans text-[13px] underline-offset-2 ${
            note.tone === 'warn' ? 'text-status-risk-fg' : 'text-text-secondary'
          }`}
        >
          {note.text}
        </button>
      ))}
    </div>
  );
}
