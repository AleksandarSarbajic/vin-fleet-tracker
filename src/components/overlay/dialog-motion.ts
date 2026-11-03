import type { CSSProperties } from 'react';
import { MOTION_MS } from '@/design/tokens';

/**
 * §12.148, the timing rules behind `DialogFrame`.
 *
 * Two rules need to know about MORE than one frame, which is why they live in
 * a module and not in the component:
 *
 * 1. **An opening plays once.** A frame that mounts in the same commit that
 *    another unmounted is a replacement — the reading panel giving way to the
 *    editor, the editor's remount after a save lands (§12.127), the console's
 *    remount on Reload. It continues the opening it replaced rather than
 *    starting its own, so the dialog never appears twice.
 * 2. **Closing never waits, and leaves one background.** A frame that closes
 *    is gone in that commit: focus, keys and clicks are back at once. In the
 *    microtask after the commit, if nothing replaced it, an EMPTY copy of its
 *    scrim fades out over `dialogOut` — no words, no controls, nothing a
 *    click, a screen reader or a test can find. Any frame that opens removes
 *    it at once, so there are never two backgrounds.
 *
 * "The same commit" is the microtask boundary. React runs a deletion's layout
 * cleanup and a placement's layout effect in one synchronous commit, and a
 * microtask queued from the first runs only after the commit is over.
 */

/** Marks the fading copy of a closed dialog's background. */
export const FADING_BACKGROUND = 'data-dialog-fading';

/** Written whole, so Tailwind's content scan generates them. */
const SCRIM_IN = 'animate-scrim-in';
const FADING = 'pointer-events-none animate-scrim-out';

/**
 * Read at the moment it matters, not through `useReducedMotion`: that hook
 * learns the preference in a passive effect, after a frame's layout effect
 * has already decided whether to animate.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

type Closed = { owner: object; scrim: HTMLElement | null; openedAt: number };

/** Frames removed in the commit now running; emptied when it is over. */
let closed: Closed[] = [];
let flushQueued = false;

/**
 * A frame has mounted. Returns when its opening began: `now` for a fresh
 * opening, or the opening of a frame removed in this same commit, which this
 * one continues. Removes any fading background either way.
 *
 * `owner` is the frame's own identity. Under StrictMode React unmounts and
 * remounts every new frame's effects at once, and a frame must not take its
 * own simulated unmount for a dialog that closed.
 */
export function frameMounted(owner: object, now: number): number {
  clearFadingBackgrounds();
  const own = closed.find((c) => c.owner === owner);
  const others = closed.filter((c) => c.owner !== owner);
  closed = [];
  if (own) return own.openedAt;
  if (others.length === 0) return now;
  // The oldest: when frames close together, the replacement continues the
  // opening that has run longest, so it can only ever play less, not again.
  return Math.min(...others.map((c) => c.openedAt));
}

/** A frame has unmounted. Its background fades after the commit, unless replaced. */
export function frameUnmounted(owner: object, scrim: HTMLElement | null, openedAt: number): void {
  closed.push({ owner, scrim, openedAt });
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    const last = closed[closed.length - 1];
    closed = [];
    if (last?.scrim && !prefersReducedMotion()) fadeBackground(last.scrim);
  });
}

/** Removes every fading background now. */
export function clearFadingBackgrounds(): void {
  document.querySelectorAll(`[${FADING_BACKGROUND}]`).forEach((node) => node.remove());
}

/** The style that takes an opening up `elapsed` ms in; none at its start. */
export function resumeAt(elapsed: number): CSSProperties | undefined {
  return elapsed > 0 ? { animationDelay: `${-elapsed}ms` } : undefined;
}

/**
 * An empty layer with the scrim's own classes — the same z-index and the same
 * ground — fading out. Built rather than cloned: a clone would carry the
 * scrim's role, label and data attributes, which is exactly what must not be
 * found twice.
 */
function fadeBackground(scrim: HTMLElement): void {
  const layer = document.createElement('div');
  const own = scrim.className.split(/\s+/).filter((c) => c !== '' && c !== SCRIM_IN);
  layer.className = `${own.join(' ')} ${FADING}`;
  layer.setAttribute(FADING_BACKGROUND, '');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('inert', '');
  const remove = () => layer.remove();
  layer.addEventListener('animationend', remove, { once: true });
  // A tab in the background may hold the event back; the layer still goes.
  window.setTimeout(remove, MOTION_MS.dialogOut * 2);
  document.body.append(layer);
}
