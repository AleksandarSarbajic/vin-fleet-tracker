/**
 * Where the selected truck's popup may sit: inside the map, and off every map
 * control.
 *
 * The controls — the zoom buttons, the Map/Satellite switcher, the marker
 * key — are DOM siblings laid over the map, so Mapbox cannot see them, and
 * the popup is anchored `bottom` (always above its truck), so it cannot flip
 * away from an edge either. A truck in the top-right corner therefore opened
 * its popup half outside the map and under the switcher.
 *
 * Changing the anchor alone would not have been enough: a truck can sit
 * UNDER a control, or in a corner where no anchor fits. So this returns the
 * smallest shift that puts the whole popup somewhere legal, and the map pans
 * by it — the popup moves with the map, so this is also the pan.
 *
 * Pure, in screen pixels, so every edge and corner can be argued in a test.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Shift {
  dx: number;
  dy: number;
}

/** Breathing room from the map's edge and from each control. */
export const POPUP_MARGIN_PX = 8;

const moved = (r: Rect, s: Shift): Rect => ({
  left: r.left + s.dx,
  right: r.right + s.dx,
  top: r.top + s.dy,
  bottom: r.bottom + s.dy,
});

const grow = (r: Rect, by: number): Rect => ({
  left: r.left - by,
  right: r.right + by,
  top: r.top - by,
  bottom: r.bottom + by,
});

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The shift along one axis that brings [lo, hi] inside [min, max]. */
function into(lo: number, hi: number, min: number, max: number): number {
  // Too big to fit: keep the start (the popup's heading) visible.
  if (hi - lo > max - min) return min - lo;
  if (lo < min) return min - lo;
  if (hi > max) return max - hi;
  return 0;
}

function intoArea(r: Rect, area: Rect): Shift {
  return {
    dx: into(r.left, r.right, area.left, area.right),
    dy: into(r.top, r.bottom, area.top, area.bottom),
  };
}

/**
 * The smallest shift (by distance) that puts `popup` inside `frame` less the
 * margin and off every obstacle. `{0, 0}` when it is already clear.
 *
 * A small search, not a formula: escaping one control can push the popup into
 * another or out of the map, so each candidate is re-clamped into the map and
 * checked again, three moves deep. With three controls that is a few dozen
 * rectangles. When nothing is legal — a popup taller than the space the
 * controls leave — it still returns the shift that keeps it inside the map.
 */
export function popupClearance(
  popup: Rect,
  frame: Rect,
  obstacles: readonly Rect[],
  margin = POPUP_MARGIN_PX,
): Shift {
  const area = grow(frame, -margin);
  const blocks = obstacles.map((o) => grow(o, margin));
  const clamp = (s: Shift): Shift => {
    const fix = intoArea(moved(popup, s), area);
    return { dx: s.dx + fix.dx, dy: s.dy + fix.dy };
  };
  const hits = (s: Shift) => blocks.filter((b) => overlaps(moved(popup, s), b));
  const size = (s: Shift) => Math.hypot(s.dx, s.dy);

  const start = clamp({ dx: 0, dy: 0 });
  let best: Shift | null = null;
  let frontier: Shift[] = [start];
  const seen = new Set<string>();

  for (let depth = 0; depth <= 3 && frontier.length > 0; depth += 1) {
    const next: Shift[] = [];
    for (const s of frontier) {
      const key = `${Math.round(s.dx)},${Math.round(s.dy)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const blocking = hits(s);
      if (blocking.length === 0) {
        if (best === null || size(s) < size(best)) best = s;
        continue;
      }
      for (const b of blocking) {
        const r = moved(popup, s);
        next.push(
          clamp({ dx: s.dx, dy: s.dy + (b.bottom - r.top) }), // below it
          clamp({ dx: s.dx, dy: s.dy + (b.top - r.bottom) }), // above it
          clamp({ dx: s.dx + (b.left - r.right), dy: s.dy }), // left of it
          clamp({ dx: s.dx + (b.right - r.left), dy: s.dy }), // right of it
        );
      }
    }
    frontier = next;
  }
  return best ?? start;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
