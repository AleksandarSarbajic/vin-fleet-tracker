import { EASING, MOTION_MS } from '@/design/tokens';
import { mayMove, play, settleLook, whenOver } from './motion';

/**
 * §12.149. A segment's highlight slides from what was chosen to what is chosen.
 *
 * An overlay carries the look across. The chosen button has its real look all along,
 * held back by `data-segment-target` (`globals.css`) so the overlay can arrive; when it
 * lands the overlay goes and the attribute with it, so nothing is left on the button.
 * Segments only: a filter chip is multi-select, so it has no one place to slide from.
 *
 * Measured in layout (`offsetLeft`), not with `getBoundingClientRect`. The chosen
 * button has just been pressed, so its box is at 96% and on its way back.
 */

/** Marks the overlay, for the rule that draws it and for a test. */
export const SEGMENT_SLIDE = 'data-segment-slide';
export const SEGMENT_TARGET = 'data-segment-target';

type Box = { x: number; y: number; width: number; height: number };

const boxOf = (el: HTMLElement): Box => ({
  x: el.offsetLeft,
  y: el.offsetTop,
  width: el.offsetWidth,
  height: el.offsetHeight,
});

/** Where an overlay in flight is drawn right now, so a new choice takes it up from there. */
function drawnBox(overlay: HTMLElement): Box {
  const cs = getComputedStyle(overlay);
  const moved = new DOMMatrixReadOnly(cs.transform);
  return {
    x: overlay.offsetLeft + moved.m41,
    y: overlay.offsetTop + moved.m42,
    width: parseFloat(cs.width),
    height: parseFloat(cs.height),
  };
}

const sliding = new WeakMap<HTMLElement, { overlay: HTMLElement; land: () => void }>();

export function slideSegment(host: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  if (!mayMove(host) || to.offsetWidth === 0) return;
  const inFlight = sliding.get(host);
  const start = inFlight ? drawnBox(inFlight.overlay) : boxOf(from);
  inFlight?.land();
  settleLook(from);

  const end = boxOf(to);
  const overlay = document.createElement('span');
  overlay.setAttribute(SEGMENT_SLIDE, '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.className = 'absolute -z-10 border border-accent bg-surface-overlay';
  Object.assign(overlay.style, {
    left: `${end.x}px`,
    top: `${end.y}px`,
    width: `${end.width}px`,
    height: `${end.height}px`,
  });
  host.prepend(overlay);
  to.setAttribute(SEGMENT_TARGET, '');
  settleLook(to);

  const land = () => {
    if (sliding.get(host)?.overlay !== overlay) return;
    sliding.delete(host);
    overlay.remove();
    to.removeAttribute(SEGMENT_TARGET);
    settleLook(to);
  };
  sliding.set(host, { overlay, land });
  const animation = play(
    overlay,
    [
      {
        transform: `translate(${start.x - end.x}px, ${start.y - end.y}px)`,
        width: `${start.width}px`,
        height: `${start.height}px`,
      },
      { transform: 'none', width: `${end.width}px`, height: `${end.height}px` },
    ],
    { duration: MOTION_MS.segmentSlide, easing: EASING.dialog },
  );
  if (animation) whenOver(animation, land);
  else land();
}
