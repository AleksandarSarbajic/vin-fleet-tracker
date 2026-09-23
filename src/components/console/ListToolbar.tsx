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
    <div className="flex h-7 items-center justify-between gap-3 border-b border-line-soft bg-surface-base px-2">
      <FleetHealthStrip health={health} />

      <div className="flex shrink-0 items-center gap-2">
        <span className="font-cond text-micro uppercase tracking-[.11em] text-text-muted">
          Density
        </span>
        <div className="flex" role="group" aria-label="Row density">
          {DENSITIES.map((option) => {
            const active = option === density;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => onDensity(option)}
                className={`h-[18px] border px-2 font-cond text-micro uppercase tracking-[.09em] ${
                  active
                    ? 'border-accent bg-row-selected text-text'
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
