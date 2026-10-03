'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ENTRY_STATUS_LABEL, NO_DRIVER, type HistoryEntry, type HistoryRow, type HistoryWeekView } from '@/lib/history';
import { STATUS_INK, STATUS_RULE, StatusIcon, StatusMark } from './StatusMark';

/**
 * §12.101, design 1a — one row per driver, one column per day.
 *
 * Every track is `minmax(0, …)`, so the grid can never push the page
 * sideways; content truncates instead. The driver column steps up with the
 * width (the design's table, plus 140 below 1024), the weekdays share what is
 * left and the weekend columns take 0.72 of a weekday.
 */
export const GRID =
  'grid grid-cols-[140px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))] ' +
  'min-[1024px]:grid-cols-[156px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))] ' +
  'min-[1280px]:grid-cols-[172px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))] ' +
  'min-[1440px]:grid-cols-[200px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))] ' +
  'min-[1680px]:grid-cols-[208px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))] ' +
  'min-[1920px]:grid-cols-[224px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))] ' +
  'print:!grid-cols-[150px_repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.72fr))]';

/** Side padding: 16, 20 from 1440, 24 from 1680. */
export const PAD = 'px-4 min-[1440px]:px-5 min-[1680px]:px-6 print:px-0';

/** 1–3 loads show in full; 4 or more show the first 2 and "+N more". */
const FOLD_AT = 4;

const cellGround = (i: number, today: boolean) =>
  today ? 'bg-history-today print:bg-transparent' : i >= 5 ? 'bg-history-weekend print:bg-print-weekend' : '';

export function HistoryTable({
  view,
  rows,
  todayIndex,
}: {
  view: HistoryWeekView;
  rows: HistoryRow[];
  /** 0–6 in the current week; null for any other. Days after it are blank. */
  todayIndex: number | null;
}) {
  return (
    <div
      role="table"
      aria-label={`Driver history, ${view.range}`}
      className="border border-line-hair print:table print:w-full print:border-print-rule"
    >
      {/* §12.103. On paper the head is a table head, so it repeats on every
          page the table runs onto; on screen these wrappers are not boxes.
          Chromium repeats a head group only when it cannot break — a real
          <thead> gets that from the browser; this one needs it said. */}
      <div className="contents print:table-header-group print:break-inside-avoid">
        <HeadRow view={view} todayIndex={todayIndex} />
      </div>
      <div className="contents print:table-row-group">
        {rows.map((row) => (
          <DriverRow key={row.driverId ?? 'none'} row={row} view={view} todayIndex={todayIndex} />
        ))}
      </div>
    </div>
  );
}

export function HeadRow({ view, todayIndex }: { view: HistoryWeekView; todayIndex: number | null }) {
  return (
    <div
      role="row"
      className={`${GRID} sticky top-0 z-10 border-b border-line-hair bg-surface-raised print:static print:border-print-rule print:bg-print-head`}
    >
      <div
        role="columnheader"
        className="flex h-10 items-center px-3 font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[.11em] text-text-muted print:h-auto print:px-2 print:py-[7px] print:text-print-inkSecondary"
      >
        Driver · truck
      </div>
      {view.days.map((day, i) => {
        const today = i === todayIndex;
        const ahead = todayIndex !== null && i > todayIndex;
        return (
          <div
            key={day.iso}
            role="columnheader"
            aria-label={day.full}
            className={`flex h-10 min-w-0 items-center gap-1.5 border-l border-line-soft px-2.5 print:h-auto print:border-print-ruleSoft print:px-2 print:py-[7px] ${
              today
                ? 'bg-history-todayHead shadow-[inset_0_2px_0_theme(colors.accent.DEFAULT)] print:bg-transparent print:shadow-none'
                : i >= 5
                  ? 'bg-history-weekendHead print:bg-transparent'
                  : ''
            }`}
          >
            <span
              className={`font-cond text-[11px] font-semibold uppercase leading-none tracking-[.11em] print:text-print-ink ${
                today ? 'text-accent' : ahead ? 'text-text-muted' : 'text-text-secondary'
              }`}
            >
              {day.dow}
            </span>
            <span
              className={`font-sans text-[13px] font-semibold leading-none tabular-nums print:text-print-ink ${
                ahead ? 'text-text-muted' : 'text-text'
              }`}
            >
              {day.date}
            </span>
            {today ? (
              <span className="ml-auto bg-accent px-[5px] py-[3px] font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[.1em] text-text-inverse print:hidden">
                Today
              </span>
            ) : null}
            {today ? <span className="hidden whitespace-nowrap text-print-inkSecondary print:inline"> · today</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function DriverRow({ row, view, todayIndex }: { row: HistoryRow; view: HistoryWeekView; todayIndex: number | null }) {
  const multi = row.trucks.length > 1;
  return (
    <div
      role="row"
      data-driver-row={row.name}
      className={`${GRID} min-h-[52px] break-inside-avoid border-b border-line-soft print:border-print-ruleSoft`}
    >
      <div role="rowheader" className="flex min-w-0 flex-col gap-1 px-3 py-2.5 print:gap-0.5 print:px-2 print:py-1.5">
        <span
          title={row.name}
          className={`truncate font-sans text-[13px] font-medium leading-[1.3] print:overflow-visible print:whitespace-normal print:text-[12px] print:font-semibold print:text-print-ink ${
            row.name === NO_DRIVER ? 'text-text-secondary' : 'text-text'
          }`}
        >
          {row.name}
        </span>
        {row.trucks.map((t) => (
          <span
            key={t.label}
            className="truncate font-sans text-[11.5px] leading-[1.35] text-text-secondary print:overflow-visible print:whitespace-normal print:text-[11px] print:text-print-inkSecondary"
          >
            {multi ? '' : 'Truck '}
            <span className="font-medium text-text print:text-print-inkSecondary">{t.label}</span>
            {t.days ? (multi ? ` · ${t.days}` : ` · ${t.days} only`) : ''}
          </span>
        ))}
      </div>
      {row.loadCount === 0 ? (
        <div
          role="cell"
          className="col-span-7 flex items-center border-l border-line-soft px-3 font-sans text-[12.5px] text-text-muted print:border-print-ruleSoft print:px-2 print:text-[11.5px] print:text-print-inkSecondary"
        >
          No loads this week
        </div>
      ) : (
        row.cells.map((cell, i) => (
          <DayCell
            key={view.days[i]!.iso}
            entries={cell.entries}
            noTruck={cell.noTruck}
            index={i}
            today={i === todayIndex}
            ahead={todayIndex !== null && i > todayIndex}
          />
        ))
      )}
    </div>
  );
}

function DayCell({
  entries,
  noTruck,
  index,
  today,
  ahead,
}: {
  entries: HistoryEntry[];
  noTruck: boolean;
  index: number;
  today: boolean;
  ahead: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const folded = !expanded && entries.length >= FOLD_AT;
  return (
    <div
      role="cell"
      className={`flex min-w-0 flex-col gap-1.5 border-l border-line-soft p-1.5 print:gap-[5px] print:border-print-ruleSoft print:px-1.5 print:py-[5px] ${cellGround(index, today)}`}
    >
      {ahead ? null : entries.length === 0 ? (
        noTruck ? (
          <span className="my-auto self-center font-sans text-[11.5px] text-text-muted print:text-[11px] print:text-print-inkMuted">
            No truck
          </span>
        ) : (
          <span aria-label="No loads" className="my-auto self-center font-sans text-[12.5px] text-text-muted print:text-[12px] print:text-print-inkMuted">
            —
          </span>
        )
      ) : (
        <>
          {entries.map((entry, j) => (
            // Folded loads are still printed: print never truncates.
            <div key={entry.key} className={folded && j >= 2 ? 'hidden print:block' : ''}>
              <LoadBlock entry={entry} weekend={index >= 5} />
            </div>
          ))}
          {folded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="h-[26px] border border-dashed border-line-tag px-2 text-left font-cond text-[11px] font-semibold uppercase leading-none tracking-[.08em] text-text hover:bg-surface-overlay print:hidden"
            >
              +{entries.length - 2} more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Hover after 300 ms, or focus at once (§12.101, design spec "Tooltip"). */
const HOVER_DELAY_MS = 300;
/** Closer than this to the bottom of the screen, the tooltip opens above. */
const FLIP_WITHIN_PX = 260;

export function LoadBlock({ entry, weekend }: { entry: HistoryEntry; weekend: boolean }) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const timer = useRef<number | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const tipId = useId();

  const show = () => {
    const rect = box.current?.getBoundingClientRect();
    setAbove(rect ? window.innerHeight - rect.bottom < FLIP_WITHIN_PX : false);
    setOpen(true);
  };
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  const pre = entry.route.pre;
  const rest = pre ? entry.route.full.slice(pre.length) : entry.route.full;
  const quiet = entry.status === 'cancelled' || entry.status === 'tonu';

  return (
    <div
      ref={box}
      tabIndex={0}
      data-load={entry.number ?? 'no number'}
      aria-label={`${entry.number ? `Load ${entry.number}` : 'No load number'}, ${entry.route.full}, ${ENTRY_STATUS_LABEL[entry.status]}`}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => {
        cancel();
        timer.current = window.setTimeout(show, HOVER_DELAY_MS);
      }}
      onMouseLeave={() => {
        cancel();
        setOpen(false);
      }}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      className={`relative min-w-0 cursor-default border border-l-2 border-line-soft bg-surface-raised pb-1.5 pl-2 pr-[7px] pt-[5px] hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent print:border-0 print:border-l-2 print:bg-transparent print:py-px print:pl-1.5 print:pr-0 ${STATUS_RULE[entry.status]}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-px">
        <span
          title={entry.number ? undefined : 'No load number'}
          className={`font-sans text-[12.5px] font-semibold leading-[1.3] tabular-nums print:text-[11.5px] ${
            entry.number ? 'text-text print:text-print-ink' : 'text-text-secondary print:text-print-inkSecondary'
          }`}
        >
          {entry.number ?? '—'}
        </span>
        <StatusMark status={entry.status} className="print:text-[10px]" />
      </div>
      <div
        className={`mt-[3px] line-clamp-2 font-sans text-[12px] leading-[1.35] [overflow-wrap:anywhere] print:line-clamp-none ${
          quiet ? 'text-text-secondary print:text-print-inkSecondary' : 'text-text print:text-print-ink'
        }`}
      >
        {pre ? (
          <span className="font-cond text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-secondary print:text-[10px] print:text-print-inkSecondary">
            {pre}
          </span>
        ) : null}
        {rest}
      </div>
      {entry.truck ? (
        <div className="mt-0.5 font-sans text-[11.5px] leading-[1.3] text-text-secondary print:text-[10.5px] print:text-print-inkSecondary">
          Truck {entry.truck}
        </div>
      ) : null}
      {open ? <Tooltip id={tipId} entry={entry} weekend={weekend} above={above} /> : null}
    </div>
  );
}

function Tooltip({
  id,
  entry,
  weekend,
  above,
}: {
  id: string;
  entry: HistoryEntry;
  weekend: boolean;
  above: boolean;
}) {
  return (
    <div
      id={id}
      role="tooltip"
      data-history-tooltip=""
      className={`absolute z-30 flex w-[300px] flex-col gap-2.5 border border-line-tag bg-surface-overlay px-3.5 py-3 shadow-modal print:hidden ${
        above ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
      } ${weekend ? '-right-px' : '-left-px'}`}
    >
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-sans text-[14px] font-semibold text-text">{entry.tip.title}</span>
        <span
          className={`inline-flex items-center gap-1 font-cond text-[11px] font-semibold uppercase leading-none tracking-[.08em] ${STATUS_INK[entry.status]}`}
        >
          <StatusIcon status={entry.status} />
          {ENTRY_STATUS_LABEL[entry.status]}
        </span>
      </div>
      <div className="font-sans text-[13px] font-medium leading-[1.4] text-text">{entry.tip.route}</div>
      {entry.tip.stops.map((stop, k) => (
        <div key={k} className="flex flex-col gap-1 border-t border-line-hair pt-2">
          <span className="font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[.11em] text-text-secondary">
            {stop.kind} · {stop.place}
          </span>
          <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 font-sans text-[12px] leading-[1.4]">
            <span className="text-text-secondary">Arrived</span>
            <span className="text-text">{stop.arrived}</span>
            <span className="text-text-secondary">Departed</span>
            <span className="text-text">{stop.departed}</span>
          </div>
        </div>
      ))}
      {entry.tip.missing ? (
        <div className="font-sans text-[12px] leading-[1.4] text-text-secondary">{entry.tip.missing}</div>
      ) : null}
      <div className="border-t border-line-hair pt-2 font-sans text-[12px] text-text-secondary">{entry.tip.meta}</div>
    </div>
  );
}
