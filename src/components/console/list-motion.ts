import { makeInert } from '@/components/overlay/dialog-motion';
import { slideFrom } from '@/lib/appear-motion';
import { clearStyle, mayMove, whenOver } from '@/lib/motion';

/**
 * §12.156. What a short list does when a person adds to it or takes from it: the saved views in
 * the Fleet menu, and the trucks in the list editor. The shapes are `lib/appear-motion.ts`'s; this
 * is the bookkeeping around them, which both lists share.
 *
 * - **What goes leaves as a copy** (`takeLeaving`, `leave`), taken in the person's own handler,
 *   before React removes the thing. The copy has no identity (`makeInert`), no control (a copied
 *   `button` would be found by anything looking for the real one: phase 3bj's checkbox), is
 *   `inert`, `aria-hidden` and takes no pointer, so a press goes through it. It stands behind the
 *   live list, so whatever slides over its place is what is drawn on top, and what a press lands on.
 * - **What moved because of it slides** from where it was drawn (`glideFrom`), by `translate`.
 * - **The list's own box clips** while either is on its way, never the scroller it stands in, so
 *   nothing can make that scroller grow, and nothing drawn past the box's end is seen there.
 * - **A press on a control's place while it arrives** reaches that control (`restingControl`).
 *
 * The box is the list's own: positioned (`relative`), `isolate`, the offset parent of everything
 * in it, and with no inline style of its own.
 */

/** Marks the copy of what a person took away, for the rule that hides it from everything and for a test. */
export const LEAVING_COPY = 'data-leaving-copy';
/** On what is still on its way into its place: a click on that place reaches its control. */
export const ARRIVING = 'data-arriving';

/**
 * Where an element is drawn in its list's box. Measured against the box and not the screen: a
 * window that recentres as its content changes height (the list editor) moves the whole box, and
 * every item in it would read as having moved.
 */
function placeIn(el: HTMLElement, box: HTMLElement): DOMRect {
  const drawn = el.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  return new DOMRect(
    drawn.left - frame.left,
    drawn.top - frame.top,
    drawn.width,
    drawn.height,
  );
}

/** Where each element is drawn in `box` now, by its key: read before a change lands. */
export function placesOf(
  els: Iterable<HTMLElement>,
  keyOf: (el: HTMLElement) => string | null,
  box: HTMLElement,
): Map<string, DOMRect> {
  const places = new Map<string, DOMRect>();
  for (const el of els) {
    const key = keyOf(el);
    if (key !== null) places.set(key, placeIn(el, box));
  }
  return places;
}

/** A copy taken as it goes, and where in its box it was drawn. */
export type Leaving = {
  copy: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
};

const CONTROLS = 'button, a, input, select, textarea, label';

/** The same look with nothing to press: each control becomes a `span` with its classes and words. */
function withoutControls(copy: HTMLElement): void {
  for (const control of [...copy.querySelectorAll<HTMLElement>(CONTROLS)].reverse()) {
    const span = document.createElement('span');
    span.className = control.className;
    span.append(...control.childNodes);
    control.replaceWith(span);
  }
}

/**
 * Takes the copy of `el` in the handler that is about to remove it, while it still has its place.
 * Null where nothing may move: then it is simply gone, as it always was.
 */
export function takeLeaving(el: HTMLElement, box: HTMLElement): Leaving | null {
  if (!mayMove(box)) return null;
  const copy = makeInert(el);
  withoutControls(copy);
  copy.setAttribute(LEAVING_COPY, '');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('inert', '');
  copy.classList.add('pointer-events-none', 'absolute', '-z-10', 'm-0');
  // Where it was drawn, about the centre a scale keeps, at the size it has in layout.
  const drawn = el.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  return {
    copy,
    left: drawn.left + (drawn.width - width) / 2 - frame.left - box.clientLeft,
    top: drawn.top + (drawn.height - height) / 2 - frame.top - box.clientTop,
    width,
    height,
  };
}

/** How many motions each list box is clipping for: it lets go after the last. */
const clipping = new WeakMap<HTMLElement, number>();

function clipWhile(box: HTMLElement, animation: Animation): void {
  clipping.set(box, (clipping.get(box) ?? 0) + 1);
  box.style.overflow = 'clip';
  whenOver(animation, () => {
    const left = (clipping.get(box) ?? 1) - 1;
    clipping.set(box, left);
    if (left === 0) clearStyle(box);
  });
}

/**
 * Puts the copy back where it was drawn, behind the list, and lets `out` take it away: a drop or
 * a pop reversed. It goes when that ends, however it ends.
 */
export function leave(
  leaving: Leaving,
  box: HTMLElement,
  out: (copy: HTMLElement) => Animation | null,
): void {
  const { copy } = leaving;
  Object.assign(copy.style, {
    left: `${leaving.left}px`,
    top: `${leaving.top}px`,
    width: `${leaving.width}px`,
    height: `${leaving.height}px`,
  });
  box.prepend(copy);
  const animation = out(copy);
  if (!animation) {
    copy.remove();
    return;
  }
  clipWhile(box, animation);
  whenOver(animation, () => copy.remove());
}

const gliding = new WeakMap<Element, Animation>();

/**
 * Each element whose key was drawn somewhere else before the change slides from there to its
 * place. One that is still sliding from the change before starts again from where it is drawn.
 */
export function glideFrom(
  before: Map<string, DOMRect>,
  els: Iterable<HTMLElement>,
  keyOf: (el: HTMLElement) => string | null,
  box: HTMLElement,
  ms: number,
): void {
  for (const el of els) {
    const key = keyOf(el);
    const was = key === null ? undefined : before.get(key);
    if (!was) continue;
    gliding.get(el)?.cancel();
    const now = placeIn(el, box);
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const animation = slideFrom(el, dx, dy, ms);
    if (!animation) continue;
    gliding.set(el, animation);
    clipWhile(box, animation);
    whenOver(animation, () => {
      if (gliding.get(el) === animation) gliding.delete(el);
    });
  }
}

/** Marks `el` as on its way while `animation` runs, for `restingControl`. */
export function markArriving(el: HTMLElement, animation: Animation | null): void {
  if (!animation) return;
  el.setAttribute(ARRIVING, '');
  whenOver(animation, () => el.removeAttribute(ARRIVING));
}

/** A control's place in `box`, by layout: where it stands once nothing moves it. */
function restingPlace(control: HTMLElement, box: HTMLElement): DOMRect | null {
  let x = 0;
  let y = 0;
  let at: HTMLElement | null = control;
  while (at && at !== box) {
    x += at.offsetLeft;
    y += at.offsetTop;
    const parent: Element | null = at.offsetParent;
    at = parent instanceof HTMLElement ? parent : null;
  }
  if (at !== box) return null;
  const frame = box.getBoundingClientRect();
  return new DOMRect(
    frame.left + box.clientLeft + x,
    frame.top + box.clientTop + y,
    control.offsetWidth,
    control.offsetHeight,
  );
}

/**
 * The control whose resting place a click came down on, while what holds it is still arriving.
 * A drop draws its controls 14px above their places at first, and a pop from half their size,
 * so a press on a control's place would land on the box behind it: §12.148's rule that a press
 * always lands, as 3bj's checkbox keeps its place (§12.152). Only a click on the box itself or on
 * the arriving thing: a click on a control as drawn is that control's, and a click on something
 * else drawn over the place (a neighbour sliding by) is that thing's.
 */
export function restingControl(box: HTMLElement, event: MouseEvent): HTMLElement | null {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('button')) return null;
  for (const arriving of box.querySelectorAll<HTMLElement>(`[${ARRIVING}]`)) {
    if (target !== box && !arriving.contains(target)) continue;
    for (const control of arriving.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    )) {
      const place = restingPlace(control, box);
      if (
        place &&
        event.clientX >= place.left &&
        event.clientX < place.right &&
        event.clientY >= place.top &&
        event.clientY < place.bottom
      ) {
        return control;
      }
    }
  }
  return null;
}
