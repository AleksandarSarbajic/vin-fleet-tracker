import type { CSSProperties } from 'react';
import { MOTION_MS } from '@/design/tokens';
import { prefersReducedMotion } from '@/lib/motion';

export { prefersReducedMotion };

/**
 * §12.148, the timing rules behind `DialogFrame` and `PopFrame`.
 *
 * Two rules need to know about MORE than one frame, which is why they live in
 * a module and not in the component:
 *
 * 1. **An opening plays once.** A frame that mounts in the same commit that
 *    another of its FAMILY unmounted is a replacement: the reading panel giving
 *    way to the editor, the editor's remount after a save lands (§12.127), the
 *    console's remount on Reload. It continues the opening it replaced rather
 *    than starting its own, so the window never appears twice. A different
 *    window is not a replacement: the palette giving way to the edit modal
 *    opens the modal.
 * 2. **Closing never waits.** A frame that closes is gone in that commit:
 *    focus, keys and clicks are back at once. What fades is a COPY of it, taken
 *    as it leaves: every word as it stood, and nothing a click, a screen reader
 *    or a test can use. Any frame that opens removes every copy at once, so
 *    there are never two backgrounds.
 *
 * "The same commit" is the microtask boundary. React runs a deletion's layout
 * cleanup and a placement's layout effect in one synchronous commit, and a
 * microtask queued from the first runs only after the commit is over.
 */

/** Marks the fading copy of a closed window. */
export const FADING_COPY = 'data-dialog-fading';

/** Written whole, so Tailwind's content scan generates them. */
const MOTION_IN = ['animate-scrim-in', 'animate-dialog-in', 'animate-menu-in'];
const FADING: Record<FrameKind, string[]> = {
  window: ['pointer-events-none', 'animate-window-out'],
  menu: ['pointer-events-none', 'animate-menu-out'],
};
const FADE_MS: Record<FrameKind, number> = {
  window: MOTION_MS.dialogOut,
  menu: MOTION_MS.menuOut,
};
/**
 * Above the highest window (z-[60]). A menu's copy stands in `body`, outside
 * whatever stacking context the menu was in, and a dropdown in a window must
 * not fade out behind that window.
 */
const MENU_COPY_LAYER = '70';
/** What would let anything find the copy instead of the real thing. */
const IDENTITY = /^(id|name|for|role|tabindex|autofocus|aria-.*|data-.*)$/;

/** A window fills the screen; a menu hangs from something. */
export type FrameKind = 'window' | 'menu';

type Picture = {
  node: HTMLElement;
  kind: FrameKind;
  scrolls: [Element, number, number][];
};
type Closed = {
  owner: object;
  frame: HTMLElement | null;
  picture: Picture | null;
  openedAt: number;
  family: string | undefined;
};

/** Frames removed in the commit now running; emptied when it is over. */
let closed: Closed[] = [];
let flushQueued = false;

/**
 * A frame has mounted. Returns when its opening began: `now` for a fresh
 * opening, or the opening of a frame of its family removed in this same commit,
 * which this one continues. Removes every fading copy either way.
 *
 * `owner` is the frame's own identity. Under StrictMode React unmounts and
 * remounts every new frame's effects at once, and a frame must not take its
 * own simulated unmount for a window that closed.
 */
export function frameMounted(owner: object, now: number, family?: string): number {
  clearFadingCopies();
  const own = closed.find((c) => c.owner === owner);
  if (own) {
    closed = closed.filter((c) => c !== own);
    return own.openedAt;
  }
  const kin = family === undefined ? [] : closed.filter((c) => c.family === family);
  if (kin.length > 0) {
    // What else closed in this commit, a confirm over the editor, still fades.
    closed = closed.filter((c) => !kin.includes(c));
    // The oldest, so a replacement can only ever play less, not again.
    return Math.min(...kin.map((c) => c.openedAt));
  }
  // A window opening fresh: nothing that closed with it leaves a background.
  closed = [];
  return now;
}

/** A frame has unmounted. Its copy fades after the commit, unless replaced. */
export function frameUnmounted(
  owner: object,
  frame: HTMLElement | null,
  openedAt: number,
  family?: string,
  kind: FrameKind = 'window',
): void {
  // Taken here, while it still has layout: a scroll position does not survive
  // leaving the document.
  const picture = frame && !prefersReducedMotion() ? takePicture(frame, kind) : null;
  closed.push({ owner, frame, picture, openedAt, family });
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    const left = closed;
    closed = [];
    for (const c of left) {
      if (!c.picture) continue;
      // A window drawn inside another closing one is already in that one's copy.
      const inside = left.some((o) => o !== c && o.frame?.contains(c.frame));
      if (!inside) showPicture(c.picture);
    }
  });
}

/** Removes every fading copy now. */
export function clearFadingCopies(): void {
  document.querySelectorAll(`[${FADING_COPY}]`).forEach((node) => node.remove());
}

/** The style that takes an opening up `elapsed` ms in; none at its start. */
export function resumeAt(elapsed: number): CSSProperties | undefined {
  return elapsed > 0 ? { animationDelay: `${-elapsed}ms` } : undefined;
}

/**
 * A deep copy nothing can use. The browser copies a typed value and a checkbox
 * itself; a select's choice and a scroll position it does not. Closed
 * mid-opening, the copy fades from where it stood rather than jumping to full
 * strength first: that is the one thing here that asks for computed style, and
 * only of the elements still moving.
 */
function takePicture(frame: HTMLElement, kind: FrameKind): Picture {
  const node = frame.cloneNode(true) as HTMLElement;
  const from = [frame, ...frame.querySelectorAll<HTMLElement>('*')];
  const to = [node, ...node.querySelectorAll<HTMLElement>('*')];
  const scrolls: Picture['scrolls'] = [];
  from.forEach((el, i) => {
    const copy = to[i]!;
    if (el.tagName === 'SELECT') {
      (copy as HTMLSelectElement).selectedIndex = (el as HTMLSelectElement).selectedIndex;
    }
    if (el.scrollTop || el.scrollLeft) scrolls.push([copy, el.scrollTop, el.scrollLeft]);
    if (MOTION_IN.some((m) => el.classList.contains(m))) {
      const { opacity, transform } = getComputedStyle(el);
      copy.classList.remove(...MOTION_IN);
      copy.style.removeProperty('animation-delay');
      copy.style.opacity = opacity;
      // A menu's copy is placed by the box it was seen in, transform and all.
      if (kind === 'window' && transform !== 'none') copy.style.transform = transform;
    }
    for (const a of [...copy.attributes]) {
      if (IDENTITY.test(a.name)) copy.removeAttribute(a.name);
    }
  });
  if (kind === 'menu') placeWhereItStood(node, frame);
  return { node, kind, scrolls };
}

/**
 * A window's scrim is fixed to the screen, so its copy stands where it stood.
 * A menu is placed against its parent, and its copy will not have that parent:
 * a React parent is no place to leave a stray node. So it is fixed where it was
 * seen, and what its classes meant relative to the parent is taken off.
 */
function placeWhereItStood(copy: HTMLElement, menu: HTMLElement): void {
  const { left, top, width, height } = menu.getBoundingClientRect();
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${width}px`,
    height: `${height}px`,
    minWidth: '0px',
    maxWidth: 'none',
    maxHeight: 'none',
    margin: '0px',
    zIndex: MENU_COPY_LAYER,
  });
}

function showPicture({ node, kind, scrolls }: Picture): void {
  node.classList.add(...FADING[kind]);
  node.setAttribute(FADING_COPY, '');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('inert', '');
  const remove = () => node.remove();
  node.addEventListener('animationend', remove, { once: true });
  // A tab in the background may hold the event back; the copy still goes.
  window.setTimeout(remove, FADE_MS[kind] * 2);
  document.body.append(node);
  for (const [el, top, left] of scrolls) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}
