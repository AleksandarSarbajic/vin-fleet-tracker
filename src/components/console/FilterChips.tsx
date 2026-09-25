'use client';

import { useEffect } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import type { Status } from '@/lib/status';
import { isTypingTarget } from '@/lib/keymap';

/**
 * design-spec §9.1, §12.8, §12.9.
 *
 * Multi-select — each chip toggles independently, `0` resets to All, and the
 * digits 1–7 toggle them in the order drawn (§8.1). Counts are FLEET-WIDE,
 * not search-scoped: with a search narrowing the list to 3 of 23, every chip
 * still reads its full count, because what a chip promises is what you would
 * get if you cleared the search.
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
  tomorrow: 'Tomorrow',
  data: 'Data issues',
  inactive: 'Inactive',
  drivers: 'Drivers only',
};

/**
 * Below 1680px (§12.79). `Data` is the spec's own abbreviation for a crowded
 * row (§9.1, `3d`); the full label stays the accessible name.
 */
const SHORT: Partial<Record<FilterKey, string>> = { data: 'Data' };

/** The chip's ink when selected. Tokens, never a colour value. */
const INK: Record<FilterKey, string> = {
  late: 'text-status-late-fg border-status-late-bd',
  risk: 'text-status-risk-fg border-status-risk-bd',
  ontime: 'text-status-ontime-fg border-status-ontime-bd',
  arrived: 'text-status-arrived-fg border-status-arrived-bd',
  tomorrow: 'text-status-tomorrow-fg border-status-tomorrow-bd',
  data: 'text-status-neutral-fg border-status-neutral-bd',
  inactive: 'text-text-muted border-line-hair',
  drivers: 'text-text border-line-soft',
};

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

/** Fleet-wide counts, computed over every row in the payload (§12.8). */
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
    <div className="flex shrink-0 items-center gap-[5px]" role="group" aria-label="Filter by status">
      <Chip
        label="All"
        count={rows.filter((r) => r.active).length}
        selected={selected.size === 0}
        ink="text-text-secondary border-line-hair"
        onClick={onReset}
      />
      {FILTER_KEYS.filter((key) => key !== 'drivers').map((key) => (
        <Chip
          key={key}
          label={LABEL[key]}
          short={SHORT[key]}
          count={counts[key]}
          selected={selected.has(key)}
          ink={INK[key]}
          onClick={() => onToggle(key)}
        />
      ))}
      {/* §12.78: a different axis from status, so it stands apart. */}
      <span aria-hidden="true" data-chip-divider="" className="mx-1 h-4 w-px shrink-0 bg-line-hair" />
      <Chip
        label={LABEL.drivers}
        count={counts.drivers}
        selected={selected.has('drivers')}
        ink={INK.drivers}
        onClick={() => onToggle('drivers')}
      />
    </div>
  );
}

function Chip({
  label,
  short,
  count,
  selected,
  ink,
  onClick,
}: {
  label: string;
  short?: string | undefined;
  count: number;
  selected: boolean;
  ink: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={short ? `${label} ${count}` : undefined}
      className={`flex h-[26px] shrink-0 items-center gap-1.5 border px-2 font-cond text-micro uppercase tracking-[.08em] transition-colors duration-ground ${
        selected ? `bg-surface-overlay ${ink}` : 'border-line-soft text-text-muted hover:bg-row-hover'
      }`}
    >
      {short ? (
        <>
          <span className="min-[1680px]:hidden">{short}</span>
          <span className="hidden min-[1680px]:inline">{label}</span>
        </>
      ) : (
        label
      )}
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}
