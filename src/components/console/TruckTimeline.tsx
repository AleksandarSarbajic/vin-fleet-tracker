'use client';

import { useEffect } from 'react';
import { useFocusTrap, useReturnFocus } from '@/components/edit/useModalChrome';
import { useTruckTimeline } from '@/hooks/useTruckTimeline';
import { timeInZone } from '@/lib/format';
import { OVERRIDE_REASON_LABEL } from '@/lib/override';
import { STATUS_LABEL, type OverrideReason, type Status } from '@/lib/status';
import {
  currentStopId,
  groupByLoad,
  minutesLate,
  overrideState,
  stopPlace,
  stopState,
  type StopState,
} from '@/lib/timeline';
import type { TimelineOverride, TimelineStop } from '@/server/timeline';

/**
 * §14 feature 15 — the per-truck timeline. **Interpretation**: turn 5 listed
 * the feature and drew no screen.
 *
 * ## Read-only, deliberately and visibly
 *
 * §12.15 defers History, the audit-log view and override review, and warns
 * that the `History` button in §9.4's detail panel needs hiding until then
 * because it would "promise a reversal path that does not exist". This sits
 * beside all three, so it carries **no action at all** — nothing to undo,
 * restore or reverse — and says so at its foot rather than leaving the
 * absence to be discovered.
 *
 * ## Not on the overlay layer
 *
 * §14.5 gave that layer to the palette, the cheat sheet and the tour, and
 * "only one open at a time" is its whole point. A timeline opened from the
 * map popup is not one of those three, and it must not close the tour that
 * is explaining it. It sits at z-40 beside `EditStopModal` instead, which is
 * the precedent for a surface that is not part of that set.
 *
 * ## The zone each time is printed in
 *
 * The stop's own, falling back to the dispatch zone. An appointment is
 * entered as stop-local wall time (CLAUDE.md), and an arrival happened at the
 * dock — so both belong in the dock's zone, with the abbreviation derived at
 * render by `timeInZone` and never stored.
 */

const STATE_DOT: Record<StopState, string> = {
  done: 'bg-status-ontime-fg',
  here: 'bg-accent',
  // Hollow: nothing has happened here yet, and a filled dot would say it had.
  ahead: 'border border-status-neutral-bd',
};

const STATE_WORD: Record<StopState, string> = {
  done: 'Departed',
  here: 'On site',
  ahead: 'Ahead',
};

export function TruckTimeline({
  truckId,
  truckLabel,
  dispatchTz,
  onClose,
}: {
  truckId: string;
  truckLabel: string;
  dispatchTz: string;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useTruckTimeline(truckId);
  const trap = useFocusTrap(true);
  useReturnFocus(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Nothing here is unsaved, so Esc closes outright — no discard confirm,
      // which is the one thing that makes this cheaper than the edit modal.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const stops = data ?? [];
  const loads = groupByLoad(stops);
  const current = currentStopId(stops);
  const now = Date.now();

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Timeline for truck ${truckLabel}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={trap}
        className="flex max-h-full w-[620px] max-w-full flex-col border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-hair px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            Truck {truckLabel} — timeline
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-line-hair px-3 py-1 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {isPending ? (
            <p className="py-8 text-center text-body text-text-mutedOnOverlay">
              Loading…
            </p>
          ) : isError ? (
            <p role="alert" className="py-8 text-center text-body text-status-late-fg">
              The timeline could not be loaded.
            </p>
          ) : loads.length === 0 ? (
            <p className="py-8 text-center text-body text-text-mutedOnOverlay">
              Nothing on this truck in the last 24 hours, and nothing ahead of it.
            </p>
          ) : (
            loads.map((load) => (
              <section key={load.loadId} className="mb-4 last:mb-0">
                <h3 className="mb-2 flex items-baseline gap-2 border-b border-line-soft pb-1 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
                  <span className="text-text-secondary">
                    {/* §12.21: blank means blank, and it says so. */}
                    {load.loadNumber ?? 'Load — no number given'}
                  </span>
                  <span>{load.loadStatus.toLowerCase().replace(/_/g, ' ')}</span>
                </h3>
                {load.stops.map((stop) => (
                  <StopCard
                    key={stop.stopId}
                    stop={stop}
                    dispatchTz={dispatchTz}
                    now={now}
                    isCurrent={stop.stopId === current}
                  />
                ))}
              </section>
            ))
          )}
        </div>

        {/*
          §12.15, said out loud. The deferred History is the surface that
          would carry an undo; a timeline that stayed silent about having none
          invites exactly the question the deferral was meant to close.
        */}
        <p className="shrink-0 border-t border-line-hair px-4 py-2 font-sans text-small text-text-mutedOnOverlay">
          A record, not a control — nothing here can be undone from this screen.
        </p>
      </div>
    </div>
  );
}

function StopCard({
  stop,
  dispatchTz,
  now,
  isCurrent,
}: {
  stop: TimelineStop;
  dispatchTz: string;
  now: number;
  isCurrent: boolean;
}) {
  const state = stopState(stop);
  const zone = stop.apptTz ?? dispatchTz;
  const at = (instant: string) => timeInZone(new Date(instant), zone);
  const late = minutesLate(stop);

  return (
    <div className="flex gap-3 py-2" data-stop-state={state}>
      <div className="flex w-3 shrink-0 flex-col items-center pt-[5px]">
        <span
          className={`h-[9px] w-[9px] shrink-0 ${STATE_DOT[state]}`}
          aria-hidden="true"
        />
        <span className="mt-1 w-px flex-1 bg-line-soft" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay">
            {stop.type} {stop.sequence}
          </span>
          <span className="truncate text-body font-medium text-text">
            {stopPlace(stop)}
          </span>
          {isCurrent ? (
            <span className="shrink-0 font-cond text-micro uppercase tracking-[.09em] text-accent">
              ← now
            </span>
          ) : null}
        </p>

        <dl className="mt-1 grid grid-cols-[86px_1fr] gap-x-3 gap-y-[3px] text-small">
          <Line label={stop.apptType === 'FCFS' ? 'Receiving' : 'Appointment'}>
            {stop.apptStartUtc === null ? (
              <span className="text-text-mutedOnOverlay">Not set</span>
            ) : (
              <>
                {at(stop.apptStartUtc)}
                {stop.apptEndUtc ? ` – ${at(stop.apptEndUtc)}` : ''}
              </>
            )}
          </Line>

          {stop.arrivedAt ? (
            <Line label="Arrived">
              {at(stop.arrivedAt)}
              <span className="text-text-mutedOnOverlay">
                {' '}
                ·{' '}
                {/* §12.57: a hand-marked arrival is as arrived as a detected
                    one, but WHICH kind of claim it is stays visible. */}
                {stop.arrivedSource === 'dispatcher'
                  ? 'marked by a dispatcher'
                  : 'detected'}
              </span>
              {late !== null && late > 0 ? (
                <span className="text-status-late-fg"> · {late} min late</span>
              ) : null}
            </Line>
          ) : null}

          {stop.departedAt ? <Line label="Departed">{at(stop.departedAt)}</Line> : null}

          {stop.dispatcherNote ? (
            <Line label="Note">
              <span className="whitespace-pre-wrap">{stop.dispatcherNote}</span>
              {stop.noteAt ? (
                <span className="text-text-mutedOnOverlay"> · {at(stop.noteAt)}</span>
              ) : null}
            </Line>
          ) : null}

          {stop.overrides.map((override) => (
            <OverrideLine
              key={`${override.setAt}-${override.forcedStatus}`}
              override={override}
              now={now}
              at={at}
            />
          ))}

          {state === 'ahead' && !stop.dispatcherNote && stop.overrides.length === 0 ? (
            <Line label="Status">
              <span className="text-text-mutedOnOverlay">{STATE_WORD[state]}</span>
            </Line>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay">
        {label}
      </dt>
      <dd className="min-w-0 text-text-secondary">{children}</dd>
    </>
  );
}

function OverrideLine({
  override,
  now,
  at,
}: {
  override: TimelineOverride;
  now: number;
  at: (instant: string) => string;
}) {
  const state = overrideState(override, now);
  const label = STATUS_LABEL[override.forcedStatus as Status] ?? override.forcedStatus;
  const reason =
    OVERRIDE_REASON_LABEL[override.reason as OverrideReason] ?? override.reason;

  return (
    <Line label={state === 'live' ? 'Forced' : 'Was forced'}>
      <span className={state === 'live' ? 'text-status-risk-fg' : 'text-text-secondary'}>
        {label}
      </span>
      <span className="text-text-mutedOnOverlay">
        {' '}
        · {reason}
        {override.reasonNote ? ` — ${override.reasonNote}` : ''}
        {override.setByName ? ` · ${override.setByName}` : ''} · set {at(override.setAt)}
        {/*
          Cleared and expired are different facts (§9.5): one is a dispatcher
          changing their mind, the other is the claim lapsing on its own.
        */}
        {state === 'live' ? ` · until ${at(override.expiresAt)}` : null}
        {state === 'cleared' && override.clearedAt
          ? ` · cleared ${at(override.clearedAt)}`
          : null}
        {state === 'expired' ? ` · expired ${at(override.expiresAt)}` : null}
      </span>
    </Line>
  );
}
