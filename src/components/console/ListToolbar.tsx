'use client';

import { DENSITIES, type Density } from '@/lib/density';
import { FleetHealthStrip } from './FleetHealthStrip';
import type { FleetHealth } from '@/server/health';

/**
 * The strip above the column headers (§14.5).
 *
 * > Placed in the list toolbar, not the header, so it is read with the list
 * > rather than competing with the chip row.
 *
 * It carries the health strip on the left and the density control on the
 * right. The sort segment joins them here rather than in the header, for the
 * reason above.
 *
 * **Interpretation** for the control itself: 5b shows density in this bar but
 * drew no control, so it follows the segmented pattern the chips already use.
 */
export function ListToolbar({
  density,
  onDensity,
  health,
}: {
  density: Density;
  onDensity: (density: Density) => void;
  health: FleetHealth;
}) {
  return (
    <div /*
       * h-8 (32px), not h-7 (28px). The bar was sized around an 18px control;
       * a 26px one needs 3px of clearance either side to sit in it rather
       * than against it.
       */
      className="flex h-8 items-center justify-between gap-3 border-b border-line-soft bg-surface-base px-2">
      <FleetHealthStrip health={health} />

      <div className="flex shrink-0 items-center gap-2">
        <span className="font-cond text-micro uppercase tracking-[.11em] text-text-muted">
          Density
        </span>
        {/*
          `gap-1.5`, exactly as the chip row uses. The control was a bare
          `flex`, so the two buttons shared an edge and read as one cramped
          block rather than a segmented pair.
        */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Row density">
          {DENSITIES.map((option) => {
            const active = option === density;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => onDensity(option)}
                /*
                 * The segmented pattern the chips actually use, rather than a
                 * near-miss of it.
                 *
                 * This claimed in its own comment to follow the chip row and
                 * then diverged on every measurement that matters: `h-[18px]`
                 * against the chips' 26, no gap, `tracking-[.09em]` against
                 * .08, and no transition at all — so the active state changed
                 * instantly where every other control in the console grounds
                 * over 120ms (§8.3).
                 *
                 * 18px was not a token either. §14.4's `chip-compact: 18px` is
                 * the STATUS chip inside a row, which shrinks with density;
                 * borrowing that number for a toolbar control made the control
                 * the size of a row ornament.
                 *
                 * The active state is `bg-surface-overlay` like a selected
                 * chip, plus `border-accent` and full-strength ink — the
                 * accent edge is what distinguishes "this is a toggle you set"
                 * from "this is a filter you picked".
                 */
                className={`flex h-[26px] shrink-0 items-center border px-2 font-cond text-micro uppercase tracking-[.08em] transition-colors duration-ground ${
                  active
                    ? 'border-accent bg-surface-overlay text-text'
                    : 'border-line-soft text-text-muted hover:bg-row-hover'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
        {/*
        The binding is named where the control is, so the sheet is not the
        only place it exists. `D` is in KEYMAP too; that is the description,
        this is the reminder.
      */}
        <kbd className="border border-line-hair bg-surface-base px-1 font-mono text-[10px] leading-[1.6] text-text-muted">
          D
        </kbd>
      </div>
    </div>
  );
}
