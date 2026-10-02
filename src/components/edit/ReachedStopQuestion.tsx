'use client';

import { useEffect } from 'react';
import { loadName } from '@/lib/clear-stop';
import { reachedPrompt, type ReachedAnswer } from '@/lib/reached-stop';
import { useFocusTrap } from './useModalChrome';

/**
 * The overwritten-trips fix: a REACHED stop saved with a new city or load
 * number asks whether that is a correction or the next trip, every time.
 *
 * Never answered for the dispatcher, the same way §12.92's question is not:
 * nothing is preselected, and focus starts on "Back to the form", so an Enter
 * carried over from the Save keystroke goes back instead of closing a load.
 * Either answer saves — one request, with the answer in it.
 */
export function ReachedStopQuestion({
  arrivedAt,
  loadNumber,
  dispatchTz,
  now,
  onAnswer,
  onBack,
}: {
  /** The arrival being asked about — the server's, when it raised the question. */
  arrivedAt: string;
  loadNumber: string | null;
  dispatchTz: string;
  now: Date;
  onAnswer: (answer: ReachedAnswer) => void;
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

  const named = loadName(loadNumber);
  const closing = `${named.charAt(0).toUpperCase()}${named.slice(1)}`;

  const options: { answer: ReachedAnswer; label: string; says: string }[] = [
    { answer: 'correction', label: 'Correction', says: 'Saves the changes on this stop, as typed.' },
    {
      answer: 'next-trip',
      label: 'Next trip',
      says: `${closing} closes as Delivered, with its arrival kept. The form is saved as a new load.`,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Stop already reached"
    >
      <div
        ref={trap}
        className="max-h-full w-[560px] max-w-full overflow-auto border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            Before this is saved
          </h2>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-body font-medium text-text">
            {reachedPrompt(arrivedAt, dispatchTz, now)}
          </p>
          {options.map((option) => (
            <div key={option.answer} className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onAnswer(option.answer)}
                className="h-9 w-[112px] shrink-0 border border-status-late-bd px-3 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg"
              >
                {option.label}
              </button>
              <p className="pt-2 text-small text-text-mutedOnOverlay">{option.says}</p>
            </div>
          ))}
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
