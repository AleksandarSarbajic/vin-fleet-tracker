import type { HistoryWeekView, RouteText } from '@/lib/history';
import { PAD } from './HistoryTable';
import { StatusMark } from './StatusMark';

/**
 * §12.101 — the two lists under the table. "Not reached this week": loads
 * created this week that no stop has reached, each labelled with its day.
 * "No load number": the loads in the table without one, so they can be
 * chased. Print starts them on a new page when they do not fit.
 */

function Route({ route }: { route: RouteText }) {
  const rest = route.pre ? route.full.slice(route.pre.length) : route.full;
  return (
    <span title={route.full} className="truncate">
      {route.pre ? (
        <span className="font-cond text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-secondary print:text-print-inkSecondary">
          {route.pre}
        </span>
      ) : null}
      {rest}
    </span>
  );
}

const HEAD =
  'font-cond text-[10.5px] font-semibold uppercase leading-none tracking-[.11em] text-text-muted print:text-print-inkSecondary';
const ROW =
  'grid min-h-9 items-center gap-x-3 border-b border-line-soft py-1 font-sans text-[12.5px] text-text print:min-h-7 print:border-print-ruleSoft print:text-[12px] print:text-print-ink';

function ListFrame({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex items-baseline gap-2 border-b border-line-hair pb-[9px] print:border-print-rule">
        <h2 className="font-cond text-[12px] font-semibold uppercase leading-none tracking-[.11em] text-text print:text-print-ink">
          {title}
        </h2>
        <span className="font-sans text-[12px] font-semibold leading-none text-accent print:text-print-ink">
          {count}
        </span>
        <span className="ml-auto font-sans text-[11.5px] leading-none text-text-muted print:text-print-inkSecondary">
          {note}
        </span>
      </div>
      {count === 0 ? (
        <div className="py-3 font-sans text-[12.5px] text-text-muted print:text-print-inkMuted">None this week.</div>
      ) : (
        children
      )}
    </section>
  );
}

export function HistoryLists({ view }: { view: HistoryWeekView }) {
  const notReachedCols = 'grid-cols-[56px_minmax(0,1fr)_minmax(0,120px)_40px_minmax(0,150px)]';
  const noNumberCols = 'grid-cols-[56px_minmax(0,1fr)_minmax(0,128px)_40px_96px]';
  return (
    <div
      data-history-lists=""
      className={`grid grid-cols-1 gap-6 pb-7 pt-6 min-[1280px]:grid-cols-2 print:grid-cols-2 ${PAD}`}
    >
      <ListFrame title="Not reached this week" count={view.notReached.length} note="Created this week, no stop reached">
        <div className={`grid h-7 items-center gap-x-3 border-b border-line-soft ${notReachedCols}`}>
          {['Load', 'Route', 'Driver', 'Truck', 'Created'].map((h) => (
            <span key={h} className={HEAD}>{h}</span>
          ))}
        </div>
        {view.notReached.map((x) => (
          <div key={x.loadId} className={`${ROW} ${notReachedCols}`}>
            <span className={`font-semibold ${x.number ? '' : 'text-text-secondary'}`}>{x.number ?? '—'}</span>
            <Route route={x.route} />
            <span className={`truncate ${x.driver ? '' : 'text-text-secondary'}`}>{x.driver ?? 'Not assigned'}</span>
            <span className="text-text-secondary print:text-print-inkSecondary">{x.truck ?? '—'}</span>
            <span className="text-[11.5px] leading-[1.35] text-text-secondary print:text-print-inkSecondary">{x.created}</span>
          </div>
        ))}
      </ListFrame>
      <ListFrame title="No load number" count={view.noNumber.length} note="Also shown in the table">
        <div className={`grid h-7 items-center gap-x-3 border-b border-line-soft ${noNumberCols}`}>
          {['Day', 'Route', 'Driver', 'Truck', 'Status'].map((h) => (
            <span key={h} className={HEAD}>{h}</span>
          ))}
        </div>
        {view.noNumber.map((x, k) => (
          <div key={k} className={`${ROW} ${noNumberCols}`}>
            <span className="font-semibold text-text-secondary print:text-print-inkSecondary">{x.day}</span>
            <Route route={x.route} />
            <span className={`truncate ${x.driver ? '' : 'text-text-secondary'}`}>{x.driver ?? 'No driver assigned'}</span>
            <span className="text-text-secondary print:text-print-inkSecondary">{x.truck ?? '—'}</span>
            <StatusMark status={x.status} />
          </div>
        ))}
      </ListFrame>
    </div>
  );
}
