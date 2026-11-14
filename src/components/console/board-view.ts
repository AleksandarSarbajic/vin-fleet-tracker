import type { MoveKind } from './board-move';
import { hostsIn, type Host } from './board-move';

/**
 * §12.159, phase 3bt: the board's view stays where it was on a person's pin or density.
 *
 * Before (3bs, found wrong 2): scrollTop stayed, so in the middle of a long list a density change
 * showed another part of the list, and a pin pushed the rows in view down by what the block grew.
 * Now the truck at the top of the view is kept there:
 *
 * - **Density:** the truck at the top of the view before the change is at the top after it. If it
 *   was partly under the column header, it is partly under it by the same share of its new height.
 * - **Pin and unpin:** the top truck in view other than the one pinned or unpinned stays where it
 *   was drawn on screen, so every truck in view on its side of that one stays too. The truck pinned
 *   or unpinned may leave the view.
 * - **At the top of the list** (scrollTop 0) nothing is held: the list grows or shrinks below the
 *   view's top, as before. **At its end** the browser clamps what is asked for.
 * - **Nothing drawn** (the phone, or the narrow board on its map): nothing is held.
 *
 * It holds whatever the motion does: with the tokens at 0, under reduced motion and with the
 * glides on. It moves no row, only the scroller's scrollTop, once, in the commit the change lands
 * in; the glides then take each row from where it was drawn to where it is now.
 *
 * Places are where rows rest, from layout (`offsetTop` and the virtualizer's own starts), never
 * from where they are drawn: a row mid-glide is somewhere else for a few frames, and the view is
 * held to where the rows are going.
 */

export type ViewAnchor = {
  /** The truck kept in place. */
  id: string;
  /** Its top as it rested, in the view: from the scroller's top edge, the header included. */
  top: number;
  /** Its height then. */
  height: number;
};

/** The column header: sticky at the top of the scroller, over the rows. */
const headerOf = (scroller: HTMLElement) =>
  scroller.querySelector<HTMLElement>(':scope > [role="row"]')?.offsetHeight ?? 0;

/** A list row's start, from its wrapper's `translateY` (the virtualizer's own place for it). */
const startIn = (el: HTMLElement) => {
  const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
  return m ? Number(m[1]) : 0;
};

/** Where a host rests in the scroller's content. */
const contentTop = (host: Host, body: HTMLElement) =>
  host.inList ? body.offsetTop + startIn(host.el) : host.el.offsetTop;

/**
 * The truck at the top of the view, as it rests now. `skip` is the truck pinned or unpinned.
 * Null at the top of the list, with nothing drawn, or with no truck in view.
 */
export function viewAnchor(
  scroller: HTMLElement,
  box: HTMLElement,
  body: HTMLElement,
  skip: string | null,
): ViewAnchor | null {
  if (scroller.scrollTop <= 0 || scroller.clientHeight === 0) return null;
  const head = headerOf(scroller);
  let best: ViewAnchor | null = null;
  for (const host of hostsIn(box, body)) {
    if (host.id === skip) continue;
    const top = contentTop(host, body) - scroller.scrollTop;
    const height = host.el.offsetHeight;
    // In view below the header, by more than a hair.
    if (top + height <= head + 0.5 || top >= scroller.clientHeight) continue;
    if (best === null || top < best.top) best = { id: host.id, top, height };
  }
  return best;
}

/**
 * In the commit the change landed in: scrollTop set so that the anchor rests where it should.
 * `startOf` is the virtualizer's start for a list row by id (it need not be drawn), and
 * `rowHeight` a list row's height now.
 */
export function holdView(
  scroller: HTMLElement,
  box: HTMLElement,
  body: HTMLElement,
  kind: MoveKind,
  anchor: ViewAnchor,
  startOf: (id: string) => number | null,
  rowHeight: number,
): void {
  const head = headerOf(scroller);
  const pinned = [...box.querySelectorAll<HTMLElement>('[data-pinned-host]')].find(
    (el) => el.firstElementChild?.getAttribute('data-row-id') === anchor.id,
  );
  let top: number;
  let height: number;
  if (pinned) {
    top = pinned.offsetTop;
    height = pinned.offsetHeight;
  } else {
    const start = startOf(anchor.id);
    if (start === null) return;
    top = body.offsetTop + start;
    height = rowHeight;
  }
  // Density: partly under the header by the same share of its new height. Otherwise where it was.
  const want =
    kind === 'density' && anchor.top < head && anchor.height > 0
      ? head + ((anchor.top - head) * height) / anchor.height
      : anchor.top;
  const target = top - want;
  if (Math.abs(target - scroller.scrollTop) >= 0.5) scroller.scrollTop = target;
}
