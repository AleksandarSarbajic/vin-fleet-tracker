'use client';

import { useEffect } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import type { Status } from '@/lib/status';
import { isTypingTarget } from '@/lib/keymap';

/**
 * design-spec §9.1, §12.8, §12.9.
 *
 * Multi-select — each chip toggles independently, `0` resets to All, and the
 * digits 1–7 toggle them in the order drawn (§8.1). Counts are taken over the
 * rows in SCOPE — the whole fleet, or the active shared list's trucks
 * (§12.90) — and are not search-scoped: with a search narrowing the list to
 * 3 of 23, every chip still reads its full count, because what a chip
 * promises is what you would get if you cleared the search. A chip's count is
 * the number of rows it shows when it is the only chip on (§12.8).
 */

export const FILTER_KEYS = [
  'late',
  'risk',
  'ontime',
  'arrived',
  'tomorrow',
  'data',
  'inactive',
  /**
   * §12.78. Last, so the digits 1–7 keep their meaning and it takes `8`.
   * A chip key rather than a separate switch so the URL, saved views, `0`
   * and the empty states carry it through the paths the chips already use.
   */
  'drivers',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** The chips that select by status. `inactive` and `drivers` are other axes. */
type StatusKey = Exclude<FilterKey, 'inactive' | 'drivers'>;

/** `Data issues` is the combined bucket for the three neutral states (§9.1). */
const STATUSES_IN: Record<StatusKey, Status[]> = {
  late: ['LATE'],
  risk: ['AT_RISK'],
  ontime: ['ON_TIME'],
  arrived: ['ARRIVED'],
  tomorrow: ['TOMORROW'],
  data: ['STALE_GPS', 'UNASSIGNED', 'NO_APPT'],
};

const LABEL: Record<FilterKey, string> = {
  late: 'Late',
  risk: 'At risk',
  ontime: 'On time',
  arrived: 'Arrived',
  // §12.82: the bucket is any later day. The row chip says which one.
  tomorrow: 'Upcoming',
  data: 'Data issues',
  inactive: 'Inactive',
  drivers: 'Drivers only',
};

/** The chip's printed name for a key, for anything that describes a chip set. */
export function chipLabel(key: string): string {
  return (LABEL as Record<string, string>)[key] ?? key;
}

/**
 * The chip's ink (§12.91, header option 6a): always drawn, selected or not,
 * so a count reads in its status colour at a glance. Selected adds the
 * overlay ground and the accent edge. Tokens, never a colour value.
 */
export const CHIP_INK: Record<FilterKey, string> = {
  late: 'text-status-late-fg border-status-late-bd',
  risk: 'text-status-risk-fg border-status-risk-bd',
  ontime: 'text-status-ontime-fg border-status-ontime-bd',
  arrived: 'text-status-arrived-fg border-status-arrived-bd',
  // §12.91: Upcoming is text.secondary here, not status.tomorrow.fg.
  tomorrow: 'text-text-secondary border-line-control',
  data: 'text-status-neutral-fg border-dashed border-status-neutral-bd',
  inactive: 'text-text-secondary border-line-control',
  drivers: 'text-text border-line-control',
};

/** The key that toggles each chip, for its tooltip: "Late · key 1". */
const KEY_OF: Record<FilterKey, string> = Object.fromEntries(
  FILTER_KEYS.map((k, i) => [k, String(i + 1)]),
) as Record<FilterKey, string>;

/**
 * Whether Drivers only hides this row (§12.78): no driver, AND nothing is
 * waiting on one.
 *
 * An UNASSIGNED truck — no driver and a live appointment — is never hidden.
 * It sorts third, after Late and Stale GPS, because it is a load that needs a
 * driver before its deadline, and a view that made it disappear would hide
 * the one driverless truck that matters. `computed` as well as `status`, so a
 * forced status on such a truck does not smuggle it out of view.
 */
export function hiddenAsDriverless(
  row: Pick<FleetRow, 'driverName' | 'status' | 'computed'>,
): boolean {
  return row.driverName === null && row.status !== 'UNASSIGNED' && row.computed !== 'UNASSIGNED';
}

/**
 * Whether a row passes the current selection.
 *
 * With nothing selected the console shows ACTIVE trucks of every status —
 * `Inactive` is the only chip that widens the set rather than narrowing it,
 * because `trucks.active` is a different axis from status (§13.1).
 */
export function passesFilters(row: FleetRow, selected: Set<FilterKey>): boolean {
  // Drivers only is an AND over whatever the other chips chose (§12.78).
  if (selected.has('drivers') && hiddenAsDriverless(row)) return false;

  const narrowing = [...selected].filter((k) => k !== 'drivers');
  if (narrowing.length === 0) return row.active;

  const wantsInactive = narrowing.includes('inactive');
  if (!row.active) return wantsInactive;

  const statusKeys = narrowing.filter((k): k is StatusKey => k !== 'inactive');
  if (statusKeys.length === 0) return wantsInactive ? false : true;
  return statusKeys.some((key) => STATUSES_IN[key].includes(row.status));
}

/**
 * The counts over every row in scope (§12.8): the fleet, or the active list's
 * trucks. Each is what that chip alone would list, so the rows given here must
 * be the same rows the chips then filter.
 */
export function chipCounts(rows: FleetRow[]): Record<FilterKey, number> {
  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0])) as Record<
    FilterKey,
    number
  >;
  for (const row of rows) {
    if (!row.active) {
      counts.inactive += 1;
      continue;
    }
    // What Drivers only alone would list — the same promise every chip makes.
    if (!hiddenAsDriverless(row)) counts.drivers += 1;
    for (const key of FILTER_KEYS) {
      if (key === 'inactive' || key === 'drivers') continue;
      if (STATUSES_IN[key].includes(row.status)) counts[key] += 1;
    }
  }
  return counts;
}

export function FilterChips({
  rows,
  selected,
  onToggle,
  onReset,
}: {
  rows: FleetRow[];
  selected: Set<FilterKey>;
  onToggle: (key: FilterKey) => void;
  onReset: () => void;
}) {
  const counts = chipCounts(rows);

  /** §8.1: 1–7 toggle, 0 resets to All; 8 is Drivers only (§12.78). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '0') {
        event.preventDefault();
        onReset();
        return;
      }
      const index = Number(event.key) - 1;
      const key = FILTER_KEYS[index];
      if (key) {
        event.preventDefault();
        onToggle(key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggle, onReset]);

  return (
    <div className="flex shrink-0 items-center gap-[6px]" role="group" aria-label="Filter by status">
      <Chip
        label="All"
        count={rows.filter((r) => r.active).length}
        selected={selected.size === 0}
        ink="text-text border-line-control"
        countInk="text-accent"
        keyName="0"
        onClick={onReset}
      />
      {FILTER_KEYS.filter((key) => key !== 'drivers').map((key) => (
        <Chip
          key={key}
          label={LABEL[key]}
          count={counts[key]}
          selected={selected.has(key)}
          ink={CHIP_INK[key]}
          keyName={KEY_OF[key]}
          onClick={() => onToggle(key)}
        />
      ))}
      {/* §12.78: a different axis from status, so it stands apart. */}
      <span
        aria-hidden="true"
        data-chip-divider=""
        className="mx-[6px] h-5 w-px shrink-0 bg-line-rule"
      />
      <Chip
        label={LABEL.drivers}
        count={counts.drivers}
        selected={selected.has('drivers')}
        ink={CHIP_INK.drivers}
        keyName={KEY_OF.drivers}
        onClick={() => onToggle('drivers')}
      />
    </div>
  );
}

/**
 * §12.91. Every label in full at every width — a chip or its count never
 * collapses. The header test holds the row to its measured room.
 */
function Chip({
  label,
  count,
  selected,
  ink,
  countInk,
  keyName,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  ink: string;
  /** The count's own ink where it differs from the label's (All). */
  countInk?: string;
  keyName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={`${label} · key ${keyName}`}
      className={`flex h-7 shrink-0 items-center gap-[6px] whitespace-nowrap border px-[9px] font-cond text-[11.5px] font-semibold uppercase leading-none tracking-[.08em] transition-colors duration-ground ${ink} ${
        selected ? '!border-accent bg-surface-overlay' : 'hover:bg-row-hover'
      }`}
    >
      {label}
      <span
        className={`font-sans text-[12px] font-semibold leading-none tabular-nums ${countInk ?? ''}`}
      >
        {count}
      </span>
    </button>
  );
}
