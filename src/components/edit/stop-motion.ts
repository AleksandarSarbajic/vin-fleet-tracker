import { makeInert } from '@/components/overlay/dialog-motion';
import { ARRIVING, LEAVING_COPY } from '@/components/console/list-motion';
import { dropIn, fadeIn, fadeOut, slideFrom } from '@/lib/appear-motion';
import { EASING, MOTION_MS, MOTION_SHAPE } from '@/design/tokens';
import { clearStyle, mayMove, play, settleLook, whenOver } from '@/lib/motion';
import { layUnder } from '@/lib/under-layer';
import type { AppointmentDraft } from './AppointmentFields';

/**
 * §12.157. The edit window's medium motions: a stop added, a stop removed, a stop chosen, and a
 * fill from a rate confirmation. The shapes are `lib/appear-motion.ts`'s; this is what places
 * them, in the stop list's own box and in the form.
 *
 * **The box** is `[data-stop-tabs]`, around the tablist and Add stop, inside the list's row
 * scroller below 1008px and in its sticky column at 1008px and up: positioned, `isolate`, with no
 * inline style of its own. The tablist inside it is positioned too and stands above Add stop, so a
 * tab is drawn over Add stop when one slides by the other. Everything is measured in layout,
 * against the box (`offsetLeft`, `offsetTop`), never on the screen: a tab just pressed is at
 * 99.5% and a hovered button is lifted 1px, and the row of tabs scrolls. So the same code is the
 * column at 1008px and up and the row below it, where every path runs sideways.
 */

/** The box the stops' tabs and Add stop stand in. */
export const STOP_TABS = 'data-stop-tabs';
/** Marks the chosen stop's highlight on its way, for the rule that draws it and for a test. */
export const STOP_SLIDE = 'data-stop-slide';
/** On the tab the highlight is going to: its own look is held back until it lands (`globals.css`). */
export const STOP_TARGET = 'data-stop-target';

type Place = { x: number; y: number };

/** Where an element stands in `box` by layout: its offsets, summed up to the box. */
function placeIn(el: HTMLElement, box: HTMLElement): Place | null {
  let x = 0;
  let y = 0;
  let at: HTMLElement | null = el;
  while (at && at !== box) {
    x += at.offsetLeft;
    y += at.offsetTop;
    const parent: Element | null = at.offsetParent;
    at = parent instanceof HTMLElement ? parent : null;
  }
  return at === box ? { x, y } : null;
}

/** How far a `translate` in flight has it from its place: a slide or a drop not yet over. */
function moved(el: HTMLElement): Place {
  const parts = getComputedStyle(el).translate.split(' ').map((p) => parseFloat(p));
  return { x: Number.isFinite(parts[0]) ? parts[0]! : 0, y: Number.isFinite(parts[1]) ? parts[1]! : 0 };
}

const tabsIn = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('[role="tab"]')];
const addIn = (box: HTMLElement) => box.querySelector<HTMLElement>('[data-add-stop]');
const ADD = 'add';
const keyOf = (el: HTMLElement) => (el.hasAttribute('data-add-stop') ? ADD : el.id || null);

/** Where each tab and Add stop is drawn now, in the box, by its key: read before a change lands. */
function placesOf(box: HTMLElement): Map<string, Place> {
  const places = new Map<string, Place>();
  for (const el of [...tabsIn(box), addIn(box)]) {
    if (!el) continue;
    const key = keyOf(el);
    const at = placeIn(el, box);
    if (key === null || !at) continue;
    const off = moved(el);
    places.set(key, { x: at.x + off.x, y: at.y + off.y });
  }
  return places;
}

/** What a person did to the stops, taken in their handler and spent by the commit it causes. */
export type StopCause =
  | { kind: 'add'; box: HTMLElement; before: Map<string, Place> }
  | { kind: 'remove'; box: HTMLElement; gone: string; before: Map<string, Place>; copy: Copy | null }
  | { kind: 'choose'; box: HTMLElement };

/** A copy of a tab a person removed, and where in the box it stood. */
type Copy = { el: HTMLElement; x: number; y: number; width: number; height: number };

/** In Add stop's own handler, before the stop lands. Null where nothing may move. */
export function beforeAdd(box: HTMLElement): StopCause | null {
  if (MOTION_MS.stopAddDrop <= 0 || !mayMove(box)) return null;
  return { kind: 'add', box, before: placesOf(box) };
}

/**
 * In Remove stop's own handler, before React takes the tab away: where everything stands, and a
 * copy of the tab nothing can use. No identity (`makeInert`), and not a `button` but a `span` with
 * its classes and words, since a copied tab is found by anything looking for the real one
 * (§12.152 rule 4); `inert`, `aria-hidden`, no pointer, behind the tabs.
 */
export function beforeRemove(box: HTMLElement, tab: HTMLElement): StopCause | null {
  if (MOTION_MS.stopRemoveSlide <= 0 || !mayMove(box)) return null;
  const at = placeIn(tab, box);
  let copy: Copy | null = null;
  if (at) {
    const inert = makeInert(tab);
    const el = document.createElement('span');
    el.className = inert.className;
    el.append(...inert.childNodes);
    el.setAttribute(LEAVING_COPY, '');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('inert', '');
    el.classList.add('pointer-events-none', 'm-0');
    copy = { el, x: at.x, y: at.y, width: tab.offsetWidth, height: tab.offsetHeight };
  }
  return { kind: 'remove', box, gone: tab.id, before: placesOf(box), copy };
}

/** In a tab's own click or arrow key: the highlight may slide when the choice lands. */
export function beforeChoose(box: HTMLElement): StopCause | null {
  if (MOTION_MS.stopChooseDrop <= 0 || !mayMove(box)) return null;
  return { kind: 'choose', box };
}

/** How many motions each box is clipping for: it lets go after the last. */
const clipping = new WeakMap<HTMLElement, number>();

/**
 * The box clips while anything comes into it from below or from the right: a tab or Add stop
 * starting from where it stood before a removal would otherwise reach past the box's new end and
 * grow the row's scroller, or the window's. Never the scroller itself.
 */
function clipWhile(box: HTMLElement, animation: Animation): void {
  clipping.set(box, (clipping.get(box) ?? 0) + 1);
  box.style.overflow = 'clip';
  whenOver(animation, () => {
    const left = (clipping.get(box) ?? 1) - 1;
    clipping.set(box, left);
    if (left === 0) clearStyle(box);
  });
}

const arriving = new WeakMap<HTMLElement, Animation>();

/** Marks `el` as on its way while `animation` runs, for `restingButton`; a newer one takes over. */
function markArriving(el: HTMLElement, animation: Animation | null): void {
  if (!animation) return;
  arriving.set(el, animation);
  el.setAttribute(ARRIVING, '');
  whenOver(animation, () => {
    if (arriving.get(el) !== animation) return;
    arriving.delete(el);
    el.removeAttribute(ARRIVING);
  });
}

const sliding = new WeakMap<HTMLElement, Animation>();

/**
 * Each tab, and Add stop, that stands somewhere else than it was drawn before the change slides
 * from there to its place, by `translate`: down or up in the column, across in the row. One still
 * sliding from the change before starts again from where it is drawn.
 */
function slideMoved(box: HTMLElement, before: Map<string, Place>, ms: number, clip: boolean): void {
  for (const el of [...tabsIn(box), addIn(box)]) {
    if (!el) continue;
    const key = keyOf(el);
    const was = key === null ? undefined : before.get(key);
    const now = placeIn(el, box);
    if (!was || !now) continue;
    const dx = was.x - now.x;
    const dy = was.y - now.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    sliding.get(el)?.cancel();
    const animation = slideFrom(el, dx, dy, ms);
    if (!animation) continue;
    sliding.set(el, animation);
    markArriving(el, animation);
    if (clip) clipWhile(box, animation);
  }
}

/** The commit an added stop lands in: its tab drops, and what it pushed along slides. */
export function stopAdded(cause: Extract<StopCause, { kind: 'add' }>, tab: HTMLElement): void {
  const ms = MOTION_MS.stopAddDrop;
  markArriving(tab, dropIn(tab, ms, MOTION_SHAPE.stopAddDropPx));
  slideMoved(cause.box, cause.before, ms, false);
}

/** The commit a removed stop is gone in: its copy fades where it stood, and the rest slide in. */
export function stopRemoved(cause: Extract<StopCause, { kind: 'remove' }>): void {
  const ms = MOTION_MS.stopRemoveSlide;
  const { box, copy } = cause;
  if (copy) {
    Object.assign(copy.el.style, {
      left: `${copy.x}px`,
      top: `${copy.y}px`,
      width: `${copy.width}px`,
      height: `${copy.height}px`,
    });
    // §12.165: behind the tabs, inside the box's own stacking context, or not at all.
    if (layUnder(box, copy.el)) {
      const animation = fadeOut(copy.el, ms);
      if (animation) {
        clipWhile(box, animation);
        whenOver(animation, () => copy.el.remove());
      } else copy.el.remove();
    }
  }
  slideMoved(box, cause.before, ms, true);
}

const choosing = new WeakMap<HTMLElement, { overlay: HTMLElement; land: () => void }>();

/** Where a highlight in flight is drawn now, so a second choice takes it up from there. */
function drawnAt(overlay: HTMLElement): Place {
  const m = new DOMMatrixReadOnly(getComputedStyle(overlay).transform);
  return { x: overlay.offsetLeft + m.m41, y: overlay.offsetTop + m.m42 };
}

/**
 * The commit a chosen stop lands in: the highlight slides from the tab it was on to this one, as
 * the board's selection does (§12.149). An overlay inside the tablist (`relative isolate`) carries
 * the chosen look behind every tab, and takes no pointer, so the tabs it passes keep their words on
 * top and a press on any of them lands on it. No tab moves. The tab it goes to has its look all
 * along, held back by `data-stop-target` until it lands; the tab it left has its look off at once
 * rather than over its own transition, or the highlight would be seen twice. `translate` only, at
 * the chosen tab's size: in the row a longer place name makes a wider tab, and nothing animates a
 * width (§12.152 rule 1).
 */
export function stopChosen(tablist: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  const inFlight = choosing.get(tablist);
  const start = inFlight ? drawnAt(inFlight.overlay) : { x: from.offsetLeft, y: from.offsetTop };
  inFlight?.land();
  if (MOTION_MS.stopChooseDrop <= 0 || !mayMove(tablist)) return;

  const end = { x: to.offsetLeft, y: to.offsetTop };
  const overlay = document.createElement('span');
  overlay.setAttribute(STOP_SLIDE, '');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.className = 'pointer-events-none border border-accent bg-accent-veil';
  Object.assign(overlay.style, {
    left: `${end.x}px`,
    top: `${end.y}px`,
    width: `${to.offsetWidth}px`,
    height: `${to.offsetHeight}px`,
  });
  // §12.165: behind every tab, inside the tablist's own stacking context, or not at all.
  if (!layUnder(tablist, overlay)) return;
  to.setAttribute(STOP_TARGET, '');
  settleLook(from);
  settleLook(to);

  const land = () => {
    if (choosing.get(tablist)?.overlay !== overlay) return;
    choosing.delete(tablist);
    overlay.remove();
    to.removeAttribute(STOP_TARGET);
    settleLook(to);
  };
  choosing.set(tablist, { overlay, land });
  const animation = play(
    overlay,
    [{ transform: `translate(${start.x - end.x}px, ${start.y - end.y}px)` }, { transform: 'none' }],
    { duration: MOTION_MS.stopChooseDrop, easing: EASING.dialog },
  );
  if (animation) whenOver(animation, land);
  else land();
}

/** Ends a highlight in flight, with the look on the tab it was going to. */
export function landChosen(tablist: HTMLElement): void {
  choosing.get(tablist)?.land();
}

/** The chosen stop's form, remounted by its key, drops in: from above, where nothing can grow. */
export function formChosen(form: HTMLElement): void {
  dropIn(form, MOTION_MS.stopChooseDrop, MOTION_SHAPE.stopChooseDropPx);
}

/**
 * The button whose resting place a click came down on while it is still on its way: a click on
 * the box itself, where nothing is drawn yet, goes to Add stop or a tab sliding into that place, as
 * 3bo's arriving controls do (§12.156 rule 10). A click on anything drawn is that thing's.
 */
export function restingButton(box: HTMLElement, event: MouseEvent): HTMLButtonElement | null {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('button')) return null;
  const frame = box.getBoundingClientRect();
  for (const button of box.querySelectorAll<HTMLButtonElement>(`button[${ARRIVING}]:not(:disabled)`)) {
    const at = placeIn(button, box);
    if (!at) continue;
    const left = frame.left + box.clientLeft + at.x;
    const top = frame.top + box.clientTop + at.y;
    if (
      event.clientX >= left &&
      event.clientX < left + button.offsetWidth &&
      event.clientY >= top &&
      event.clientY < top + button.offsetHeight
    ) {
      return button;
    }
  }
  return null;
}

/**
 * A fill's fields, by the name each control carries (`data-fill`). The appointment is several
 * controls, each its own field; its source line is one (`appointment`), and the zone's is
 * "Zone: …" (`zone`).
 */
export const FILL_FIELDS = [
  'loadNumber',
  'stopType',
  'addressLine',
  'zip',
  'city',
  'state',
  'appointment.enabled',
  'appointment.type',
  'appointment.date',
  'appointment.time',
  'appointment.endTime',
  'appointment.windowMinutes',
  'tz',
] as const;
export type FillName = (typeof FILL_FIELDS)[number];
export type FillValues = Record<FillName, string>;

/** The source line a field's own drops with. */
export const sourceOf = (name: FillName): string =>
  name.startsWith('appointment.') ? 'appointment' : name === 'tz' ? 'zone' : name;

type DrawnStop = {
  stopType: string;
  addressLine: string;
  zip: string;
  city: string;
  state: string;
  appointment: AppointmentDraft;
};

/** What the window draws in each of a fill's fields: the load number, and the stop on screen. */
export function fillValues(loadNumber: string, stop: DrawnStop | undefined): FillValues {
  const a = stop?.appointment;
  return {
    loadNumber,
    stopType: stop?.stopType ?? '',
    addressLine: stop?.addressLine ?? '',
    zip: stop?.zip ?? '',
    city: stop?.city ?? '',
    state: stop?.state ?? '',
    'appointment.enabled': a ? String(a.enabled) : '',
    'appointment.type': a?.type ?? '',
    'appointment.date': a?.date ?? '',
    'appointment.time': a?.time ?? '',
    'appointment.endTime': a?.endTime ?? '',
    'appointment.windowMinutes': a ? String(a.windowMinutes) : '',
    tz: a?.tz ?? '',
  };
}

/**
 * The commit a fill lands in: each field whose value changed fades in where it stands, with its
 * own start, and its source line drops in under it. A field that did not change does not move,
 * nor does its line. Opacity on the control itself, so it keeps its place, its focus and its caret:
 * nothing is focused, nothing is moved, and a field being typed in is left as it is.
 */
export function filled(root: ParentNode, before: FillValues, after: FillValues): FillName[] {
  const changed = FILL_FIELDS.filter((name) => before[name] !== after[name]);
  const ms = MOTION_MS.loadStripDrop;
  for (const name of changed) {
    root.querySelectorAll(`[data-fill="${name}"]`).forEach((el) => fadeIn(el, ms));
  }
  for (const source of new Set(changed.map(sourceOf))) {
    root
      .querySelectorAll(`[data-fill-source="${source}"]`)
      .forEach((el) => dropIn(el, ms, MOTION_SHAPE.loadStripDropPx));
  }
  return changed;
}
