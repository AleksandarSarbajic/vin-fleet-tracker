import { EASING, MOTION_MS } from '@/design/tokens';
import { makeInert } from '@/components/overlay/dialog-motion';
import { clearStyle, mayMove, play, whenOver } from '@/lib/motion';

/**
 * §12.149. Rows glide to their new places when the dispatcher changes the list: a chip,
 * a list, the reorder bar. Those causes are named by `FleetList`'s `glideCause`; nothing
 * here looks at positions on its own, so a density change, a resize, a scroll, a search
 * and a poll can never start one. A poll that changes who is in the list still moves
 * rows, as it always did, by a snap (§12.4).
 *
 * **The wrappers move, in the virtualizer's own coordinates.** Each wrapper already has
 * its resting place as an inline `translateY`, which React goes on writing. A Web
 * Animation runs over it and leaves nothing when it ends. So the row is live and clickable
 * the whole way, and a scroll during a glide carries it along.
 *
 * **Where a row is drawn is read just before the commit** (`capture`), so a second chip
 * takes every row up from where it is drawn and five clicks in a row never jump.
 *
 * **Nothing in flight extends the scroller.** The list clips for those frames, and its
 * box reaches the bottom of the view. That reach never adds to what can be scrolled: it
 * ends at the bottom of what is already showing. A row coming from far away starts just
 * past the edge of the view, not thousands of pixels off, so it arrives at a sane speed.
 *
 * **A list that gets shorter holds its height until the rows land.** The scroller is only
 * as tall as what is in it, with the footer right under it. Left to that, the footer jumps
 * up on the first frame, what is leaving below the new end is cut off rather than seen
 * going, and a press aimed at a row lands on the footer.
 *
 * **A row leaving the drawn window** has no wrapper left to move, so a copy finishes the
 * journey: faded out if it left the list, gliding away if it only left the window.
 * The copy is inert and has no identity (`makeInert`), so a press goes through it.
 *
 * **Pinned rows do not glide.** They are outside the virtualizer, in the block above the
 * list, and a chip that hides one takes it away at once. The rows below go from where they
 * were drawn, so a block that changes height does not make them jump.
 *
 * **A press belongs to what it came down on.** While rows are moving there can be a gap
 * under the pointer, where at rest there would be a row: it selects the nearest row drawn,
 * rather than nothing. And the browser sends a click to what the press and the release
 * have in common, so if the release finds another row it goes to the list. A press holds
 * everything (`lib/motion.ts`), but the animation clock runs a frame ahead of what was
 * hit-tested and can tick over between the two, and at this speed a frame can be a whole
 * row. So the row is remembered from the press and that is the row selected.
 */

export const GLIDE_COPY = 'data-glide-copy';

/** Rows overlap on the way, and a row's own ground is see-through. */
const SOLID = 'bg-surface-base';
/** How far a press can wander and still be a press: a hand is not still. */
const PRESS_SLOP_PX = 4;

type Seen = { top: number; opacity: number };
type Snapshot = {
  rows: Map<string, Seen>;
  copies: Map<string, HTMLElement>;
  order: Map<string, number>;
  bodyTop: number;
  bottom: number;
};
type Flight = { wrapper: HTMLElement; to: string; animations: Animation[] };
type Ghost = { node: HTMLElement; animations: Animation[] };

export interface RowGlide {
  /** Just before the commit that changes the list. */
  capture(nextIds: ReadonlySet<string>, order: readonly string[]): void;
  /** After it: every row goes from where it was drawn to where it now belongs. */
  run(ids: readonly string[], rowHeight: number): void;
  /** After every commit. A row whose place changed mid-flight goes there at once. */
  checkTargets(): void;
  isMoving(): boolean;
  pressed(event: PointerEvent): void;
  /** The row a press meant, if this click ends one and did not reach it by itself. */
  clicked(event: MouseEvent): string | null;
}

const wrappersOf = (body: HTMLElement) =>
  ([...body.children] as HTMLElement[]).filter((c) => !c.hasAttribute(GLIDE_COPY));
const idOf = (wrapper: HTMLElement) => wrapper.firstElementChild?.getAttribute('data-row-id') ?? null;
const opacityOf = (el: Element) =>
  el.getAnimations().length > 0 ? Number(getComputedStyle(el).opacity) : 1;
const yOf = (wrapper: HTMLElement) => new DOMMatrixReadOnly(wrapper.style.transform).m42;
const translate = (y: number) => `translateY(${y}px)`;

export function createRowGlide(
  getScroller: () => HTMLElement | null,
  getBody: () => HTMLElement | null,
): RowGlide {
  let snapshot: Snapshot | null = null;
  let press: { id: string; x: number; y: number } | null = null;
  const flights = new Map<HTMLElement, Flight>();
  const ghosts = new Map<string, Ghost>();

  const restIfDone = () => {
    if (flights.size > 0 || ghosts.size > 0) return;
    const style = getBody()?.style;
    style?.removeProperty('overflow');
    style?.removeProperty('isolation');
    style?.removeProperty('min-height');
    const scroller = getScroller();
    if (scroller?.style.minHeight) clearStyle(scroller);
  };

  const land = (flight: Flight) => {
    if (flights.get(flight.wrapper) !== flight) return;
    flights.delete(flight.wrapper);
    flight.wrapper.classList.remove(SOLID);
    flight.wrapper.style.removeProperty('z-index');
    for (const animation of flight.animations) animation.cancel();
  };

  const dropGhost = (id: string, ghost: Ghost) => {
    if (ghosts.get(id) !== ghost) return;
    ghosts.delete(id);
    for (const animation of ghost.animations) animation.cancel();
    ghost.node.remove();
  };

  const fade = (el: Element, from: number, to: number) =>
    play(el, [{ opacity: from }, { opacity: to }], {
      duration: MOTION_MS.rowGlide,
      easing: EASING.fade,
    });
  const glide = (el: Element, from: number, to: number) =>
    play(el, [{ transform: translate(from) }, { transform: translate(to) }], {
      duration: MOTION_MS.rowGlide,
      easing: EASING.dialog,
    });

  return {
    capture(nextIds, order) {
      snapshot = null;
      const body = getBody();
      const scroller = getScroller();
      if (!body || !scroller || !mayMove(body) || scroller.clientHeight === 0) return;
      const view = scroller.getBoundingClientRect();
      const rows = new Map<string, Seen>();
      const copies = new Map<string, HTMLElement>();
      for (const wrapper of wrappersOf(body)) {
        const id = idOf(wrapper);
        if (id === null) continue;
        const box = wrapper.getBoundingClientRect();
        rows.set(id, { top: box.top, opacity: opacityOf(wrapper) });
        if (!nextIds.has(id) && box.bottom > view.top && box.top < view.bottom) {
          copies.set(id, makeInert(wrapper));
        }
      }
      for (const [id, ghost] of ghosts) {
        rows.set(id, {
          top: ghost.node.getBoundingClientRect().top,
          opacity: Number(getComputedStyle(ghost.node).opacity),
        });
      }
      snapshot = {
        rows,
        copies,
        order: new Map(order.map((id, i) => [id, i])),
        bodyTop: body.getBoundingClientRect().top,
        bottom: view.bottom,
      };
    },

    run(ids, rowHeight) {
      const seen = snapshot;
      snapshot = null;
      const body = getBody();
      const scroller = getScroller();
      if (!seen || !body || !scroller) return;

      for (const flight of [...flights.values()]) land(flight);

      // Before anything is measured: the rows' places below are in the view it holds. It
      // holds the bottom edge and not the height, because a first chip makes the header
      // taller and the list starts lower: the same height would stand past the panel.
      scroller.style.minHeight = `${Math.max(0, seen.bottom - scroller.getBoundingClientRect().top)}px`;

      const bodyTop = body.getBoundingClientRect().top;
      const view = scroller.getBoundingClientRect();
      const viewTop = view.top - bodyTop;
      const viewBottom = view.bottom - bodyTop;
      const inView = (y: number) => y + rowHeight > viewTop && y < viewBottom;
      const toTheEdge = (y: number) => Math.max(viewTop - rowHeight, Math.min(viewBottom, y));
      const index = new Map(ids.map((id, i) => [id, i]));

      const wrappers = wrappersOf(body);
      const drawn = new Set<string>();
      for (const wrapper of wrappers) {
        const id = idOf(wrapper);
        if (id === null) continue;
        drawn.add(id);
        const to = yOf(wrapper);
        const was = seen.rows.get(id);
        const old = seen.order.get(id);
        const from = was
          ? was.top - bodyTop
          : old === undefined
            ? null
            : toTheEdge(old * rowHeight + seen.bodyTop - bodyTop);

        const animations: Animation[] = [];
        if (from === null) {
          // New to the list: it arrives where it belongs.
          if (inView(to)) {
            const fadeIn = fade(wrapper, 0, 1);
            if (fadeIn) animations.push(fadeIn);
          }
        } else {
          if (was && was.opacity < 1) {
            const fadeIn = fade(wrapper, was.opacity, 1);
            if (fadeIn) animations.push(fadeIn);
          }
          if (Math.abs(from - to) >= 0.5 && (inView(from) || inView(to))) {
            const going = glide(wrapper, from, to);
            if (going) {
              animations.push(going);
              wrapper.classList.add(SOLID);
              // The further it is going, the higher: a row crossing many stays on top.
              wrapper.style.zIndex = String(1 + Math.round(Math.abs(from - to) / rowHeight));
            }
          }
        }
        const last = animations.at(-1);
        if (last) {
          const flight: Flight = { wrapper, to: wrapper.style.transform, animations };
          flights.set(wrapper, flight);
          whenOver(last, () => {
            land(flight);
            restIfDone();
          });
        }
      }

      /** A copy on its way: it fades if it left the list, and glides if it left the window. */
      const send = (id: string, node: HTMLElement, was: Seen | undefined) => {
        const from = (was?.top ?? seen.bodyTop) - bodyTop;
        node.style.transform = translate(from);
        const place = index.get(id);
        const animation =
          place === undefined
            ? fade(node, was?.opacity ?? 1, 0)
            : glide(node, from, toTheEdge(place * rowHeight));
        if (!animation) {
          node.remove();
          ghosts.delete(id);
          return;
        }
        const ghost: Ghost = { node, animations: [animation] };
        ghosts.set(id, ghost);
        whenOver(animation, () => {
          dropGhost(id, ghost);
          restIfDone();
        });
      };

      for (const [id, ghost] of [...ghosts]) {
        for (const animation of ghost.animations) animation.cancel();
        if (drawn.has(id)) {
          ghost.node.remove();
          ghosts.delete(id);
        } else {
          send(id, ghost.node, seen.rows.get(id));
        }
      }
      for (const [id, copy] of seen.copies) {
        if (drawn.has(id) || ghosts.has(id)) continue;
        copy.setAttribute(GLIDE_COPY, '');
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('inert', '');
        copy.classList.add(SOLID, 'pointer-events-none');
        copy.style.zIndex = '1';
        body.append(copy);
        send(id, copy, seen.rows.get(id));
      }

      if (flights.size > 0 || ghosts.size > 0) {
        body.style.overflow = 'clip';
        body.style.isolation = 'isolate';
        body.style.minHeight = `${Math.max(0, Math.floor(viewBottom))}px`;
      } else {
        restIfDone();
      }
    },

    checkTargets() {
      for (const flight of [...flights.values()]) {
        if (!flight.wrapper.isConnected || flight.wrapper.style.transform !== flight.to) {
          land(flight);
        }
      }
      restIfDone();
    },

    isMoving: () => flights.size > 0 || ghosts.size > 0,

    pressed(event) {
      press = null;
      if (flights.size === 0 && ghosts.size === 0) return;
      const body = getBody();
      const scroller = getScroller();
      if (!body || !scroller) return;
      const pressedRow = (event.target as Element).closest?.('[data-row-id]');
      if (pressedRow) {
        const id = pressedRow.getAttribute('data-row-id');
        if (id) press = { id, x: event.clientX, y: event.clientY };
        return;
      }
      // What is drawn: the list clips, and the column headers stand over its top. Rows
      // coming from past the edge start in one place, on top of each other, and the one
      // a person sees is the one on top.
      const header = scroller.querySelector(':scope > [role="row"]');
      const top = Math.max(
        body.getBoundingClientRect().top,
        header?.getBoundingClientRect().bottom ?? 0,
      );
      const bottom = scroller.getBoundingClientRect().bottom;
      let best: { id: string; distance: number; height: number } | null = null;
      for (const wrapper of wrappersOf(body)) {
        const id = idOf(wrapper);
        if (id === null) continue;
        const box = wrapper.getBoundingClientRect();
        if (box.bottom <= top || box.top >= bottom) continue;
        const distance = Math.max(box.top - event.clientY, event.clientY - box.bottom, 0);
        const height = Number(wrapper.style.zIndex);
        if (
          !best ||
          distance < best.distance ||
          (distance === best.distance && height > best.height)
        ) {
          best = { id, distance, height };
        }
      }
      if (best) press = { id: best.id, x: event.clientX, y: event.clientY };
    },

    clicked(event) {
      const meant = press;
      press = null;
      if (!meant || (event.target as Element).closest?.('[data-row-id]')) return null;
      const moved = Math.max(Math.abs(event.clientX - meant.x), Math.abs(event.clientY - meant.y));
      return moved <= PRESS_SLOP_PX ? meant.id : null;
    },
  };
}
