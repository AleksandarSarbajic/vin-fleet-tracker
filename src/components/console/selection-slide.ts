import { EASING, MOTION_MS } from '@/design/tokens';
import { mayMove, play, settleLook, whenOver } from '@/lib/motion';

/**
 * §12.149. The selected row's ground slides from the row it was on to the row it is on,
 * under the words of the rows it passes.
 *
 * An overlay carries the look across, positioned in the scroller's own content so a
 * scroll carries it along, and the rows above and below are the same place to it: a row in
 * the list and a pinned row above it. The row it is going to has its real look all along,
 * held back by `data-selection-target` (`globals.css`) so the overlay can arrive; the
 * row it left has its look off at once rather than over its own 120ms, or the ground would
 * be seen twice. When it lands the overlay goes and the attribute with it.
 *
 * The old row off screen: it just appears. A highlight coming from nowhere says nothing.
 */
export const SELECTION_SLIDE = 'data-selection-slide';
export const SELECTION_TARGET = 'data-selection-target';

const sliding = new WeakMap<HTMLElement, { overlay: HTMLElement; land: () => void }>();

const rowIn = (box: HTMLElement, id: string) =>
  box.querySelector<HTMLElement>(`[data-row-id="${id}"]`);

/** A listed row is measured by its wrapper: its own box is scaled while it lets go of a press. */
const anchorOf = (row: HTMLElement) =>
  row.parentElement?.style.transform ? row.parentElement : row;

const contentTop = (box: HTMLElement, el: Element) =>
  el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;

function inView(box: HTMLElement, el: Element): boolean {
  const view = box.getBoundingClientRect();
  const seen = el.getBoundingClientRect();
  return seen.bottom > view.top && seen.top < view.bottom;
}

/** Ends a slide in flight, with the look on the row it was going to. */
export function landSelection(box: HTMLElement): void {
  sliding.get(box)?.land();
}

export function slideSelection(box: HTMLElement, fromId: string, toId: string): void {
  const inFlight = sliding.get(box);
  const drawn = inFlight ? contentTop(box, inFlight.overlay) : null;
  inFlight?.land();
  const from = rowIn(box, fromId);
  const to = rowIn(box, toId);
  if (!to || !mayMove(box)) return;
  if (drawn === null && (!from || !inView(box, from))) return;

  const anchor = anchorOf(to);
  const end = contentTop(box, anchor);
  const start = drawn ?? contentTop(box, anchorOf(from!));

  const overlay = document.createElement('div');
  overlay.setAttribute(SELECTION_SLIDE, '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.className = 'absolute left-0 w-full border-l-[3px] border-l-accent bg-row-selected';
  Object.assign(overlay.style, { top: `${end}px`, height: `${anchor.offsetHeight}px` });
  box.prepend(overlay);
  to.setAttribute(SELECTION_TARGET, '');
  if (from) settleLook(from);
  settleLook(to);

  const land = () => {
    if (sliding.get(box)?.overlay !== overlay) return;
    sliding.delete(box);
    overlay.remove();
    to.removeAttribute(SELECTION_TARGET);
    settleLook(to);
  };
  sliding.set(box, { overlay, land });
  const animation = play(
    overlay,
    [{ transform: `translateY(${start - end}px)` }, { transform: 'none' }],
    { duration: MOTION_MS.selectionSlide, easing: EASING.dialog },
  );
  if (animation) whenOver(animation, land);
  else land();
}
