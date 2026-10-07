'use client';

import { useRef, useSyncExternalStore } from 'react';
import { isIanaZone } from '@/lib/appointment';
import { timeInZone, zoneAbbreviation } from '@/lib/format';
import type { StopForm, StopFlags } from './load-form';

/**
 * §12.119. The load's stops, beside the form at 1008px and up — the 960px
 * panel plus the scrim's 24px each side — and as a row of tabs above it
 * below that. One tablist either way, so the keys and what a screen reader
 * says do not depend on the width: arrows move between stops, and the
 * selected stop's form is the tab panel.
 */

export const STOP_FORM_ID = 'edit-load-stop-form';

/** The panel's full 960px, plus the scrim's 24px each side. */
export const TWO_PANE_MEDIA = '(min-width: 1008px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(TWO_PANE_MEDIA);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const twoPaneNow = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(TWO_PANE_MEDIA).matches;

/** Whether the list stands beside the form (vertical) or above it (tabs). */
function useTwoPane(): boolean {
  return useSyncExternalStore(subscribe, twoPaneNow, () => true);
}
export const stopTabId = (key: string) => `edit-load-stop-tab-${key}`;

/** "10-09 14:00 CDT" — the stop's own clock, its abbreviation for that day. */
function whenLine(stop: StopForm): string {
  const departedAt = stop.stored?.departedAt;
  const zone = stop.appointment.tz;
  if (departedAt && isIanaZone(zone)) {
    const by = stop.stored?.departedSource === 'dispatcher' ? ' · marked by hand' : '';
    return `Departed ${timeInZone(new Date(departedAt), zone)}${by}`;
  }
  const a = stop.appointment;
  if (!a.enabled) return 'No appointment';
  if (a.type === 'FCFS') return `FCFS ${a.time || '—'}–${a.endTime || '—'}`;
  const [y, m, d] = a.date.split('-').map(Number);
  const [h, min] = a.time.split(':').map(Number);
  const abbrev =
    isIanaZone(zone) &&
    [y, m, d, h, min].every((n) => n !== undefined && !Number.isNaN(n))
      ? ` ${zoneAbbreviation(new Date(Date.UTC(y!, m! - 1, d!, h!, min!)), zone)}`
      : '';
  return `${a.date ? a.date.slice(5) : '—'} ${a.time || '—'}${abbrev}`;
}

export function StopList({
  stops,
  flags,
  selected,
  dirtyKeys,
  errorKeys,
  onSelect,
}: {
  stops: StopForm[];
  flags: StopFlags[];
  selected: number;
  dirtyKeys: ReadonlySet<string>;
  errorKeys: ReadonlySet<string>;
  onSelect: (index: number) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const twoPane = useTwoPane();

  const move = (to: number) => {
    const index = (to + stops.length) % stops.length;
    onSelect(index);
    tabs.current[index]?.focus();
  };

  return (
    <div
      data-stop-list=""
      // The pane runs the form's full height, so its ground does too; the
      // list inside it stays in view as the form scrolls.
      className="border-b border-line-hair bg-surface-raised min-[1008px]:border-b-0 min-[1008px]:border-r"
    >
      <div className="flex gap-1.5 overflow-x-auto p-2.5 min-[1008px]:sticky min-[1008px]:top-0 min-[1008px]:flex-col min-[1008px]:overflow-x-visible">
        <div className="hidden items-baseline justify-between px-0.5 pb-0.5 min-[1008px]:flex">
          <span className="font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
            Stops
          </span>
          <span className="text-small text-text-mutedOnOverlay">{stops.length}</span>
        </div>
        <div
          role="tablist"
          aria-label="Stops on this load"
          aria-orientation={twoPane ? 'vertical' : 'horizontal'}
          className="flex gap-1.5 min-[1008px]:flex-col"
          onKeyDown={(event) => {
            const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
            const ahead = event.key === 'ArrowDown' || event.key === 'ArrowRight';
            if (!back && !ahead) return;
            event.preventDefault();
            move(selected + (ahead ? 1 : -1));
          }}
        >
          {stops.map((stop, i) => {
            const f = flags[i]!;
            const isSelected = i === selected;
            const hasError = errorKeys.has(stop.key);
            const chip = hasError
              ? { text: 'Error', tone: 'border-status-late-fg text-status-late-fg' }
              : f.arrived && !f.departed
                ? {
                    text: 'Arrived',
                    tone: 'border-status-ontime-fg text-status-ontime-fg',
                  }
                : f.next
                  ? { text: 'Next', tone: 'border-accent text-accent' }
                  : null;
            const place = [stop.city.trim(), stop.state.trim().toUpperCase()]
              .filter(Boolean)
              .join(', ');
            return (
              <button
                key={stop.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={stopTabId(stop.key)}
                aria-selected={isSelected}
                aria-controls={STOP_FORM_ID}
                tabIndex={isSelected ? 0 : -1}
                data-stop-row={i + 1}
                data-departed={f.departed ? '' : undefined}
                onClick={() => onSelect(i)}
                className={`flex min-w-[200px] shrink-0 items-center gap-2 border p-2 text-left min-[1008px]:min-w-0 ${
                  isSelected
                    ? 'border-accent bg-accent-veil'
                    : 'border-line-soft hover:border-line-hair'
                }`}
              >
                <span className="w-3 text-center font-cond text-[13px] font-semibold text-text-mutedOnOverlay">
                  {i + 1}
                </span>
                <span
                  className={`inline-flex h-[19px] min-w-[30px] shrink-0 items-center justify-center border px-[5px] font-cond text-[10.5px] font-bold leading-none tracking-[.08em] ${
                    stop.stopType === 'PU'
                      ? 'border-accent text-accent'
                      : 'border-text text-text'
                  }`}
                >
                  {stop.stopType}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13px] font-semibold leading-[1.2] ${
                      f.departed ? 'text-text-secondary' : 'text-text'
                    }`}
                  >
                    {place || 'New stop'}
                  </span>
                  <span className="block truncate text-[11px] leading-[1.3] tabular-nums text-text-mutedOnOverlay">
                    {whenLine(stop)}
                  </span>
                </span>
                {dirtyKeys.has(stop.key) ? (
                  <span
                    aria-label="Unsaved changes"
                    title="Unsaved changes"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-risk-fg"
                  />
                ) : null}
                {chip ? (
                  <span
                    className={`shrink-0 border px-[5px] py-[3px] font-cond text-[10px] font-bold uppercase leading-none tracking-[.09em] ${chip.tone}`}
                  >
                    {chip.text}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
