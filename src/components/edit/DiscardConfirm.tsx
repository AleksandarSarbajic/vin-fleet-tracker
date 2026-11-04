'use client';

import { useEffect } from 'react';
import { useFocusTrap } from './useModalChrome';
import { DialogFrame } from '@/components/overlay/DialogFrame';

/**
 * §9.9 — "Discard changes?", over the edit modal.
 *
 * While it is open the keyboard is its, the way it is ClearStopConfirm's and
 * ReopenConfirm's: focus starts on Keep editing, so the Enter that comes next
 * loses nothing; Tab stays inside; Esc is Keep editing and never closes the
 * modal; and focus goes back to where it was in the form.
 *
 * It takes one thing further than they do, because the question here is whether
 * to throw the dispatcher's work away. **No key but its own gets past it.** The
 * board's shortcuts only ask whether the caret is in a field (`isTypingTarget`),
 * and focus on a button is not: `D`, `1`, `/`, `G H` would otherwise work the
 * board behind this, and `G H` would leave the page with the question unanswered.
 * Propagation only, so Cmd+C and the browser's own keys still work, and Enter and
 * Space still reach the focused button as its default action.
 */
export function DiscardConfirm({
  unsaved,
  onKeep,
  onDiscard,
}: {
  unsaved: readonly string[];
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const trap = useFocusTrap(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onKeep();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        // Saves in the form. Here a browser would click the focused button.
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onKeep]);

  return (
    <DialogFrame
      className="fixed inset-0 z-[60] grid place-items-center bg-scrim p-6"
      panelClassName="w-[420px] border border-line-hair bg-surface-overlay p-4 shadow-modal"
      panelRef={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Discard changes?"
    >
      <h3 className="font-cond text-[15px] font-semibold uppercase tracking-[.06em] text-text">
        Discard changes?
      </h3>
      <p className="mt-1.5 text-body text-text-secondary">{unsaved.join(', ')} would be lost.</p>
      <div className="mt-4 flex justify-end gap-2.5">
        <button
          type="button"
          data-initial-focus
          onClick={onKeep}
          className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
        >
          Keep editing
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="h-10 border border-status-late-bd bg-status-late-bg px-4 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg"
        >
          Discard
        </button>
      </div>
    </DialogFrame>
  );
}
