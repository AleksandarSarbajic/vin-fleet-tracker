'use client';

import { useEffect } from 'react';
import type { StatusToast } from '@/lib/toast';

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
      className="pointer-events-none fixed bottom-4 left-4 z-40 flex flex-col-reverse gap-2"
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
  useEffect(() => {
    const timer = window.setTimeout(() => onExpire(id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [id, onExpire]);

  return (
    <div
      data-toast={toast.status}
      className={`pointer-events-auto flex w-[340px] items-center justify-between gap-3 border border-l-[3px] border-line-hair border-l-status-late-fg bg-surface-overlay py-2 pl-3 pr-2.5 ${
        reducedMotion ? '' : 'motion-safe:animate-none'
      }`}
    >
      <span className="text-body font-medium text-text">
        Truck {toast.truckLabel} is now late
      </span>
      <button
        type="button"
        onClick={() => {
          onOpen(toast.truckId);
          onExpire(id);
        }}
        className="shrink-0 font-cond text-micro uppercase tracking-[.08em] text-accent hover:text-accent-hover"
      >
        Open
      </button>
    </div>
  );
}
