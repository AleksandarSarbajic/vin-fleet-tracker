import { EASING, MOTION_MS } from '@/design/tokens';
import { mayMove, play, settleLook, whenOver } from '@/lib/motion';

/**
 * §12.156. The palette's cursor slides from the row it was on to the row it is on, on the arrow
 * keys, as the board's selection does (§12.149, `selection-slide.ts`).
 *
 * An overlay carries the cursor's ground across, in the results list's own content, behind every
 * row (the list is `relative isolate`, the overlay `-z-10`), and takes no pointer, so the rows it
 * passes keep their words on top and a press on any of them lands on it. No row moves. The row it
 * is going to has its real ground all along, held back by `data-cursor-target` (`globals.css`);
 * the row it left has its ground off at once rather than over its own transition, or the cursor
 * would be seen twice. When it lands the overlay goes and the attribute with it.
 *
 * Measured in layout (`offsetTop`): the rows are the list's own content, and nothing scales them.
 */
export const CURSOR_SLIDE = 'data-cursor-slide';
export const CURSOR_TARGET = 'data-cursor-target';

const sliding = new WeakMap<HTMLElement, { overlay: HTMLElement; land: () => void }>();

/** Where an overlay in flight is drawn now, so a second key takes it up from there. */
function drawnTop(overlay: HTMLElement): number {
  return (
    overlay.offsetTop + new DOMMatrixReadOnly(getComputedStyle(overlay).transform).m42
  );
}

/** Ends a slide in flight, with the ground on the row it was going to. */
export function landCursor(list: HTMLElement): void {
  sliding.get(list)?.land();
}

export function slideCursor(list: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  const inFlight = sliding.get(list);
  const drawn = inFlight ? drawnTop(inFlight.overlay) : null;
  inFlight?.land();
  if (MOTION_MS.palCursorSlide <= 0 || !mayMove(list)) return;

  const end = to.offsetTop;
  const start = drawn ?? from.offsetTop;
  const overlay = document.createElement('span');
  overlay.setAttribute(CURSOR_SLIDE, '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.className = 'pointer-events-none absolute left-0 -z-10 w-full bg-row-selected';
  Object.assign(overlay.style, { top: `${end}px`, height: `${to.offsetHeight}px` });
  list.prepend(overlay);
  to.setAttribute(CURSOR_TARGET, '');
  settleLook(from);
  settleLook(to);

  const land = () => {
    if (sliding.get(list)?.overlay !== overlay) return;
    sliding.delete(list);
    overlay.remove();
    to.removeAttribute(CURSOR_TARGET);
    settleLook(to);
  };
  sliding.set(list, { overlay, land });
  const animation = play(
    overlay,
    [{ transform: `translateY(${start - end}px)` }, { transform: 'none' }],
    { duration: MOTION_MS.palCursorSlide, easing: EASING.dialog },
  );
  if (animation) whenOver(animation, land);
  else land();
}
