import { GRID } from './HistoryTable';

/**
 * §12.101 — the table frame's other states: an empty week (B), loading (D),
 * an error (E) and a week from before the records began (F). Each sits
 * inside the table frame under its head, so the page still reads as a record.
 */

const BUTTON =
  'h-8 border px-3 font-cond text-[12px] font-semibold uppercase leading-none tracking-[.08em]';
const GHOST = `${BUTTON} border-line-rule bg-transparent text-text hover:bg-surface-overlay`;
const PRIMARY = `${BUTTON} border-accent bg-accent text-text-inverse hover:bg-accent-hover`;

function Calendar({ className = '' }: { className?: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className={className}>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function Panel({ children, role }: { children: React.ReactNode; role?: 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-center gap-2.5 px-8 pb-[60px] pt-14 text-center">
      {children}
    </div>
  );
}

const TITLE = 'font-cond text-[22px] font-semibold uppercase leading-[1.1] tracking-[.04em] text-text print:text-print-ink';
const BODY = 'max-w-[520px] font-sans text-[12.5px] leading-[1.55] text-text-secondary print:text-print-inkSecondary';
/** §12.103. Paper cannot be clicked: the state's buttons are not printed. */
const ACTIONS = 'mt-2 flex gap-2 print:hidden';

/** B. A week with nothing in it — the toolbar, head and lists stay. */
export function EmptyWeek({ range, drivers, onPrevious }: { range: string; drivers: number; onPrevious: () => void }) {
  return (
    <Panel>
      <Calendar className="text-text-muted print:text-print-inkMuted" />
      <div className={TITLE}>No loads recorded this week</div>
      <div className={BODY}>
        {range} has no loads yet for any of the {drivers} drivers. Loads appear here when they are assigned or a
        stop is reached.
      </div>
      <div className={ACTIONS}>
        <button type="button" onClick={onPrevious} className={GHOST}>
          ‹ Previous week
        </button>
      </div>
    </Panel>
  );
}

/** F. A week from before Fleet Tracker kept any record. */
export function BeforeRecords({
  firstWeekLabel,
  onFirstWeek,
  onThisWeek,
}: {
  firstWeekLabel: string;
  onFirstWeek: () => void;
  onThisWeek: () => void;
}) {
  return (
    <Panel>
      <Calendar className="text-text-muted print:text-print-inkMuted" />
      <div className={TITLE}>No records for this week</div>
      <div className={BODY}>
        Fleet Tracker started keeping load history on Sep 14, 2026. Weeks before that have no data.
      </div>
      <div className={ACTIONS}>
        <button type="button" onClick={onFirstWeek} className={PRIMARY}>
          Go to {firstWeekLabel}
        </button>
        <button type="button" onClick={onThisWeek} className={GHOST}>
          This week
        </button>
      </div>
    </Panel>
  );
}

/** E. The week did not load; nothing else is affected, and it says so. */
export function WeekError({
  range,
  detail,
  onRetry,
  onPrevious,
}: {
  range: string;
  detail: string;
  onRetry: () => void;
  onPrevious: () => void;
}) {
  return (
    <Panel role="alert">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-status-late-fg print:text-print-cancelled">
        <path d="M12 3 2 21h20Z" />
        <path d="M12 10v5M12 18h.01" />
      </svg>
      <div className={TITLE}>Could not load this week</div>
      <div className={BODY}>{range} did not load. The board and live tracking are not affected.</div>
      <div className="font-sans text-[11.5px] text-text-muted print:text-print-inkSecondary">{detail}</div>
      <div className={ACTIONS}>
        <button type="button" onClick={onRetry} className={`${PRIMARY} inline-flex items-center gap-[7px] px-3.5`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Retry
        </button>
        <button type="button" onClick={onPrevious} className={GHOST}>
          Previous week
        </button>
      </div>
    </Panel>
  );
}

/** D. Six skeleton rows that pulse while the week is read. */
const SKELETON = [110, 86, 124, 96, 104, 80];
export function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Loading this week">
      {SKELETON.map((w, k) => (
        <div key={k} className={`${GRID} h-16 animate-[pulse_1.2s_ease-in-out_infinite] border-b border-line-soft`}>
          <div className="flex flex-col gap-2 px-3 py-3.5">
            <span className="block h-[11px] bg-surface-overlay" style={{ width: w }} />
            <span className="block h-[9px] w-14 bg-surface-raised" />
          </div>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="border-l border-line-soft px-1.5 py-2">
              {(k * 3 + i * 5) % 4 !== 0 ? (
                <div className={`bg-surface-raised ${(k + i) % 3 === 0 ? 'h-[46px]' : 'h-[30px]'}`} />
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
