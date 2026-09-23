'use client';

import { DENSITIES, type Density } from '@/lib/density';

/**
 * The strip above the column headers (§14.5).
 *
 * > Placed in the list toolbar, not the header, so it is read with the list
 * > rather than competing with the chip row.
 *
 * Today it carries the density control alone. The health strip (§14 feature
 * 8) and the sort segment join it here rather than in the header, for the
 * reason above — the bar exists now so those arrive into a place rather than
 * pushing the layout around when they land.
 *
 * **Interpretation** for the control itself: 5b shows density in this bar but
 * drew no control, so it follows the segmented pattern the chips already use.
 */
export function ListToolbar({
  density,
  onDensity,
}: {
  density: Density;
  onDensity: (density: Density) => void;
}) {
  return (
    <div className="flex h-7 items-center justify-end gap-2 border-b border-line-soft bg-surface-base px-2">
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
  );
}
