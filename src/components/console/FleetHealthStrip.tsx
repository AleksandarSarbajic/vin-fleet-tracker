'use client';

import type { FleetHealth } from '@/server/health';
import { healthBar, healthText, type Segment } from '@/lib/health-bar';

/**
 * §14 feature 8 — the day's outcome, in the list toolbar.
 *
 * Placement and relationship are **approved** (§14.3, §14.5): secondary to
 * the chips, printing nothing a chip prints, and read with the list rather
 * than competing with the chip row. The bar's three treatments and their
 * measured ratios are §14.4's. The layout inside those constraints is
 * interpretation — turn 5 drew the token table, not the strip.
 *
 * Quiet on purpose. It is the only surface on the board that is not about
 * what to do next, and a dispatcher should be able to ignore it for an entire
 * shift without missing anything.
 */

/**
 * Static classes, not built at runtime: Tailwind cannot see an assembled
 * name. `health-late` is the hatch, in `globals.css` because Tailwind has no
 * utility for a repeating gradient — it reads the same token.
 */
const FILL: Record<Segment, string> = {
  onTime: 'bg-status-ontime-fg',
  late: 'health-late',
  unscheduled: 'bg-status-neutral-fg',
  // Hollow: an edge and no fill. 3.51 on `surface.raised`, above the 3:1
  // floor for a graphical object and deliberately below it for text.
  remaining: 'border border-status-neutral-bd',
};

export function FleetHealthStrip({ health }: { health: FleetHealth }) {
  const bar = healthBar(health);

  return (
    <div className="flex min-w-0 items-center gap-2" title={bar.label}>
      <span className="shrink-0 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
        Today
      </span>

      {/*
        The bar carries no information the line beside it does not, so it is
        hidden rather than labelled twice — `bar.label` is on the container
        for the tooltip, and the text below is what a screen reader reads.
      */}
      {bar.total > 0 ? (
        <span
          aria-hidden="true"
          className="flex h-[6px] w-[88px] shrink-0 overflow-hidden bg-surface-raised"
        >
          {bar.segments.map((segment) => (
            <span
              key={segment.key}
              className={FILL[segment.key]}
              style={{
                flexGrow: segment.count,
                flexBasis: 0,
                // Proportional widths round a single late stop out of sixty
                // down to nothing. A segment that exists is at least visible.
                minWidth: segment.count > 0 ? 2 : 0,
              }}
            />
          ))}
        </span>
      ) : null}

      <span className="truncate font-sans text-small tabular-nums text-text-secondary">
        {healthText(bar, health)}
      </span>
    </div>
  );
}
