'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LOAD_STATUS_LABEL, type LoadStatus } from '@/lib/loads';
import { OPEN_STATUSES, reopenLines, reopenTitle, type RecentlyClosed } from '@/lib/reopen-load';
import { useFocusTrap } from './useModalChrome';

/**
 * §12.107 — Reopen load's confirm step. Every sentence comes from
 * `reopenLines`, the function the server's rules are written beside.
 *
 * Focus starts on Back, so an Enter carried over from the list does not
 * reopen anything; Esc goes back. When the close's record does not say what
 * the load was, the dispatcher chooses — nothing is preselected and Reopen
 * says what is missing until they do.
 */
export function ReopenConfirm({
  truckId,
  truckName,
  load,
  dispatchTz,
  onBack,
  onReopened,
}: {
  truckId: string;
  truckName: string;
  load: RecentlyClosed;
  dispatchTz: string;
  onBack: () => void;
  onReopened: () => void;
}) {
  const queryClient = useQueryClient();
  const trap = useFocusTrap(true);
  const [chosen, setChosen] = useState<LoadStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Frozen at open, like the edit modal's own `openedAt`. */
  const [now] = useState(() => new Date());
  const asks = load.close.statusBefore === null;

  const lines = reopenLines({
    truckName,
    loadNumber: load.loadNumber,
    close: load.close,
    others: load.others,
    plan: { restored: load.restored, missing: load.missing },
    late: load.late,
    dispatchTz,
    now,
  });

  const confirm = useCallback(async () => {
    if (busy) return;
    if (asks && chosen === null) {
      setProblem('Choose the status the load goes back to.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch('/api/stops/reopen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          truckId,
          loadId: load.loadId,
          closeAuditId: load.close.closeAuditId,
          ...(asks && chosen ? { status: chosen } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          reference?: string;
        } | null;
        setProblem(
          `${body?.error ?? 'Nothing was changed: the reopen failed.'}${
            body?.reference ? ` (${body.reference})` : ''
          }`,
        );
        await queryClient.invalidateQueries({ queryKey: ['recently-closed', truckId] });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fleet'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-health'] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', truckId] }),
        queryClient.invalidateQueries({ queryKey: ['recently-closed', truckId] }),
      ]);
      onReopened();
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Nothing was changed: the reopen failed.');
    } finally {
      setBusy(false);
    }
  }, [asks, busy, chosen, load, onReopened, queryClient, truckId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onBack();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  const [first, ...rest] = lines;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm reopen load"
      data-reopen-confirm=""
    >
      <div
        ref={trap}
        className="max-h-full w-[640px] max-w-full overflow-auto border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            {reopenTitle(load.loadNumber)}
          </h2>
        </div>

        <div className="p-4">
          <p className="mb-3 text-[13px] leading-[1.5] text-text" data-reopen-first>
            {first}
          </p>

          {asks ? (
            <fieldset className="mb-4 border-0 p-0" data-reopen-status>
              <legend className="sr-only">The status the load goes back to</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {OPEN_STATUSES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-body text-text">
                    <input
                      type="radio"
                      name="reopen-status"
                      value={s}
                      checked={chosen === s}
                      onChange={() => {
                        setChosen(s);
                        setProblem(null);
                      }}
                    />
                    {LOAD_STATUS_LABEL[s]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-[1.5] text-text" data-reopen-lines>
            {rest.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {problem ? (
            <p
              role="alert"
              className="mt-3 border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg"
            >
              {problem}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-line-hair bg-surface-raised px-4 py-3">
          <span className="text-small text-text-mutedOnOverlay">Esc back</span>
          <div className="flex gap-2.5">
            <button
              type="button"
              data-initial-focus
              onClick={onBack}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
            >
              Back
            </button>
            <button
              type="button"
              aria-disabled={busy || (asks && chosen === null)}
              onClick={() => void confirm()}
              className="h-10 bg-accent px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover aria-disabled:opacity-45"
            >
              {busy ? 'Reopening…' : 'Reopen load'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
