'use client';

import { useEffect } from 'react';
import {
  previousLoadLine,
  savePrompt,
  type OpenLoadChoice,
  type SaveAnswer,
} from '@/lib/clear-stop';
import { useFocusTrap } from './useModalChrome';

/**
 * §12.92 — the save-time question. Saving a NEW load on a truck that still
 * holds a previous load (open, every stop departed) asks about each one
 * first: close it as Delivered, as Cancelled, or keep it open.
 *
 * Never answered for the dispatcher. No answer is preselected, and focus
 * starts on "Back to the form", so an Enter carried over from the Save
 * keystroke goes back rather than closing a load. The last answer given
 * saves — with one previous load, that is one click.
 *
 * The closes ride inside the new load's save (`closePrevious`), closed by
 * Clear stop's own `clearStop` in the same transaction.
 */
const ANSWER_LABEL: Record<SaveAnswer, string> = {
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  keep: 'Keep it open',
};

export function PreviousLoadQuestion({
  loads,
  answers,
  dispatchTz,
  now,
  onAnswer,
  onBack,
}: {
  /** Null while the truck's loads are being read fresh. */
  loads: readonly OpenLoadChoice[] | null;
  answers: Readonly<Record<string, SaveAnswer>>;
  dispatchTz: string;
  now: Date;
  onAnswer: (loadId: string, answer: SaveAnswer) => void;
  onBack: () => void;
}) {
  const trap = useFocusTrap(true);

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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Previous load still open"
    >
      <div
        ref={trap}
        className="max-h-full w-[560px] max-w-full overflow-auto border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            Before the new load is saved
          </h2>
        </div>

        <div className="space-y-4 p-4">
          {loads === null ? (
            <p className="text-body text-text-mutedOnOverlay">
              Reading this truck&apos;s open loads…
            </p>
          ) : (
            loads.map((load) => (
              <div key={load.loadId} data-save-question={load.loadId}>
                <p className="text-body font-medium text-text">{savePrompt(load)}</p>
                <p className="mt-0.5 text-small text-text-mutedOnOverlay">
                  {previousLoadLine(load, dispatchTz, now)}
                </p>
                <div
                  className="mt-2 flex gap-2"
                  role="group"
                  aria-label={savePrompt(load)}
                >
                  {(['DELIVERED', 'CANCELLED', 'keep'] as const).map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      aria-pressed={answers[load.loadId] === answer}
                      onClick={() => onAnswer(load.loadId, answer)}
                      className={`h-9 border px-3 font-cond text-micro uppercase tracking-[.09em] ${
                        answer === 'keep'
                          ? 'border-line-hair text-text-secondary'
                          : 'border-status-late-bd text-status-late-fg'
                      } aria-pressed:bg-surface-raised aria-pressed:outline aria-pressed:outline-1 aria-pressed:outline-accent`}
                    >
                      {ANSWER_LABEL[answer]}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          <p className="text-small text-text-mutedOnOverlay">
            Closing and saving happen together: if either fails, neither does.
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-line-hair bg-surface-raised px-4 py-3">
          <span className="text-small text-text-mutedOnOverlay">Esc back</span>
          <button
            type="button"
            data-initial-focus
            onClick={onBack}
            className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
          >
            Back to the form
          </button>
        </div>
      </div>
    </div>
  );
}
