'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTruckTimeline } from '@/hooks/useTruckTimeline';
import {
  CLEAR_STATUSES,
  DEFAULT_CLEAR_STATUS,
  confirmLines,
  initialChoice,
  openLoadChoices,
  type ClearStatus,
} from '@/lib/clear-stop';
import { LOAD_STATUS_LABEL } from '@/lib/loads';
import { timelineStay } from '@/lib/timeline';
import { useFocusTrap } from './useModalChrome';

/**
 * §12.88 — Clear stop's confirm step.
 *
 * Built from the truck's TIMELINE rows, read fresh on open: they carry every
 * stop of every open load, which the fleet row does not — it holds one next
 * stop and a count. So a "+1 load" truck lists both loads by name, and the
 * timeline sentence is computed by the function the timeline itself filters
 * with.
 *
 * Keyboard: Enter confirms, Esc backs out to the edit modal, and focus starts
 * on the confirm button rather than a field. The button is `aria-disabled`,
 * never `disabled`, so it can hold that focus while nothing is chosen yet —
 * Enter then says what is missing instead of doing nothing.
 */
const STILL_READING = "Still reading this truck's loads. Nothing was closed.";

export function ClearStopConfirm({
  truckId,
  truckName,
  dispatchTz,
  unsaved,
  onBack,
  onCleared,
}: {
  truckId: string;
  truckName: string;
  dispatchTz: string;
  unsaved: readonly string[];
  onBack: () => void;
  onCleared: () => void;
}) {
  const queryClient = useQueryClient();
  const trap = useFocusTrap(true);
  const timeline = useTruckTimeline(truckId, { fresh: true });
  const ready = timeline.data !== undefined && !timeline.isFetching;
  const choices = ready ? openLoadChoices(timeline.data) : [];

  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<ClearStatus>(DEFAULT_CLEAR_STATUS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Frozen at open, like the edit modal's own `openedAt`. */
  const [now] = useState(() => Date.now());

  // The read landed: "still reading" is no longer true, so it goes.
  useEffect(() => {
    if (ready) setProblem((p) => (p === STILL_READING ? null : p));
  }, [ready]);

  const chosenId = picked ?? initialChoice(choices);
  const choice = choices.find((c) => c.loadId === chosenId) ?? null;
  const lines = choice
    ? confirmLines({
        truckName,
        choice,
        status,
        others: choices.filter((c) => c.loadId !== choice.loadId),
        stay: timelineStay({ status, stops: choice.stops }, now),
        dispatchTz,
        unsaved,
      })
    : [];

  const confirm = useCallback(async () => {
    if (busy) return;
    /**
     * Said, not swallowed. Enter pressed before the fresh read lands — before
     * the dispatcher has seen what closing does — must not close anything,
     * and it must not look like a key that did nothing either.
     */
    if (!ready) {
      setProblem(STILL_READING);
      return;
    }
    if (!choice) {
      setProblem(
        choices.length === 0
          ? 'This truck has no open load any more.'
          : 'Choose which load to close.',
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch('/api/stops/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ truckId, loadId: choice.loadId, status }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          reference?: string;
        } | null;
        setProblem(
          `${body?.error ?? 'Nothing was changed: the clear failed.'}${
            body?.reference ? ` (${body.reference})` : ''
          }`,
        );
        // Whatever moved, the list should show it now.
        if (response.status === 409) setPicked(null);
        await queryClient.invalidateQueries({ queryKey: ['timeline', truckId] });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fleet'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-health'] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', truckId] }),
      ]);
      onCleared();
    } catch (error: unknown) {
      setProblem(
        error instanceof Error ? error.message : 'Nothing was changed: the clear failed.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, choice, choices.length, onCleared, queryClient, ready, status, truckId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
      } else if (
        event.key === 'Enter' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        // Enter on Back means Back.
        !(
          event.target instanceof HTMLElement && event.target.closest('[data-clear-back]')
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        void confirm();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirm, onBack]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm clear stop"
    >
      <div
        ref={trap}
        className="max-h-full w-[560px] max-w-full overflow-auto border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            Clear stop — truck {truckName}
          </h2>
        </div>

        <div className="p-4">
          {!ready ? (
            <p className="text-body text-text-mutedOnOverlay">
              Reading this truck&apos;s loads…
            </p>
          ) : timeline.isError ? (
            <p role="alert" className="text-body text-status-late-fg">
              This truck&apos;s loads could not be read. Nothing was changed.
            </p>
          ) : (
            <>
              {choices.length > 1 ? (
                <fieldset className="mb-4 border-0 p-0" data-clear-loads>
                  <legend className="mb-2 text-body text-text">
                    This truck holds {choices.length} open loads. Choose the one to close.
                  </legend>
                  {choices.map((c) => (
                    <label
                      key={c.loadId}
                      className="flex items-center gap-2 py-1 text-body text-text"
                    >
                      <input
                        type="radio"
                        name="clear-load"
                        value={c.loadId}
                        checked={chosenId === c.loadId}
                        onChange={() => {
                          setPicked(c.loadId);
                          setProblem(null);
                        }}
                      />
                      <span className="font-medium tabular-nums">
                        {c.loadNumber ?? 'No load number'}
                      </span>
                      <span className="text-text-mutedOnOverlay">
                        · next stop {c.nextPlace}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              <fieldset className="mb-4 border-0 p-0">
                <legend className="mb-2 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
                  Close it as
                </legend>
                <div className="flex gap-5">
                  {CLEAR_STATUSES.map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-2 text-body text-text"
                    >
                      <input
                        type="radio"
                        name="clear-status"
                        value={s}
                        checked={status === s}
                        onChange={() => setStatus(s)}
                      />
                      {LOAD_STATUS_LABEL[s]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {lines.length > 0 ? (
                <ul
                  className="list-disc space-y-1 pl-5 text-[13px] leading-[1.5] text-text"
                  data-clear-lines
                >
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-text-mutedOnOverlay">
                  {choices.length === 0
                    ? 'This truck has no open load any more.'
                    : 'Choose a load to see what closing it does.'}
                </p>
              )}
            </>
          )}

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
          <span className="text-small text-text-mutedOnOverlay">
            Enter confirms · Esc back
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              data-clear-back
              onClick={onBack}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
            >
              Back
            </button>
            <button
              type="button"
              data-initial-focus
              aria-disabled={!choice || busy || !ready}
              onClick={() => void confirm()}
              className="h-10 border border-status-late-bd bg-status-late-bg px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-status-late-fg aria-disabled:opacity-45"
            >
              {busy ? 'Closing…' : 'Close load'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
