'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import {
  addDays,
  daysBetween,
  isoWeekOf,
  mondayOf,
  monthName,
  rangeLabel,
  sameDate,
  weekdayIndex,
  weeksFrom,
  weekTag,
  type CivilDate,
  type IsoWeek,
} from '@/lib/history-week';
import { PAD } from './HistoryTable';

/**
 * §12.101 — the toolbar: ‹ This week › and the range, which opens a month
 * calendar (any day selects its Monday–Sunday week; a typed date jumps to
 * its week), then the filter, Read-only and Print. Controls 32 high, gaps 4
 * inside the week group and 10 between groups (design spec "Toolbar 52").
 *
 * Below 1024 the week tag goes and Read-only and Print keep only their icons,
 * so the bar fits at 768 (header.spec, nine widths).
 */

const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center border border-line-rule bg-transparent text-text hover:bg-surface-overlay disabled:opacity-45 disabled:hover:bg-transparent';

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDate = (c: CivilDate) => `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;

export const HistoryToolbar = forwardRef<
  HTMLInputElement,
  {
    week: IsoWeek;
    current: IsoWeek;
    today: CivilDate;
    firstDay: CivilDate;
    onWeek: (week: IsoWeek) => void;
    q: string;
    onQ: (q: string) => void;
  }
>(function HistoryToolbar({ week, current, today, firstDay, onWeek, q, onQ }, filterRef) {
  const isCurrent = weeksFrom(current, week) === 0;
  const atFirst = weeksFrom(isoWeekOf(firstDay), week) <= 0;
  return (
    <div
      data-history-toolbar=""
      className={`flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-line-soft print:hidden ${PAD}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous week"
            disabled={atFirst}
            onClick={() => onWeek(isoWeekOf(addDays(mondayOf(week), -7)))}
            className={ICON_BUTTON}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-pressed={isCurrent}
            onClick={() => onWeek(current)}
            className={`inline-flex h-8 items-center whitespace-nowrap border px-[11px] font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em] text-text hover:bg-surface-overlay ${
              isCurrent ? 'border-accent bg-surface-overlay' : 'border-line-rule bg-transparent'
            }`}
          >
            This week
          </button>
          <button
            type="button"
            aria-label="Next week"
            disabled={isCurrent}
            onClick={() => onWeek(isoWeekOf(addDays(mondayOf(week), 7)))}
            className={ICON_BUTTON}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <WeekPicker week={week} today={today} firstDay={firstDay} onWeek={onWeek} />
        <span
          data-week-tag=""
          className={`inline-flex h-[22px] items-center whitespace-nowrap border px-2 font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[.1em] max-[1023px]:hidden ${
            isCurrent ? 'border-accent bg-history-currentTag text-accent' : 'border-status-neutral-bd text-status-neutral-fg'
          }`}
        >
          {weekTag(week, current)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <label className="flex h-8 w-[180px] items-center gap-2 border border-line-rule bg-surface-base px-2.5 focus-within:border-accent min-[1024px]:w-[220px] min-[1440px]:w-[240px] min-[1680px]:w-[260px] min-[1920px]:w-[280px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-text-muted">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>
          <input
            ref={filterRef}
            value={q}
            onChange={(event) => onQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && q) {
                event.stopPropagation();
                onQ('');
              }
            }}
            placeholder="Filter list…"
            aria-label="Filter drivers"
            className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-text outline-none placeholder:text-text-mutedOnOverlay"
          />
          <span className="border border-line-rule px-[5px] py-px font-mono text-[11px] font-medium text-text-muted">/</span>
        </label>
        <span
          title="Read-only: nothing on this page changes data"
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap border border-dashed border-line-tag px-2.5 font-cond text-[11.5px] font-semibold uppercase leading-none tracking-[.08em] text-text-secondary"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span className="max-[1023px]:sr-only">Read-only</span>
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Print"
          className="inline-flex h-8 items-center gap-[7px] border border-line-rule bg-transparent px-3 font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em] text-text hover:bg-surface-overlay max-[1023px]:px-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9V3h12v6" />
            <rect x="6" y="14" width="12" height="7" />
            <path d="M6 18H4V11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2" />
          </svg>
          <span className="max-[1023px]:hidden">Print</span>
        </button>
      </div>
    </div>
  );
});

/**
 * The range button and its month calendar. Days before the first record and
 * after today are disabled; the week on show is marked. A typed date below
 * the grid jumps to its week.
 */
function WeekPicker({
  week,
  today,
  firstDay,
  onWeek,
}: {
  week: IsoWeek;
  today: CivilDate;
  firstDay: CivilDate;
  onWeek: (week: IsoWeek) => void;
}) {
  const [open, setOpen] = useState(false);
  const monday = mondayOf(week);
  const [month, setMonth] = useState({ y: monday.y, m: monday.m });
  const box = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const choose = (day: CivilDate) => {
    onWeek(isoWeekOf(day));
    setOpen(false);
  };
  const allowed = (day: CivilDate) => daysBetween(firstDay, day) >= 0 && daysBetween(day, today) >= 0;

  const first = { y: month.y, m: month.m, d: 1 };
  const gridStart = addDays(first, -weekdayIndex(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const shift = (n: number) => {
    const d = new Date(Date.UTC(month.y, month.m - 1 + n, 1));
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Week of ${rangeLabel(week)} — choose a week`}
        onClick={() => {
          setMonth({ y: monday.y, m: monday.m });
          setOpen((o) => !o);
        }}
        className="inline-flex h-8 items-center gap-2 whitespace-nowrap border border-line-rule bg-surface-base px-2.5 font-sans text-[14px] font-semibold tabular-nums text-text hover:border-accent"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="text-text-secondary">
          <rect x="3" y="5" width="18" height="16" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span data-week-range="">{rangeLabel(week)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="text-text-secondary">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a week"
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-[288px] border border-line-tag bg-surface-overlay p-3 shadow-modal"
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className={ICON_BUTTON}>
              ‹
            </button>
            <span className="font-cond text-[13px] font-semibold uppercase tracking-[.1em] text-text">
              {monthName(month.m)} {month.y}
            </span>
            <button type="button" aria-label="Next month" onClick={() => shift(1)} className={ICON_BUTTON}>
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px font-sans text-[12px] tabular-nums">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className="flex h-7 items-center justify-center font-cond text-[10.5px] font-semibold uppercase text-text-mutedOnOverlay">
                {d}
              </span>
            ))}
            {cells.map((day) => {
              const inWeek = daysBetween(monday, day) >= 0 && daysBetween(monday, day) <= 6;
              const ok = allowed(day);
              return (
                <button
                  key={isoDate(day)}
                  type="button"
                  disabled={!ok}
                  aria-label={isoDate(day)}
                  aria-current={sameDate(day, today) ? 'date' : undefined}
                  onClick={() => choose(day)}
                  className={`h-8 ${day.m === month.m ? 'text-text' : 'text-text-mutedOnOverlay'} ${
                    inWeek ? 'bg-accent-veil' : ''
                  } ${sameDate(day, today) ? 'outline outline-1 outline-accent' : ''} hover:bg-surface-raised disabled:text-line-grip disabled:hover:bg-transparent`}
                >
                  {day.d}
                </button>
              );
            })}
          </div>
          <label className="mt-3 flex items-center justify-between gap-2 border-t border-line-hair pt-3 font-sans text-[12px] text-text-secondary">
            Jump to a date
            <input
              type="date"
              min={isoDate(firstDay)}
              max={isoDate(today)}
              aria-label="Jump to a date"
              onChange={(event) => {
                const [y, m, d] = event.target.value.split('-').map(Number);
                if (!y || !m || !d) return;
                const day = { y, m, d };
                if (allowed(day)) choose(day);
              }}
              className="h-8 border border-line-rule bg-surface-base px-2 font-sans text-[12px] text-text [color-scheme:dark]"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
