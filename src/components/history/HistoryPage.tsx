'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AccountMenu, type AccountUser } from '@/components/console/AccountMenu';
import { HeaderClocks, HeaderSync, useHeaderNow } from '@/components/console/HeaderStatus';
import { useFleet, type FleetResponse } from '@/hooks/useFleet';
import { useGoKeys } from '@/hooks/useGoKeys';
import { BRAND } from '@/lib/brand';
import { timeInZone } from '@/lib/format';
import { ENTRY_STATUS_LABEL, type HistoryWeekView } from '@/lib/history';
import {
  civilDateIn,
  daysBetween,
  formatIsoWeek,
  isoWeekOf,
  mondayOf,
  rangeLabel,
  shiftWeek,
  weekdayIndex,
  weeksFrom,
  weekTag,
  type CivilDate,
  type IsoWeek,
} from '@/lib/history-week';
import { httpErrorFrom } from '@/lib/http-error';
import { isTypingTarget } from '@/lib/keymap';
import { markHistorySeen } from '@/lib/whats-new';
import { HistoryLists } from './HistoryLists';
import { BeforeRecords, EmptyWeek, LoadingRows, WeekError } from './HistoryStates';
import { HeadRow, HistoryTable, PAD } from './HistoryTable';
import { HistoryToolbar } from './HistoryToolbar';
import { PhoneHistory } from './PhoneHistory';
import { LEGEND, StatusIcon, STATUS_INK } from './StatusMark';

/**
 * §12.101 — Driver history: a weekly record of loads, by driver (design 1a).
 * Read-only for every role; nothing on the page changes data.
 */

/** The first week with any record: Fleet Tracker started keeping them Sep 14, 2026. */
export const FIRST_DAY: CivilDate = { y: 2026, m: 9, d: 14 };
/**
 * §12.97 shipped on this date. Before it a reached stop was often typed over
 * with the next trip, so weeks that start before it carry a notice.
 */
export const RELIABLE_FROM: CivilDate = { y: 2026, m: 10, d: 2 };
const RELIABLE_FROM_LABEL = 'Oct 2, 2026';
const OLD_WEEK_NOTICE = `Before ${RELIABLE_FROM_LABEL}, a load row was sometimes reused for the next trip, so this week may be missing trips.`;
const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (c: CivilDate) => `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;

async function fetchWeek(week: string): Promise<HistoryWeekView> {
  const response = await fetch(`/api/history?week=${week}`, { cache: 'no-store' });
  if (!response.ok) throw await httpErrorFrom(response);
  return (await response.json()) as HistoryWeekView;
}

export function HistoryPage({
  initialWeek,
  initialView,
  initialQ,
  initialFleet,
  dispatchTz,
  user,
}: {
  initialWeek: IsoWeek;
  initialView: HistoryWeekView;
  initialQ: string;
  initialFleet: FleetResponse;
  dispatchTz: string;
  user: AccountUser;
}) {
  const router = useRouter();
  const fleet = useFleet(initialFleet);
  const now = useHeaderNow(initialFleet.fetchedAt);
  const [week, setWeek] = useState(initialWeek);
  const [q, setQ] = useState(initialQ);
  const filter = useRef<HTMLInputElement | null>(null);

  // G B — back to the board (does nothing below 768px, useGoKeys).
  useGoKeys({ b: () => router.push('/') });
  // The account menu's "New" tag drops after the first visit.
  useEffect(() => markHistorySeen(), []);
  // "/" — the filter, as on the board.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // No keyboard handling on a phone (§12.96): the listener stays, inert.
      if (window.matchMedia('(max-width: 767px)').matches) return;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      filter.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The address carries the week and the filter, so a week can be bookmarked or sent.
  const weekKey = formatIsoWeek(week);
  useEffect(() => {
    const params = new URLSearchParams({ week: weekKey });
    if (q.trim()) params.set('q', q.trim());
    window.history.replaceState(null, '', `/history?${params.toString()}`);
  }, [weekKey, q]);

  const today = civilDateIn(now, dispatchTz);
  const current = isoWeekOf(today);
  const isCurrent = weeksFrom(current, week) === 0;
  const beforeRecords = weeksFrom(isoWeekOf(FIRST_DAY), week) < 0;
  const oldWeek = !beforeRecords && daysBetween(mondayOf(week), RELIABLE_FROM) > 0;
  const todayIndex = isCurrent ? weekdayIndex(today) : null;

  const query = useQuery({
    queryKey: ['history', weekKey],
    queryFn: () => fetchWeek(weekKey),
    enabled: !beforeRecords,
    ...(weekKey === formatIsoWeek(initialWeek) ? { initialData: initialView } : {}),
    staleTime: 60_000,
  });
  const view = query.data;

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () => (view ? view.rows.filter((r) => !needle || r.name.toLowerCase().includes(needle)) : []),
    [view, needle],
  );
  const driverCount = view?.rows.filter((r) => r.driverId !== null).length ?? 0;

  // §12.102. The phone layout shows the same states as the table frame.
  const phoneState = beforeRecords
    ? ('before' as const)
    : view
      ? view.counts.loads > 0 && rows.length > 0
        ? ('table' as const)
        : needle && rows.length === 0 && view.counts.loads > 0
          ? ('noMatch' as const)
          : ('empty' as const)
      : query.isError
        ? ('error' as const)
        : ('loading' as const);
  const phoneWeek = (to: IsoWeek | 'previous' | 'next' | 'current' | string) => {
    if (to === 'previous') return setWeek(shiftWeek(week, -1));
    if (to === 'next') return setWeek(shiftWeek(week, 1));
    if (to === 'current') return setWeek(current);
    if (typeof to === 'string') {
      const [y, m, d] = to.split('-').map(Number);
      if (!y || !m || !d) return;
      const day = { y, m, d };
      if (daysBetween(FIRST_DAY, day) >= 0 && daysBetween(day, today) >= 0) setWeek(isoWeekOf(day));
      return;
    }
    setWeek(to);
  };

  const summary = !view
    ? query.isError
      ? ''
      : `Loading ${rangeLabel(week)}…`
    : needle
      ? `${rows.length} of ${view.rows.length} drivers match “${q.trim()}”`
      : `${view.counts.drivers} drivers · ${view.counts.loads} loads in the table · ${view.counts.notReached} not reached`;

  const printedAt = `${new Intl.DateTimeFormat('en-US', {
    timeZone: dispatchTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now)} ${timeInZone(now, dispatchTz)}`;

  const errorDetail = (() => {
    const error = query.error as (Error & { status?: number }) | null;
    return `${error?.status ? `Server error ${error.status}` : 'The request failed'} · ${new Intl.DateTimeFormat('en-GB', {
      timeZone: dispatchTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(query.errorUpdatedAt || Date.now()))} ${timeInZone(now, dispatchTz).split(' ')[1] ?? ''}`;
  })();

  return (
    <div className="flex h-dvh flex-col bg-surface-base text-text print:block print:h-auto print:bg-print-paper print:text-print-ink">
      {/* §12.102. Below 768: the design's phone layout. */}
      <PhoneHistory
        week={week}
        current={current}
        isCurrent={isCurrent}
        view={view}
        rows={rows}
        todayIndex={todayIndex}
        state={phoneState}
        q={q}
        onQ={setQ}
        onWeek={phoneWeek}
        onRetry={() => void query.refetch()}
        oldWeekNotice={oldWeek ? OLD_WEEK_NOTICE : null}
        fleet={{
          fetchedAt: fleet.data?.fetchedAt ?? null,
          feedNewestAt: fleet.data?.feedNewestAt ?? null,
          feedStale: fleet.data?.feedStale ?? false,
        }}
        dispatchTz={dispatchTz}
        now={now}
        firstDayIso={isoOf(FIRST_DAY)}
        todayIso={isoOf(today)}
        atFirst={weeksFrom(isoWeekOf(FIRST_DAY), week) <= 0}
      />

      <header data-history-header="" className="shrink-0 max-md:hidden print:hidden">
        <div
          data-header-row="1"
          className="relative flex h-12 items-center gap-3 border-b border-line-soft bg-surface-raised px-4"
        >
          <div className="flex shrink-0 items-center gap-[10px]">
            <Image
              src={BRAND.monogram.src}
              width={BRAND.monogram.width}
              height={BRAND.monogram.height}
              alt={BRAND.alt}
              unoptimized
              priority
              className="h-[26px] w-[26px]"
            />
            <span className="hidden whitespace-nowrap font-cond text-[14px] font-semibold uppercase leading-none tracking-[.14em] text-text min-[1440px]:inline">
              Fleet Tracker
            </span>
          </div>
          <div aria-hidden="true" className="h-6 w-px shrink-0 bg-line-hair" />
          {/* The chip slot: board-only controls are replaced by the way back and the page name. */}
          <Link
            href="/"
            data-board-link=""
            className="inline-flex h-[30px] shrink-0 items-center gap-[7px] border border-line-rule px-2 font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em] text-text hover:bg-surface-overlay"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            Board
            <span className="border border-line-rule px-1 py-px font-mono text-[10.5px] tracking-normal text-text-muted">
              G B
            </span>
          </Link>
          <h1 className="whitespace-nowrap font-cond text-[15px] font-semibold uppercase leading-none tracking-[.14em] text-text">
            Driver history
          </h1>
          <div data-spare="1" className="min-w-0 flex-1 self-stretch" />
          <HeaderSync
            now={now}
            fetchedAt={fleet.data?.fetchedAt ?? null}
            feedNewestAt={fleet.data?.feedNewestAt ?? null}
            feedStale={fleet.data?.feedStale ?? false}
            dispatchTz={dispatchTz}
          />
          <HeaderClocks now={now} dispatchTz={dispatchTz} />
          <AccountMenu user={user} />
        </div>
      </header>

      <div className="contents max-md:hidden">
        <HistoryToolbar
          ref={filter}
          week={week}
          current={current}
          today={today}
          firstDay={FIRST_DAY}
          onWeek={setWeek}
          q={q}
          onQ={setQ}
        />


        <main className="min-h-0 flex-1 overflow-auto print:overflow-visible">
          {/* The printed title block: the console chrome is not printed. */}
          <div className="hidden items-end justify-between gap-5 border-b-[1.5px] border-print-ink pb-3 print:flex">
            <div className="flex flex-col gap-1.5">
              <span className="font-cond text-[11px] font-semibold uppercase leading-none tracking-[.14em] text-print-inkSecondary">
                Vin Logistics Inc · Fleet Tracker
              </span>
              <span className="font-cond text-[24px] font-semibold uppercase leading-none tracking-[.04em]">
                Driver history · {rangeLabel(week)}
                {needle ? ` · filtered: ${q.trim()}` : ''}
              </span>
            </div>
            <div className="text-right font-sans text-[11px] leading-[1.5] text-print-inkSecondary">
              {weekTag(week, current)}, printed {printedAt} by {user.fullName}
              <br />
              Read-only record
            </div>
          </div>

          {oldWeek ? (
            <div
              role="note"
              data-old-week-notice=""
              className={`flex min-h-9 shrink-0 items-center gap-2 border-b border-line-soft py-2 font-sans text-[12.5px] leading-[1.4] text-status-risk-fg print:border-print-ruleSoft print:text-print-ink ${PAD}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                <path d="M12 3 2 21h20Z" />
                <path d="M12 10v5M12 18h.01" />
              </svg>
              {/* Written out, not OLD_WEEK_NOTICE: one text run kerns "2026," differently
                  from three, and the desktop baselines hold these pixels. */}
              Before {RELIABLE_FROM_LABEL}, a load row was sometimes reused for the next trip, so this week may be
              missing trips.
            </div>
          ) : null}
          <div
            className={`flex h-[34px] items-center justify-between gap-4 font-sans text-[12px] text-text-secondary print:px-0 print:text-[11px] print:text-print-inkSecondary ${PAD}`}
          >
            <span data-history-summary="" className="truncate">{summary}</span>
            <div className="flex shrink-0 gap-3.5">
              {LEGEND.map((status) => (
                <span
                  key={status}
                  className={`inline-flex items-center gap-[5px] font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[.08em] ${STATUS_INK[status]}`}
                >
                  <StatusIcon status={status} />
                  {ENTRY_STATUS_LABEL[status]}
                </span>
              ))}
            </div>
          </div>

          <div className={PAD}>
            {beforeRecords ? (
              <Frame view={null} week={week} todayIndex={todayIndex}>
                <BeforeRecords
                  firstWeekLabel={rangeLabel(isoWeekOf(FIRST_DAY)).replace(/, \d{4}$/, '')}
                  onFirstWeek={() => setWeek(isoWeekOf(FIRST_DAY))}
                  onThisWeek={() => setWeek(current)}
                />
              </Frame>
            ) : view && rows.length > 0 && view.counts.loads > 0 ? (
              <HistoryTable view={view} rows={rows} todayIndex={todayIndex} />
            ) : view && needle && rows.length === 0 ? (
              <Frame view={view} week={week} todayIndex={todayIndex}>
                <div className="flex items-center gap-3 px-3 py-[18px] font-sans text-[12.5px] text-text-secondary">
                  No driver matches “{q.trim()}”.
                  <button
                    type="button"
                    onClick={() => setQ('')}
                    className="h-7 border border-line-rule px-2.5 font-cond text-[11.5px] font-semibold uppercase leading-none tracking-[.08em] text-text"
                  >
                    Clear filter
                  </button>
                </div>
              </Frame>
            ) : view ? (
              <Frame view={view} week={week} todayIndex={todayIndex}>
                <EmptyWeek
                  range={view.range}
                  drivers={driverCount}
                  onPrevious={() => setWeek(shiftWeek(week, -1))}
                />
              </Frame>
            ) : query.isError ? (
              <Frame view={null} week={week} todayIndex={todayIndex}>
                <WeekError
                  range={rangeLabel(week)}
                  detail={errorDetail}
                  onRetry={() => void query.refetch()}
                  onPrevious={() => setWeek(shiftWeek(week, -1))}
                />
              </Frame>
            ) : (
              <Frame view={null} week={week} todayIndex={todayIndex}>
                <LoadingRows />
              </Frame>
            )}
          </div>

          {view && !beforeRecords ? (
            <HistoryLists view={view} />
          ) : beforeRecords ? (
            <HistoryLists view={EMPTY_LISTS(week)} />
          ) : (
            <div className="h-6" />
          )}

          <div className="hidden border-t border-print-ruleSoft pt-2.5 font-sans text-[10.5px] text-print-inkSecondary print:block">
            Times are {dispatchTz}. A load sits on the day of its first recorded stop. This record cannot be edited.
          </div>
        </main>
      </div>
    </div>
  );
}

/** The table frame with its head, for the states that have no rows. */
function Frame({
  view,
  week,
  todayIndex,
  children,
}: {
  view: HistoryWeekView | null;
  week: IsoWeek;
  todayIndex: number | null;
  children: React.ReactNode;
}) {
  return (
    <div role="table" aria-label={`Driver history, ${rangeLabel(week)}`} className="border border-line-hair">
      <HeadRow view={view ?? headOnly(week)} todayIndex={todayIndex} />
      {children}
    </div>
  );
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A head for a week whose records have not arrived: the dates, nothing else. */
function headOnly(week: IsoWeek): HistoryWeekView {
  const monday = mondayOf(week);
  const days = DOW.map((dow, i) => {
    const t = new Date(Date.UTC(monday.y, monday.m - 1, monday.d + i));
    const c = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    return { dow, date: c.d, month: '', iso: `${c.y}-${c.m}-${c.d}`, full: `${dow} ${c.d}` };
  });
  return { ...EMPTY_LISTS(week), days };
}

function EMPTY_LISTS(week: IsoWeek): HistoryWeekView {
  return {
    week: formatIsoWeek(week),
    range: rangeLabel(week),
    days: [],
    rows: [],
    notReached: [],
    noNumber: [],
    counts: { drivers: 0, loads: 0, notReached: 0 },
  };
}
