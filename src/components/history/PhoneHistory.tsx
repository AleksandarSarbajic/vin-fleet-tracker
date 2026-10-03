'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { HeaderSync } from '@/components/console/HeaderStatus';
import { useReturnFocus } from '@/components/edit/useModalChrome';
import { BRAND } from '@/lib/brand';
import { ENTRY_STATUS_LABEL, type HistoryEntry, type HistoryRow, type HistoryWeekView } from '@/lib/history';
import { rangeLabel, weekTag, type IsoWeek } from '@/lib/history-week';
import { STATUS_INK, STATUS_RULE, StatusIcon } from './StatusMark';

/**
 * §12.102 — Driver history below 768px: the design's phone layout. One card
 * per driver with the days listed inside; consecutive empty days fold into
 * one line; every load is a 48px row, and tapping it opens the tooltip's
 * details in a bottom sheet. Every control is 44px and no text is under
 * 12px (the same checks as the board's phone view).
 *
 * Read-only, like the desktop page, and it adds no keyboard handling: the
 * sheet closes by its Close button or a tap on the scrim.
 */

const BUTTON = 'inline-flex h-11 items-center justify-center border border-line-rule bg-transparent text-text disabled:opacity-45';

/** "Sep 28 – Oct 4" — the phone's range, without the year the tag implies. */
const shortRange = (week: IsoWeek) => rangeLabel(week).replace(/, \d{4}/g, '');

type DayKind = 'loads' | 'ahead' | 'noTruck' | 'none';

interface DayLine {
  label: string;
  today: boolean;
  note: string | null;
  entries: HistoryEntry[];
}

/** The design's folding: a run of days with nothing on them is one line. */
function dayLines(row: HistoryRow, view: HistoryWeekView, todayIndex: number | null): DayLine[] {
  const kind = (i: number): DayKind => {
    if (row.cells[i]!.entries.length) return 'loads';
    if (todayIndex !== null && i > todayIndex) return 'ahead';
    return row.cells[i]!.noTruck ? 'noTruck' : 'none';
  };
  const name = (i: number) => `${view.days[i]!.dow} ${view.days[i]!.date}`;
  const lines: DayLine[] = [];
  for (let i = 0; i < 7; ) {
    const k = kind(i);
    if (k === 'loads') {
      lines.push({ label: name(i), today: i === todayIndex, note: null, entries: row.cells[i]!.entries });
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && kind(j + 1) === k) j += 1;
    lines.push({
      label: j > i ? `${name(i)} – ${name(j)}` : name(i),
      today: false,
      note: k === 'ahead' ? 'Upcoming' : k === 'noTruck' ? 'No truck' : 'No loads',
      entries: [],
    });
    i = j + 1;
  }
  return lines;
}

export function PhoneHistory({
  week,
  current,
  isCurrent,
  view,
  rows,
  todayIndex,
  state,
  q,
  onQ,
  onWeek,
  onRetry,
  oldWeekNotice,
  fleet,
  dispatchTz,
  now,
  firstDayIso,
  todayIso,
  atFirst,
}: {
  week: IsoWeek;
  current: IsoWeek;
  isCurrent: boolean;
  view: HistoryWeekView | undefined;
  rows: HistoryRow[];
  todayIndex: number | null;
  state: 'table' | 'empty' | 'noMatch' | 'before' | 'error' | 'loading';
  q: string;
  onQ: (q: string) => void;
  onWeek: (week: IsoWeek | 'previous' | 'next' | 'current' | string) => void;
  onRetry: () => void;
  oldWeekNotice: string | null;
  fleet: { fetchedAt: string | null; feedNewestAt: string | null; feedStale: boolean };
  dispatchTz: string;
  now: Date;
  firstDayIso: string;
  todayIso: string;
  atFirst: boolean;
}) {
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const [picking, setPicking] = useState(false);

  return (
    <div data-history-phone="" className="flex min-h-0 flex-1 flex-col md:hidden print:hidden">
      {/* Top bar, 44: the brand and the sync state. */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-hair bg-surface-raised px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <Image src={BRAND.monogram.src} width={BRAND.monogram.width} height={BRAND.monogram.height} alt={BRAND.alt} unoptimized className="h-[22px] w-[22px]" />
          <span className="truncate font-cond text-[12px] font-semibold uppercase leading-none tracking-[.14em] text-text">
            Fleet Tracker
          </span>
        </div>
        <HeaderSync now={now} fetchedAt={fleet.fetchedAt} feedNewestAt={fleet.feedNewestAt} feedStale={fleet.feedStale} dispatchTz={dispatchTz} />
      </div>

      {/* The way back and the page name, 48. */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line-soft bg-surface-base px-1">
        <Link
          href="/"
          className="inline-flex h-11 items-center gap-[5px] px-2.5 font-cond text-[13px] font-semibold uppercase leading-none tracking-[.08em] text-text"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Board
        </Link>
        <span aria-hidden="true" className="h-5 w-px bg-line-hair" />
        <h1 className="truncate pl-2 font-cond text-[15px] font-semibold uppercase leading-none tracking-[.12em] text-text">
          Driver history
        </h1>
        <span
          title="Read-only: nothing on this page changes data"
          className="ml-auto inline-flex shrink-0 items-center gap-[5px] pr-2.5 font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em] text-text-secondary"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span className="max-[359px]:sr-only">Read-only</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* The week: ‹ range ›, and the way back to this week. */}
        <div
          data-phone-week=""
          className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b border-line-soft bg-surface-base px-3 py-2"
        >
          <button type="button" aria-label="Previous week" disabled={atFirst} onClick={() => onWeek('previous')} className={`${BUTTON} w-11`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={`Choose a week — ${rangeLabel(week)}`}
            onClick={() => setPicking(true)}
            className="flex h-[52px] min-w-0 flex-col items-center justify-center gap-[5px] border border-line-rule bg-transparent text-text"
          >
            <span className="font-sans text-[15px] font-semibold leading-none tabular-nums">{shortRange(week)}</span>
            <span className={`font-cond text-[12px] font-semibold uppercase leading-none tracking-[.1em] ${isCurrent ? 'text-accent' : 'text-status-neutral-fg'}`}>
              {weekTag(week, current)}
            </span>
          </button>
          <button type="button" aria-label="Next week" disabled={isCurrent} onClick={() => onWeek('next')} className={`${BUTTON} w-11`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          {!isCurrent ? (
            <button
              type="button"
              onClick={() => onWeek('current')}
              className="col-span-3 h-11 border border-accent bg-transparent font-cond text-[13px] font-semibold uppercase leading-none tracking-[.08em] text-text"
            >
              Jump to this week
            </button>
          ) : null}
        </div>

        <div className="px-3 pt-2.5">
          <label className="flex items-center gap-2 border border-line-rule bg-surface-base px-3 focus-within:border-accent">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-text-muted">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
            <input
              value={q}
              onChange={(event) => onQ(event.target.value)}
              placeholder="Filter list…"
              aria-label="Filter drivers"
              className="h-11 min-w-0 flex-1 bg-transparent font-sans text-[15px] text-text outline-none placeholder:text-text-mutedOnOverlay"
            />
          </label>
        </div>

        {oldWeekNotice ? (
          <p role="note" className="mx-3 mt-2.5 font-sans text-[13px] leading-[1.45] text-status-risk-fg">
            {oldWeekNotice}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 p-3">
          {state === 'table' && view
            ? rows.map((row) => <DriverCard key={row.driverId ?? 'none'} row={row} view={view} todayIndex={todayIndex} onOpen={setOpen} />)
            : null}
          {state === 'empty' ? (
            <StateCard
              title="No loads recorded this week"
              body="Loads appear here when they are assigned or a stop is reached."
            />
          ) : null}
          {state === 'before' ? (
            <StateCard title="No records for this week" body="Load history starts Sep 14, 2026." />
          ) : null}
          {state === 'noMatch' ? (
            <StateCard title="No driver matches" body={`Nothing matches “${q.trim()}”.`}>
              <button type="button" onClick={() => onQ('')} className={`${BUTTON} mt-1.5 w-full font-cond text-[14px] font-semibold uppercase tracking-[.08em]`}>
                Clear filter
              </button>
            </StateCard>
          ) : null}
          {state === 'error' ? (
            <StateCard error title="Could not load this week" body="The board and live tracking are not affected.">
              <button
                type="button"
                onClick={onRetry}
                className="mt-1.5 h-11 w-full border border-accent bg-accent font-cond text-[14px] font-semibold uppercase leading-none tracking-[.08em] text-text-inverse"
              >
                Retry
              </button>
            </StateCard>
          ) : null}
          {state === 'loading'
            ? [150, 120, 170].map((w) => (
                <div key={w} aria-busy="true" className="flex animate-[pulse_1.2s_ease-in-out_infinite] flex-col gap-2.5 border border-line-hair bg-surface-base p-3.5">
                  <span className="block h-[13px] bg-surface-overlay" style={{ width: w }} />
                  <span className="block h-2.5 w-[70px] bg-surface-raised" />
                  <span className="block h-11 bg-surface-raised" />
                  <span className="block h-11 bg-surface-raised" />
                </div>
              ))
            : null}

          {view && (state === 'table' || state === 'empty' || state === 'noMatch') ? <PhoneLists view={view} /> : null}
        </div>
      </div>

      {open ? <LoadSheet entry={open} onClose={() => setOpen(null)} /> : null}
      {picking ? (
        <WeekSheet
          firstDayIso={firstDayIso}
          todayIso={todayIso}
          onPick={(iso) => {
            setPicking(false);
            onWeek(iso);
          }}
          onThisWeek={() => {
            setPicking(false);
            onWeek('current');
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

function DriverCard({
  row,
  view,
  todayIndex,
  onOpen,
}: {
  row: HistoryRow;
  view: HistoryWeekView;
  todayIndex: number | null;
  onOpen: (entry: HistoryEntry) => void;
}) {
  const multi = row.trucks.length > 1;
  const trucks = row.trucks.map((t) => (t.days ? `${t.label} (${t.days})` : t.label)).join(', ');
  return (
    <section data-phone-history-card={row.name} aria-label={row.name} className="shrink-0 border border-line-hair bg-surface-base">
      <div className="flex flex-col gap-[3px] px-3.5 pb-2.5 pt-3">
        <span className="font-sans text-[15px] font-semibold leading-[1.25] text-text">{row.name}</span>
        <span className="font-sans text-[12px] leading-[1.4] text-text-secondary">
          {multi ? 'Trucks' : 'Truck'} {trucks}
        </span>
      </div>
      {row.loadCount === 0 ? (
        <div className="border-t border-line-soft px-3.5 py-3 font-sans text-[13px] text-text-muted">No loads this week</div>
      ) : (
        dayLines(row, view, todayIndex).map((line) => (
          <div key={line.label} data-phone-day="" className="grid grid-cols-[68px_minmax(0,1fr)] border-t border-line-soft">
            <div
              className={`pl-3.5 pr-1.5 pt-[13px] font-cond text-[12px] font-semibold uppercase leading-[1.3] tracking-[.08em] ${
                line.today ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              {line.label}
              {line.today ? ' · today' : ''}
            </div>
            <div className="flex min-w-0 flex-col pr-3.5">
              {line.note ? (
                <div className="flex min-h-10 items-center font-sans text-[13px] text-text-muted">{line.note}</div>
              ) : null}
              {line.entries.map((entry, j) => (
                <button
                  key={entry.key}
                  type="button"
                  data-phone-load={entry.number ?? 'no number'}
                  aria-label={`${entry.number ? `Load ${entry.number}` : 'No load number'}, ${entry.route.full}, ${ENTRY_STATUS_LABEL[entry.status]}`}
                  onClick={() => onOpen(entry)}
                  className={`my-1 flex min-h-12 w-full flex-col justify-center gap-[3px] border-l-2 py-2 pl-2 text-left ${STATUS_RULE[entry.status]} ${
                    j > 0 ? 'border-t border-t-line-soft' : ''
                  }`}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className={`font-sans text-[14px] font-semibold leading-[1.25] tabular-nums ${entry.number ? 'text-text' : 'text-text-secondary'}`}>
                      {entry.number ?? '—'}
                    </span>
                    <span className={`inline-flex items-center gap-1 font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em] ${STATUS_INK[entry.status]}`}>
                      <StatusIcon status={entry.status} size={12} />
                      {ENTRY_STATUS_LABEL[entry.status]}
                    </span>
                  </span>
                  <RouteLine entry={entry} />
                  {entry.truck ? <span className="font-sans text-[12px] text-text-secondary">Truck {entry.truck}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function RouteLine({ entry }: { entry: HistoryEntry }) {
  const pre = entry.route.pre;
  const rest = pre ? entry.route.full.slice(pre.length) : entry.route.full;
  const quiet = entry.status === 'cancelled' || entry.status === 'tonu';
  return (
    <span className={`font-sans text-[13px] leading-[1.35] [overflow-wrap:anywhere] ${quiet ? 'text-text-secondary' : 'text-text'}`}>
      {pre ? <span className="font-cond text-[12px] font-semibold uppercase tracking-[.08em] text-text-secondary">{pre}</span> : null}
      {rest}
    </span>
  );
}

function StateCard({
  title,
  body,
  error = false,
  children,
}: {
  title: string;
  body: string;
  error?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div role={error ? 'alert' : undefined} className="flex flex-col items-center gap-2.5 border border-line-hair bg-surface-base px-4 py-11 text-center">
      {error ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-status-late-fg">
          <path d="M12 3 2 21h20Z" />
          <path d="M12 10v5M12 18h.01" />
        </svg>
      ) : (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="text-text-muted">
          <rect x="3" y="5" width="18" height="16" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      )}
      <div className="font-cond text-[20px] font-semibold uppercase leading-[1.1] tracking-[.04em] text-text">{title}</div>
      <div className="font-sans text-[13px] leading-[1.55] text-text-secondary">{body}</div>
      {children}
    </div>
  );
}

function PhoneLists({ view }: { view: HistoryWeekView }) {
  const lists = [
    {
      title: 'Not reached this week',
      rows: view.notReached.map((x) => ({
        key: x.loadId,
        first: x.number ?? '—',
        route: x.route.full,
        second: `${x.driver ?? 'Not assigned'} · ${x.created}`,
      })),
    },
    {
      title: 'No load number',
      rows: view.noNumber.map((x, k) => ({
        key: `${k}`,
        first: x.day,
        route: x.route.full,
        second: `${x.driver ?? 'No driver assigned'} · ${ENTRY_STATUS_LABEL[x.status]}`,
      })),
    },
  ];
  return (
    <div data-history-lists-phone="" className="flex flex-col gap-3">
      {lists.map((list) => (
        <section key={list.title} aria-label={list.title} className="border border-line-hair bg-surface-base">
          <div className="flex items-baseline gap-2 px-3.5 py-3">
            <h2 className="font-cond text-[13px] font-semibold uppercase leading-none tracking-[.1em] text-text">{list.title}</h2>
            <span className="font-sans text-[13px] font-semibold leading-none text-accent">{list.rows.length}</span>
          </div>
          {list.rows.length === 0 ? (
            <div className="border-t border-line-soft px-3.5 py-3 font-sans text-[13px] text-text-muted">None this week.</div>
          ) : (
            list.rows.map((x) => (
              <div key={x.key} className="flex min-h-12 flex-col justify-center gap-0.5 border-t border-line-soft px-3.5 py-1.5">
                <span className="font-sans text-[13px] font-semibold text-text">
                  {x.first} · <span className="font-normal">{x.route}</span>
                </span>
                <span className="font-sans text-[12px] text-text-secondary">{x.second}</span>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}

/** The tooltip's details, as a bottom sheet that fits the screen. */
function LoadSheet({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  useReturnFocus(true);
  useEffect(() => panel.current?.focus(), [entry.key]);
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" aria-label="Close the load details" tabIndex={-1} onClick={onClose} className="absolute inset-0 h-full w-full bg-scrim" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={entry.tip.title}
        data-load-sheet=""
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-12px)] flex-col gap-3 overflow-y-auto overscroll-contain border-t border-line-tag bg-surface-overlay px-4 pb-5 pt-2 outline-none"
      >
        <span aria-hidden="true" className="h-1 w-9 shrink-0 self-center bg-line-grip" />
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="font-sans text-[18px] font-semibold text-text">{entry.tip.title}</span>
          <span className={`inline-flex items-center gap-[5px] font-cond text-[13px] font-semibold uppercase leading-none tracking-[.08em] ${STATUS_INK[entry.status]}`}>
            <StatusIcon status={entry.status} size={13} />
            {ENTRY_STATUS_LABEL[entry.status]}
          </span>
        </div>
        <div className="font-sans text-[15px] font-medium leading-[1.4] text-text">{entry.tip.route}</div>
        {entry.tip.stops.map((stop, k) => (
          <div key={k} className="flex flex-col gap-[5px] border-t border-line-hair pt-2.5">
            <span className="font-cond text-[12px] font-semibold uppercase leading-none tracking-[.1em] text-text-secondary">
              {stop.kind} · {stop.place}
            </span>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-sans text-[14px] leading-[1.4]">
              <span className="text-text-secondary">Arrived</span>
              <span className="text-text">{stop.arrived}</span>
              <span className="text-text-secondary">Departed</span>
              <span className="text-text">{stop.departed}</span>
            </div>
          </div>
        ))}
        {entry.tip.missing ? <div className="font-sans text-[13px] leading-[1.4] text-text-secondary">{entry.tip.missing}</div> : null}
        <div className="border-t border-line-hair pt-2.5 font-sans text-[13px] text-text-secondary">{entry.tip.meta}</div>
        <button
          type="button"
          onClick={onClose}
          className="h-11 shrink-0 border border-line-tag bg-transparent font-cond text-[14px] font-semibold uppercase leading-none tracking-[.08em] text-text"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** The phone's week chooser: a typed date jumps to its week, or this week. */
function WeekSheet({
  firstDayIso,
  todayIso,
  onPick,
  onThisWeek,
  onClose,
}: {
  firstDayIso: string;
  todayIso: string;
  onPick: (iso: string) => void;
  onThisWeek: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" aria-label="Close the week chooser" tabIndex={-1} onClick={onClose} className="absolute inset-0 h-full w-full bg-scrim" />
      <div role="dialog" aria-modal="true" aria-label="Choose a week" className="absolute inset-x-0 bottom-0 flex flex-col gap-3 border-t border-line-tag bg-surface-overlay px-4 pb-5 pt-3">
        <span className="font-cond text-[15px] font-semibold uppercase tracking-[.1em] text-text">Choose a week</span>
        <label className="flex flex-col gap-1.5 font-sans text-[13px] text-text-secondary">
          Jump to a date
          <input
            type="date"
            min={firstDayIso}
            max={todayIso}
            aria-label="Jump to a date"
            onChange={(event) => {
              if (event.target.value) onPick(event.target.value);
            }}
            className="h-11 border border-line-rule bg-surface-base px-3 font-sans text-[15px] text-text [color-scheme:dark]"
          />
        </label>
        <button type="button" onClick={onThisWeek} className={`${BUTTON} font-cond text-[14px] font-semibold uppercase tracking-[.08em]`}>
          This week
        </button>
        <button type="button" onClick={onClose} className={`${BUTTON} font-cond text-[14px] font-semibold uppercase tracking-[.08em]`}>
          Close
        </button>
      </div>
    </div>
  );
}
