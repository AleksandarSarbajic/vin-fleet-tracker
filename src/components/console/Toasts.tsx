'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StatusToast } from '@/lib/toast';
import { MOTION_MS } from '@/design/tokens';

/**
 * The feedback set's toast stack (§9.11, from `2h`).
 *
 * Bottom-left, 6s, three at most. `surface.overlay` ground, a hairline on
 * three sides and a 3px status-coloured left border. Message in sans 500 12.5
 * `text.DEFAULT`, action word in cond 600 `.08em` `accent`.
 *
 * ONE of the three specified toasts is built (§12.50). The other two are left
 * out deliberately:
 *
 *   - the green `Undo` toast has no undo behind it anywhere in the codebase,
 *     and History is deferred (§13). A toast whose action word does nothing
 *     is §12.35's shape — a surface claiming a capability that is not there.
 *   - the red save-failure toast already has a better home: the modal the
 *     dispatcher is looking at, six inches from the cursor, which renders the
 *     error with `role="alert"` and keeps it until they deal with it.
 *
 * "A toast is an echo, not the notification — the row and the marker have
 * already changed." So it never steals focus: `role="status"` with a polite
 * live region, never `alert`.
 *
 * **§14 feature 14 moved it.** It is no longer bottom-left and no longer
 * fixed to the viewport: §14.5 gave bottom-left to the bulk bar, so the stack
 * anchors to the top-right of the split area — the map's top-right on a wide
 * screen, and the list's on a narrow one where the map is a toggle. Anchoring
 * to the pane rather than the window is what keeps it on screen in both, and
 * what keeps it off the console header.
 *
 * It clears the zoom control rather than sitting beside it. `MapChrome` has
 * held the map's top-right corner since phase 2 and turn 5 was not drawing
 * against it; a 340px toast inset far enough to miss a 28px control reads as
 * misaligned, and moving the zoom control is a change nobody asked for.
 */

export const TOAST_MS = 6_000;
export const TOAST_MAX = 3;

interface Props {
  toasts: StatusToast[];
  onOpen: (truckId: string) => void;
  onExpire: (id: string) => void;
  reducedMotion: boolean;
}

export function Toasts({ toasts, onOpen, onExpire, reducedMotion }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Status changes"
      /*
       * `flex-col`, not `flex-col-reverse`. The list is newest-first and the
       * stack grows DOWNWARD from a top edge now, so the newest belongs at the
       * top; reversed, it would appear at the bottom and push the older ones
       * up, which is the one thing a stack of six-second messages must not do.
       *
       * `top-[76px]` clears the zoom control. See the note above.
       */
      className="pointer-events-none absolute right-4 top-[76px] z-20 flex flex-col gap-2"
    >
      {toasts.slice(0, TOAST_MAX).map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onOpen={onOpen}
          onExpire={onExpire}
          reducedMotion={reducedMotion}
        />
      ))}
    </div>
  );
}

function Toast({
  toast,
  onOpen,
  onExpire,
  reducedMotion,
}: {
  toast: StatusToast;
  onOpen: (truckId: string) => void;
  onExpire: (id: string) => void;
  reducedMotion: boolean;
}) {
  const { id } = toast;
  /**
   * §14.4: "in: 8px rise + fade, 180ms. Out: fade, 120ms."
   *
   * The exit is the half that needs state. A toast removed from the parent's
   * array unmounts on that frame, and an element that is gone cannot fade —
   * so the dwell ends here, in a `leaving` flag, and the parent is only told
   * once the fade has run.
   */
  const [leaving, setLeaving] = useState(false);

  /**
   * Under reduced motion there is no fade to wait for, so it goes straight
   * out. Routing it through `leaving` with a zero-length timer would be a
   * render and a macrotask to express "nothing happens for no time".
   */
  const dismiss = useCallback(() => {
    if (reducedMotion) onExpire(id);
    else setLeaving(true);
  }, [reducedMotion, onExpire, id]);

  useEffect(() => {
    const timer = window.setTimeout(dismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onExpire(id), MOTION_MS.toastOut);
    return () => window.clearTimeout(timer);
  }, [leaving, id, onExpire]);

  return (
    <div
      data-toast={toast.status}
      data-leaving={leaving ? '' : undefined}
      className={`pointer-events-auto flex w-[340px] items-center justify-between gap-3 border border-l-[3px] border-line-hair border-l-status-late-fg bg-surface-overlay py-2 pl-3 pr-2.5 ${
        reducedMotion ? '' : leaving ? 'animate-toast-out' : 'animate-toast-in'
      }`}
    >
      <span className="text-body font-medium text-text">
        Truck {toast.truckLabel} is now late
      </span>
      <button
        type="button"
        onClick={() => {
          onOpen(toast.truckId);
          // Fades like any other dismissal rather than blinking out — the
          // modal it opens takes a moment to arrive, and a toast vanishing in
          // that moment reads as the click having missed.
          dismiss();
        }}
        className="shrink-0 font-cond text-micro uppercase tracking-[.08em] text-accent hover:text-accent-hover"
      >
        Open
      </button>
    </div>
  );
}
