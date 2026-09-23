'use client';

import type { FleetRow } from '@/server/fleet-query';
import { isProblem } from '@/lib/status';

/**
 * The bulk bar (§14, feature 2).
 *
 * §14.5 decided the one thing that mattered about it:
 *
 * > **Bulk bar vs fold footer.** The same slot. The bar replaces the footer
 * > while 2+ are checked, and keeps the one fact that mattered — the
 * > problems-below-the-fold count — at its right end.
 *
 * Replacing rather than stacking is what keeps the list from jumping under a
 * cursor that is mid-click, and carrying the fold count across is what stops
 * the bulk action from costing the dispatcher the one number §3.1 built the
 * footer for.
 *
 * **Deviation from the brief, deliberate:** §14.5 calls this "the same 44px
 * slot". The footer is 30px and has been since phase 3. The bar takes the
 * footer's ACTUAL height, because "the same slot" is the requirement and 44
 * was a measurement of a drawing rather than of this list. Growing the footer
 * to 44 would restyle a surface nobody asked to change and shift the list
 * every time two rows are checked.
 */
export function BulkBar({
  rows,
  checked,
  lastVisible,
  onForceStatus,
  onAddNote,
  onClear,
}: {
  rows: FleetRow[];
  checked: ReadonlySet<string>;
  lastVisible: number;
  onForceStatus: () => void;
  onAddNote: () => void;
  onClear: () => void;
}) {
  const picked = rows.filter((r) => checked.has(r.id));
  // Same arithmetic as ListFooter's, on purpose: the number must not change
  // meaning when the bar takes the slot.
  const problems = rows.slice(lastVisible + 1).filter((r) => isProblem(r.status)).length;

  /**
   * The truck numbers, so the bar names what it is about to act on. §9.5's
   * rule for overrides is that the dispatcher sees what they are changing;
   * a count alone would make "2 trucks selected" the only confirmation of a
   * status write across two loads.
   */
  const labels = picked
    .map((r) => (r.truckNumber === null ? r.samsaraName : String(r.truckNumber)))
    .join(' · ');

  return (
    <div className="flex h-[30px] shrink-0 items-center justify-between gap-4 border-t border-line-hair bg-surface-bar px-4 text-small">
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 tabular-nums text-text">
          {picked.length} trucks selected
        </span>
        <span className="truncate tabular-nums text-text-muted">{labels}</span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onForceStatus}
          className="h-[20px] border border-line-hair bg-surface-raised px-2 font-cond text-micro uppercase tracking-[.09em] text-text hover:border-accent"
        >
          Force status…
        </button>
        <button
          type="button"
          onClick={onAddNote}
          className="h-[20px] border border-line-hair bg-surface-raised px-2 font-cond text-micro uppercase tracking-[.09em] text-text hover:border-accent"
        >
          Add note…
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex h-[20px] items-center gap-1.5 px-1 font-cond text-micro uppercase tracking-[.09em] text-text-muted hover:text-text"
        >
          Clear
          <kbd className="border border-line-hair px-1 font-mono text-[10px] leading-[1.5]">
            Esc
          </kbd>
        </button>

        {/* The fold count keeps its place at the right end (§14.5). */}
        {problems === 0 ? (
          <span className="tabular-nums text-status-ontime-fg">
            0 problems below the fold
          </span>
        ) : (
          <span className="tabular-nums text-status-late-fg">
            {problems} {problems === 1 ? 'problem' : 'problems'} below the fold
          </span>
        )}
      </span>
    </div>
  );
}
