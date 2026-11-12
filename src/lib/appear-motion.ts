import { EASING } from '@/design/tokens';
import { clearStyle, mayMove, play, settleLook, whenOver } from './motion';

/**
 * §12.152. The small motions: something arriving in the place it already has.
 *
 * Opacity and the transform properties `translate` and `scale`, nothing else, so a motion
 * moves no layout, never grows a scroller, and composes with a transform the element
 * already has: a press, a lift, a copy button's `-translate-y-1/2`. Every one goes through
 * `play`, so reduced motion starts nothing and a press holds it. Nothing is left at rest:
 * no fill past the end, and every node and attribute added here goes when it lands.
 *
 * A duration of 0 is a motion taken back (§12.152, "To take one back"): nothing runs.
 */

const taken = (ms: number) => ms <= 0;

/** Comes down `px` into its place and fades in. From above, where nothing can grow a scroller. */
export function dropIn(el: Element, ms: number, px: number): Animation | null {
  if (taken(ms)) return null;
  return play(
    el,
    [
      { opacity: 0, translate: `0 ${-px}px` },
      { opacity: 1, translate: '0 0' },
    ],
    { duration: ms, easing: EASING.dialog },
  );
}

/** Fades in where it is and goes nowhere: what arrives by itself, with no person behind it. */
export function fadeIn(el: Element, ms: number): Animation | null {
  if (taken(ms)) return null;
  return play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASING.fade });
}

/** Grows into its place from `from` of its size. Smaller, so it never reaches past its box. */
export function popIn(el: Element, ms: number, from: number): Animation | null {
  if (taken(ms)) return null;
  return play(
    el,
    [
      { opacity: 0, scale: String(from) },
      { opacity: 1, scale: '1' },
    ],
    { duration: ms, easing: EASING.dialog },
  );
}

/** How many motions each clipping box is clipping for: it lets go after the last. */
const clipping = new WeakMap<HTMLElement, number>();

/**
 * Comes in from `dx` to one side (negative is the left) inside `box`, which clips sideways
 * while anything is on its way: a step coming from the right would otherwise widen the
 * scroller it stands in. `box` is ours, with no inline style of its own.
 */
export function slideIn(el: Element, box: HTMLElement, ms: number, dx: number): Animation | null {
  if (taken(ms)) return null;
  const animation = play(
    el,
    [
      { opacity: 0, translate: `${dx}px 0` },
      { opacity: 1, translate: '0 0' },
    ],
    { duration: ms, easing: EASING.dialog },
  );
  if (!animation) return null;
  clipping.set(box, (clipping.get(box) ?? 0) + 1);
  box.style.overflowX = 'clip';
  whenOver(animation, () => {
    const left = (clipping.get(box) ?? 1) - 1;
    clipping.set(box, left);
    if (left === 0) clearStyle(box);
  });
  return animation;
}

/** Marks a chip's look on its way, for the rule that draws it and for a test. */
export const GROUND_POP = 'data-ground-pop';
/** On the chip while a look is on its way: its own ground and edge are held back (`globals.css`). */
export const GROUND_HOST = 'data-ground-host';

/**
 * A chosen look arriving or leaving: the accent edge and the overlay ground, growing in from
 * `from` of the chip's size or shrinking away to it. An overlay carries it, as a segment's
 * slide does (`segment-slide.ts`), so the chip itself never moves: its own look lands at
 * once, held back under the overlay by `GROUND_HOST`, and comes back when the overlay goes.
 * A second change while one is on its way starts again from nothing, as the demo does.
 */
export function groundPop(host: HTMLElement, on: boolean, ms: number, from: number): void {
  if (taken(ms) || !mayMove(host)) return;
  host.querySelectorAll(`:scope > [${GROUND_POP}]`).forEach((old) => old.remove());

  const look = document.createElement('span');
  look.setAttribute(GROUND_POP, on ? 'on' : 'off');
  look.setAttribute('aria-hidden', 'true');
  look.className =
    'pointer-events-none absolute -inset-px -z-10 border border-accent bg-surface-overlay';
  host.prepend(look);
  host.setAttribute(GROUND_HOST, '');
  settleLook(host);

  const frames = [
    { opacity: 0, scale: String(from) },
    { opacity: 1, scale: '1' },
  ];
  const land = () => {
    look.remove();
    if (host.querySelector(`:scope > [${GROUND_POP}]`)) return;
    host.removeAttribute(GROUND_HOST);
    settleLook(host);
  };
  const animation = play(look, on ? frames : frames.reverse(), {
    duration: ms,
    easing: EASING.dialog,
  });
  if (animation) whenOver(animation, land);
  else land();
}

/**
 * §12.153. A page's rows in view of `scroller` fade in one just after the other, `ms` in all,
 * each `rowMs`, with gaps of `gapMax` at most: the board opening's shape (§12.149,
 * `board-opening.ts`), on a page's own numbers. Opacity only, so nothing moves and every row is
 * live from its first frame. Rows out of view are simply there when scrolled to.
 */
export function drawIn(
  rows: Element[],
  scroller: Element,
  ms: number,
  rowMs: number,
  gapMax: number,
): Animation[] {
  if (taken(ms)) return [];
  const view = scroller.getBoundingClientRect();
  const seen = rows.filter((row) => {
    const box = row.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
  });
  const gap = seen.length > 1 ? Math.min(gapMax, (ms - rowMs) / (seen.length - 1)) : 0;
  return seen.flatMap((row, i) => {
    const animation = play(row, [{ opacity: 0 }, { opacity: 1 }], {
      duration: rowMs,
      delay: i * gap,
      easing: EASING.fade,
      fill: 'backwards',
    });
    return animation ? [animation] : [];
  });
}

/** When a drop started, so a remount can carry it on rather than play it again. */
export type Started = { at: number };

/**
 * Carries a drop on in a new element from where the last one stood, `started.at` ago: the
 * edit window's remount after a save lands (§12.127) replaces the strip that was arriving.
 * Past its end nothing plays, and the strip is simply there.
 */
export function dropOn(el: Element, ms: number, px: number, started: Started): Animation | null {
  const elapsed = performance.now() - started.at;
  if (elapsed >= ms) return null;
  const animation = dropIn(el, ms, px);
  if (animation) animation.currentTime = Math.max(0, elapsed);
  return animation;
}
