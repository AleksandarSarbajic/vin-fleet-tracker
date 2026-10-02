'use client';

import { useEffect, useRef } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import type { FleetHealth } from '@/server/health';
import { DENSITIES, type Density } from '@/lib/density';
import { useReturnFocus } from '@/components/edit/useModalChrome';
import { CHIP_INK, chipCounts, chipLabel } from '../FilterChips';
import type { FilterKey } from '../FilterChips';
import { FleetHealthStrip } from '../FleetHealthStrip';
import { MORE_KEYS } from './PhoneTiles';

/**
 * §12.96, stage 1 — "More": every filter the tiles do not carry, the Today
 * summary and the density toggle, which all leave the phone's first screen.
 * A sheet from the bottom over the board; a tap on the board above it, or
 * Done, closes it. It handles no keys (§12.96).
 */
export function PhoneMoreSheet({
  rows,
  chips,
  onToggle,
  health,
  density,
  onDensity,
  onClose,
}: {
  rows: FleetRow[];
  chips: Set<FilterKey>;
  onToggle: (key: FilterKey) => void;
  health: FleetHealth;
  density: Density;
  onDensity: (density: Density) => void;
  onClose: () => void;
}) {
  const counts = chipCounts(rows);
  const panel = useRef<HTMLDivElement>(null);
  useReturnFocus(true);
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close filters"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="More filters"
        data-phone-more-sheet=""
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t border-line-control bg-surface-raised pb-3 outline-none"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <h2 className="font-cond text-[15px] font-semibold uppercase tracking-[.08em] text-text">
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-11 min-w-11 border border-line-control px-4 font-cond text-[13px] font-semibold uppercase tracking-[.08em] text-text"
          >
            Done
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 px-4">
          {MORE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={chips.has(key)}
              onClick={() => onToggle(key)}
              className={`flex h-11 items-center justify-between gap-2 border px-3 font-cond text-[13px] font-semibold uppercase tracking-[.08em] ${CHIP_INK[key]} ${
                chips.has(key) ? '!border-accent bg-surface-overlay' : ''
              }`}
            >
              <span className="truncate">{chipLabel(key)}</span>
              <span className="font-sans text-[14px] tabular-nums">{counts[key]}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-line-soft px-4 pt-3">
          <FleetHealthStrip health={health} />
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-line-soft px-4 pt-3">
          <span className="font-cond text-[12px] uppercase tracking-[.11em] text-text-muted">
            Density
          </span>
          <div className="flex gap-2" role="group" aria-label="Row density">
            {DENSITIES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === density}
                onClick={() => onDensity(option)}
                className={`h-11 border px-4 font-cond text-[13px] uppercase tracking-[.08em] ${
                  option === density
                    ? 'border-accent bg-surface-overlay text-text'
                    : 'border-line-soft text-text-muted'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
