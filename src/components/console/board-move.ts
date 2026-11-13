import { EASING, MOTION_MS, MOTION_SHAPE } from '@/design/tokens';
import { fadeIn, slideFrom } from '@/lib/appear-motion';
import { clearStyle, mayMove, play, whenOver } from '@/lib/motion';
import { GLIDE_COPY } from './row-glide';

/**
 * §12.159. The board's two large motions: a truck a person pinned or unpinned, and the density
 * a person chose. Each is named by its own cause (`usePinned`'s `moved`, `useDensity`'s
 * `moves`), set in the person's handler; `capture` runs just before the commit that cause
 * lands in, and `run` in it. Nothing here looks at positions on its own, so a poll, a resize,
 * stored pins or a stored density never start one.
 *
 * **Two boxes, one frame.** The pinned block is outside the virtualizer and the list's rows
 * are its wrappers, so they share no coordinates of their own. Both are measured where they
 * are drawn in the scroller (its box on screen, which does not move with its own scroll), the
 * way 3bs measures a merge answer. So a change that makes the scroller clamp its scrollTop, or
 * Chromium anchor it, is read for what is on screen. What moves is the row's host: its
 * wrapper in the list (whose `translate` composes with the virtualizer's inline transform), or
 * its pinned host in the block.
 *
 * **One box clips:** the rows' box around the pinned block, the empty list and the list
 * (`[data-board-rows]`), while anything is on its way. Never the scroller. It is `isolate` for
 * those frames, so a row drawn over the rest stays under the column header, which is outside
 * it, and under the "Pinned n of 5" bar, lifted above it inside. Its bottom reaches the view's
 * bottom, which adds nothing that can be scrolled. The scroller's own bottom edge is held while
 * a shorter list lands (§12.149), by its `min-height`, as a chip's glide holds it, and that hold
 * is one: a chip glide's, handed over by `RowGlide.settle`, goes when these land.
 *
 * **Pin:** each host drawn before glides from where it was drawn, if it was or will be in view;
 * one coming from far away starts just past the edge of the view (§12.149's rule). Hosts new to
 * the window fade in, linear. The truck pinned or unpinned is drawn over the rest, on a solid
 * ground, and its star grows from `pinStarFromScale`. **Density:** each host now in view glides
 * from its old top; the rows' own height, rows out of view and rows new to the window jump.
 *
 * **Mid-flight:** a second cause captures where everything is drawn, mid-glide included, and
 * `run` lands what was moving before it measures, so nothing jumps. A chip's glide is landed
 * by `RowGlide.settle` first; a chip during one of these lands it with `settle`. A host whose
 * place changes mid-flight (a poll) lands at once (§12.149). One that leaves the drawn window
 * goes with its node; one drawn fresh is at its place: nothing flashes at an old one.
 */

export type MoveKind = 'pin' | 'density';

/** The "Pinned n of 5" bar: lifted over a row passing under it. */
export const PINNED_BAR = 'data-pinned-bar';
/** A pinned row's own box, as a list row's wrapper is: what moves. */
export const PINNED_HOST = 'data-pinned-host';

/** Rows overlap on the way, and a row's own ground is see-through. */
const SOLID = 'bg-surface-base';
/** The truck pinned or unpinned, over the rows it crosses (the demo's `data-m-fly`). */
const FLY_Z = '3';
/** The bar over that. The column header is outside the box and over all of it. */
const BAR_Z = '4';

type Host = { el: HTMLElement; id: string; inList: boolean };
type Snapshot = {
  kind: MoveKind;
  id: string | null;
  ms: number;
  tops: Map<string, number>;
  /** The scroller's height as drawn, to hold its bottom edge while a shorter list lands. */
  height: number;
};
type Flight = { host: Host; rest: string; animation: Animation };

export interface BoardMove {
  /** Just before the commit a person's pin or density lands in. */
  capture(kind: MoveKind, id: string | null): void;
  /**
   * In that commit. `before` runs first, only when there is a capture to spend: a chip glide
   * lands, and what it returns (its held bottom edge, let go) is called when these land.
   */
  run(before?: () => (() => void) | void): void;
  /** After every commit: a host whose place changed mid-flight goes there at once. */
  checkTargets(): void;
  /** Everything lands, at once: what a chip does to one of these it finds. */
  settle(): void;
  isMoving(): boolean;
}

const idOf = (el: Element) => el.firstElementChild?.getAttribute('data-row-id') ?? null;

function hostsIn(box: HTMLElement, body: HTMLElement): Host[] {
  const hosts: Host[] = [];
  for (const el of box.querySelectorAll<HTMLElement>(`[${PINNED_HOST}]`)) {
    const id = idOf(el);
    if (id) hosts.push({ el, id, inList: false });
  }
  for (const el of [...body.children] as HTMLElement[]) {
    if (el.hasAttribute(GLIDE_COPY)) continue;
    const id = idOf(el);
    if (id) hosts.push({ el, id, inList: true });
  }
  return hosts;
}

/** Where a host rests: a list row's place is its wrapper's transform, a pinned row's its order. */
const restOf = (host: Host, pinnedOrder: number) =>
  host.inList ? host.el.style.transform : `pinned ${pinnedOrder}`;

export function createBoardMove(
  getScroller: () => HTMLElement | null,
  getBox: () => HTMLElement | null,
  getBody: () => HTMLElement | null,
): BoardMove {
  let snapshot: Snapshot | null = null;
  const flights = new Map<HTMLElement, Flight>();
  const extras = new Set<Animation>();
  /** A chip glide's held bottom edge, handed over by `before`: let go when these land. */
  let release: (() => void) | null = null;

  const restIfDone = () => {
    if (flights.size > 0 || extras.size > 0) return;
    if (release) release();
    else {
      const scroller = getScroller();
      if (scroller?.style.minHeight) clearStyle(scroller);
    }
    release = null;
    const box = getBox();
    if (box?.hasAttribute('style')) clearStyle(box);
    const bar = box?.querySelector(`[${PINNED_BAR}]`);
    if (bar?.hasAttribute('style')) clearStyle(bar);
  };

  const land = (flight: Flight) => {
    if (flights.get(flight.host.el) !== flight) return;
    flights.delete(flight.host.el);
    const { el, inList } = flight.host;
    el.classList.remove(SOLID);
    // A host has no class of its own: an emptied list would leave `class=""` behind.
    if (el.classList.length === 0) el.removeAttribute('class');
    if (inList) el.style.removeProperty('z-index');
    else if (el.hasAttribute('style')) clearStyle(el);
    flight.animation.cancel();
  };

  const settle = () => {
    for (const flight of [...flights.values()]) land(flight);
    for (const animation of [...extras]) animation.cancel();
    restIfDone();
  };

  const pinnedOrders = (hosts: Host[]) => {
    const orders = new Map<HTMLElement, number>();
    let n = 0;
    for (const host of hosts) if (!host.inList) orders.set(host.el, n++);
    return orders;
  };

  return {
    capture(kind, id) {
      snapshot = null;
      const ms = kind === 'pin' ? MOTION_MS.pinGlide : MOTION_MS.densityGlide;
      const scroller = getScroller();
      const box = getBox();
      const body = getBody();
      // A token at 0 is the motion taken back: nothing is measured.
      if (ms <= 0 || !scroller || !box || !body || !mayMove(box) || scroller.clientHeight === 0) {
        return;
      }
      const frame = scroller.getBoundingClientRect();
      const tops = new Map<string, number>();
      for (const host of hostsIn(box, body)) {
        tops.set(host.id, host.el.getBoundingClientRect().top - frame.top);
      }
      snapshot = { kind, id, ms, tops, height: frame.height };
    },

    run(before) {
      const seen = snapshot;
      snapshot = null;
      const scroller = getScroller();
      const box = getBox();
      const body = getBody();
      if (!seen || !scroller || !box || !body) return;
      settle();
      release = before?.() ?? null;
      // A list that gets shorter holds its bottom edge until the rows land (§12.149, as a chip's
      // glide does): the scroller is only as tall as what is in it, so left to that the footer
      // jumps up, and what was in view near the bottom is cut off rather than seen going. Set
      // before anything is read, so the commit's layout is done with it. It adds nothing that can
      // be scrolled: the content inside is no taller.
      scroller.style.minHeight = `${seen.height}px`;

      // Read after the commit's own layout: a scrollTop it clamped or anchored is in these.
      const frame = scroller.getBoundingClientRect();
      const viewBottom = scroller.clientHeight;
      const hosts = hostsIn(box, body);
      const orders = pinnedOrders(hosts);
      type Plan = { host: Host; dy: number | null };
      const plans: Plan[] = [];
      for (const host of hosts) {
        const drawn = host.el.getBoundingClientRect();
        const to = drawn.top - frame.top;
        const h = drawn.height;
        const inView = (y: number) => y + h > 0 && y < viewBottom;
        const was = seen.tops.get(host.id);
        if (was === undefined) {
          // New to the window: a pin fades it in where it belongs; density leaves it.
          if (seen.kind === 'pin' && inView(to)) plans.push({ host, dy: null });
          continue;
        }
        if (Math.abs(was - to) < 0.5) continue;
        const shown = seen.kind === 'density' ? inView(to) : inView(was) || inView(to);
        if (!shown) continue;
        // From far away it starts just past the edge of the view, at a sane speed (§12.149).
        const from = Math.max(-h, Math.min(viewBottom, was));
        if (Math.abs(from - to) < 0.5) continue;
        plans.push({ host, dy: from - to });
      }

      const star =
        seen.kind === 'pin' && seen.id !== null
          ? scroller.querySelector(`[data-row-id="${seen.id}"] button[aria-pressed] svg`)
          : null;
      if (plans.length === 0 && !star) {
        restIfDone();
        return;
      }

      // The box holds its bottom at the view's while anything is on its way; measured above.
      const held = frame.bottom - box.getBoundingClientRect().top;
      if (held > box.offsetHeight) box.style.minHeight = `${Math.floor(held)}px`;
      box.style.overflow = 'clip';
      box.style.isolation = 'isolate';
      const bar = box.querySelector<HTMLElement>(`[${PINNED_BAR}]`);
      if (bar) bar.style.zIndex = BAR_Z;

      for (const { host, dy } of plans) {
        const animation = dy === null ? fadeIn(host.el, seen.ms) : slideFrom(host.el, 0, dy, seen.ms);
        if (!animation) continue;
        if (dy !== null) {
          host.el.classList.add(SOLID);
          if (host.id === seen.id) {
            if (!host.inList) host.el.style.position = 'relative';
            host.el.style.zIndex = FLY_Z;
          }
        }
        const flight: Flight = { host, rest: restOf(host, orders.get(host.el) ?? -1), animation };
        flights.set(host.el, flight);
        whenOver(animation, () => {
          land(flight);
          restIfDone();
        });
      }
      if (star) {
        const grow = play(
          star,
          [{ scale: String(MOTION_SHAPE.pinStarFromScale) }, { scale: '1' }],
          { duration: seen.ms, easing: EASING.dialog },
        );
        if (grow) {
          extras.add(grow);
          whenOver(grow, () => {
            extras.delete(grow);
            restIfDone();
          });
        }
      }
      restIfDone();
    },

    checkTargets() {
      if (flights.size === 0) return;
      const box = getBox();
      const body = getBody();
      const orders = box && body ? pinnedOrders(hostsIn(box, body)) : new Map<HTMLElement, number>();
      for (const flight of [...flights.values()]) {
        const { el } = flight.host;
        if (!el.isConnected || restOf(flight.host, orders.get(el) ?? -1) !== flight.rest) {
          land(flight);
        }
      }
      restIfDone();
    },

    settle,

    isMoving: () => flights.size > 0 || extras.size > 0,
  };
}
