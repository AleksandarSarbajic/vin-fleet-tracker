import { describe, expect, it } from 'vitest';
import { POPUP_MARGIN_PX, popupClearance, type Rect, type Shift } from './clearance';

/**
 * The map pane as the e2e run measured it at 1920×1080: 762×960, with the
 * zoom stack and the Map/Satellite switcher top-right and the marker key
 * bottom-right. The popup is its real size, 290×330 with the tip.
 */
const FRAME: Rect = { left: 0, top: 0, right: 762, bottom: 960 };
const ZOOM: Rect = { left: 712, top: 14, right: 746, bottom: 80 };
const SWITCHER: Rect = { left: 594, top: 14, right: 706, bottom: 48 };
const KEY: Rect = { left: 646, top: 742, right: 746, bottom: 946 };
const CONTROLS = [ZOOM, SWITCHER, KEY];
const W = 290;
const H = 330;

/** A popup whose tip — the truck — is at (x, y), opening above it. */
const popupAt = (x: number, y: number): Rect => ({
  left: x - W / 2,
  right: x + W / 2,
  top: y - 18 - H,
  bottom: y - 18,
});

const after = (r: Rect, s: Shift): Rect => ({
  left: r.left + s.dx,
  right: r.right + s.dx,
  top: r.top + s.dy,
  bottom: r.bottom + s.dy,
});

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Inside the frame by the margin, and off every control by it. */
function legal(r: Rect): boolean {
  const m = POPUP_MARGIN_PX - 0.001;
  const inside =
    r.left >= FRAME.left + m &&
    r.top >= FRAME.top + m &&
    r.right <= FRAME.right - m &&
    r.bottom <= FRAME.bottom - m;
  return (
    inside &&
    CONTROLS.every(
      (c) =>
        !overlaps(r, {
          left: c.left - m,
          top: c.top - m,
          right: c.right + m,
          bottom: c.bottom + m,
        }),
    )
  );
}

describe('keeping the popup inside the map and off the controls', () => {
  it('leaves a popup that is already clear exactly where it is', () => {
    expect(popupClearance(popupAt(381, 480), FRAME, CONTROLS)).toEqual({ dx: 0, dy: 0 });
  });

  it('brings a popup down from past the top edge, and no further', () => {
    const shift = popupClearance(popupAt(300, 120), FRAME, CONTROLS);
    expect(shift.dx).toBe(0);
    expect(after(popupAt(300, 120), shift).top).toBe(POPUP_MARGIN_PX);
  });

  it('brings a popup in from each side edge', () => {
    const right = popupClearance(popupAt(730, 600), FRAME, CONTROLS);
    expect(after(popupAt(730, 600), right).right).toBe(FRAME.right - POPUP_MARGIN_PX);
    const left = popupClearance(popupAt(20, 600), FRAME, CONTROLS);
    expect(after(popupAt(20, 600), left).left).toBe(POPUP_MARGIN_PX);
  });

  /** The reported case: a truck in the top-right corner, under both controls. */
  it('takes a top-right popup out from under the switcher and the zoom buttons', () => {
    const popup = popupAt(700, 90);
    const moved = after(popup, popupClearance(popup, FRAME, CONTROLS));
    expect(legal(moved)).toBe(true);
    expect(overlaps(moved, SWITCHER)).toBe(false);
    expect(overlaps(moved, ZOOM)).toBe(false);
  });

  it('takes a bottom-right popup off the marker key', () => {
    const popup = popupAt(690, 900);
    expect(overlaps(popup, KEY)).toBe(true);
    const moved = after(popup, popupClearance(popup, FRAME, CONTROLS));
    expect(legal(moved)).toBe(true);
  });

  it('picks the smaller way out, not the first one found', () => {
    // Two pixels up under the switcher (which ends at y=48): two pixels down
    // clears it, where going left would cost most of the popup's width.
    const popup: Rect = { left: 450, top: 46, right: 740, bottom: 376 };
    expect(popupClearance(popup, FRAME, [SWITCHER], 0)).toEqual({ dx: 0, dy: 2 });
  });

  it('keeps the heading visible when the popup is taller than the map', () => {
    const tall: Rect = { left: 200, top: -300, right: 490, bottom: 1100 };
    expect(after(tall, popupClearance(tall, FRAME, CONTROLS)).top).toBe(POPUP_MARGIN_PX);
  });

  it('finds a legal place for a truck anywhere on the map', () => {
    // Every 12 px across the whole pane, including under each control.
    const illegal: string[] = [];
    for (let x = 0; x <= FRAME.right; x += 12) {
      for (let y = 0; y <= FRAME.bottom; y += 12) {
        const popup = popupAt(x, y);
        if (!legal(after(popup, popupClearance(popup, FRAME, CONTROLS))))
          illegal.push(`${x},${y}`);
      }
    }
    expect(illegal).toEqual([]);
  });
});
