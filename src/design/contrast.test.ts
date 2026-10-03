import { describe, expect, it } from 'vitest';
import { palette } from './tokens';

/**
 * §14.2. The pairs, measured — the rule that did not exist.
 *
 * `tokens.test.ts` enforces that no component hardcodes a hex. That is a
 * different rule, and it is why muted ink sat at 4.29:1 inside every modal
 * for months while every check passed: nothing asserted a ratio, so nothing
 * could fail.
 *
 * A contrast figure in a document is a measurement that was true once. This
 * is the same figure somewhere it gets re-run.
 *
 * WCAG 2.1 relative luminance and the (L1+.05)/(L2+.05) ratio, implemented
 * here rather than imported: it is eleven lines, and a colour assertion that
 * depends on a package is one supply-chain bump away from being untrue.
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

/** Rounded to two places, because that is the precision the spec quotes. */
export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  const ratio = (Math.max(a!, b!) + 0.05) / (Math.min(a!, b!) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** WCAG AA for body text. */
const FLOOR = 4.5;

describe('the ratios §14.4 measured are still the ratios', () => {
  it('muted ink passes on the overlay ground, and the old token does not', () => {
    // The defect, kept as an assertion rather than a memory: this is the
    // pair every modal rendered, and it is 0.21 under the floor.
    expect(contrast(palette.text.muted, palette.surface.overlay)).toBe(4.29);
    expect(contrast(palette.text.muted, palette.surface.overlay)).toBeLessThan(FLOOR);

    expect(contrast(palette.text.mutedOnOverlay, palette.surface.overlay)).toBe(5.2);
    expect(
      contrast(palette.text.mutedOnOverlay, palette.surface.overlay),
    ).toBeGreaterThanOrEqual(FLOOR);
  });

  /**
   * §14 feature 8's bar. The three figures in §14.4's table are "7.06-8.91 ·
   * 3.51 — reused", and they land exactly on tokens that already existed:
   * the range is late.fg to ontime.fg, and the hollow edge is neutral.bd.
   *
   * 3.51 is above the 3:1 floor for a graphical object and deliberately
   * below the 4.5 text floor — nothing is written inside the bar.
   *
   * `neutral.fg` at 8.25 is the fourth ink the strip needed and §14.4 did not
   * have: an arrival with no appointment to judge it against. Asserted here
   * so the claim that it sits INSIDE the stated band stays true.
   */
  it('the health bar\'s three measured figures are still those figures', () => {
    const raised = palette.surface.raised;
    expect(contrast(palette.status.ontime.fg, raised)).toBe(8.91);
    expect(contrast(palette.status.late.fg, raised)).toBe(7.06);
    expect(contrast(palette.status.neutral.bd, raised)).toBe(3.51);

    const neutral = contrast(palette.status.neutral.fg, raised);
    expect(neutral).toBe(8.25);
    expect(neutral).toBeGreaterThan(7.06);
    expect(neutral).toBeLessThan(8.91);

    // Graphical objects, not text: 3:1 is the floor that applies.
    expect(contrast(palette.status.neutral.bd, raised)).toBeGreaterThanOrEqual(3);
  });

  it('every flash ground clears the floor for muted ink', () => {
    // §14.4: the reason the flash peaks at 60% of status.bg. Risk is the
    // floor of the set at 4.56, so darkening any of these needs a new
    // measurement, not a judgement call.
    const measured: [keyof typeof palette.row.flash, number][] = [
      ['late', 4.85],
      ['risk', 4.56],
      ['ontime', 4.7],
      ['arrived', 4.73],
      ['neutral', 4.7],
    ];
    for (const [name, expected] of measured) {
      const ratio = contrast(palette.text.muted, palette.row.flash[name]);
      expect(ratio, name).toBe(expected);
      expect(ratio, name).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it('the full-strength status grounds are why the flash is derived at all', () => {
    // Every one of these fails. Asserted so that "just use status.bg" cannot
    // come back as a simplification.
    const failing: [string, number][] = [
      [palette.status.late.bg, 4.48],
      [palette.status.risk.bg, 4.02],
      [palette.status.ontime.bg, 4.23],
      [palette.status.arrived.bg, 4.34],
    ];
    for (const [bg, expected] of failing) {
      expect(contrast(palette.text.muted, bg)).toBe(expected);
      expect(contrast(palette.text.muted, bg)).toBeLessThan(FLOOR);
    }
  });

  it('a checked row still carries its ink', () => {
    expect(contrast(palette.text.mutedOnSelected, palette.row.checked)).toBe(5.76);
  });

  it('the brand pair the favicon needs, and the one it cannot use', () => {
    // §14.4: cyan on navy is fine. The navy TILE on a dark tab bar is 1.34,
    // which is why §13 needs a 1px cyan edge at 16 and 32px rather than a
    // bare tile. Recorded here so the requirement survives the asset being
    // replaced.
    expect(contrast(palette.brand.cyan, palette.brand.navy)).toBe(5.57);
    expect(contrast(palette.brand.navy, palette.surface.sunken)).toBeLessThan(2);
  });
});

/**
 * §12.91 — the header's option 6a. Every text pair it introduced, measured.
 * Row 1 is `surface.raised`, row 2 reuses `surface.bar`, a selected chip or
 * an active scope sits on `surface.overlay`, and the search box is
 * `surface.base`. The design note quoted "#949ca4 on #1d2126 ≈ 5.6:1" as its
 * lowest pair; measured, it is 5.82.
 */
describe('the header (§12.91)', () => {
  /** An `rgba()` ground as it is painted: blended over what is under it. */
  function over(rgb: [number, number, number], alpha: number, ground: string): string {
    const h = ground.replace('#', '');
    return `#${[0, 2, 4]
      .map((i, n) => Math.round(rgb[n]! * alpha + parseInt(h.slice(i, i + 2), 16) * (1 - alpha)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  it('the feed-down ground is late.fg at 8% over row 1, as the token says', () => {
    expect(palette.feed.downBg).toBe('rgba(255,138,122,.08)');
    expect(over([255, 138, 122], 0.08, palette.surface.raised)).toBe('#2f292d');
  });

  const { surface, text, accent, status } = palette;
  const down = over([255, 138, 122], 0.08, surface.raised);
  const measured: [string, string, string, number][] = [
    // Row 1: brand, scope, sync, clocks.
    ['wordmark, scope name', text.DEFAULT, surface.raised, 13.54],
    ['scope count, kind tag, sync, clock labels', text.secondary, surface.raised, 7.38],
    ['local clock label, menu section titles', text.mutedOnOverlay, surface.raised, 5.82],
    ['active scope name', text.DEFAULT, surface.overlay, 12.1],
    ['active scope count', text.secondary, surface.overlay, 6.59],
    ['active kind tag', accent.DEFAULT, surface.overlay, 7.27],
    ['search placeholder', text.mutedOnOverlay, surface.base, 6.41],
    ['search key caps', text.secondary, surface.base, 8.12],
    ['feed-down text', status.late.fg, down, 6.21],
    // Row 2: chips unselected, the notes and the sort label.
    ['Late chip', status.late.fg, surface.bar, 7.16],
    ['At risk chip, outside-list note', status.risk.fg, surface.bar, 8.76],
    ['On time chip', status.ontime.fg, surface.bar, 9.04],
    ['Arrived chip', status.arrived.fg, surface.bar, 8.97],
    ['Data issues chip', status.neutral.fg, surface.bar, 8.36],
    ['Upcoming, Inactive, quiet notes', text.secondary, surface.bar, 7.48],
    ['All, Drivers only', text.DEFAULT, surface.bar, 13.73],
    ['All count', accent.DEFAULT, surface.bar, 8.25],
    ['sort label', text.mutedOnOverlay, surface.bar, 5.9],
    // A selected chip keeps its ink on the overlay ground.
    ['Late chip, selected', status.late.fg, surface.overlay, 6.31],
    ['At risk chip, selected', status.risk.fg, surface.overlay, 7.72],
    ['On time chip, selected', status.ontime.fg, surface.overlay, 7.96],
    ['Arrived chip, selected', status.arrived.fg, surface.overlay, 7.9],
    ['Data issues chip, selected', status.neutral.fg, surface.overlay, 7.37],
    ['All count, selected', accent.DEFAULT, surface.overlay, 7.27],
  ];

  for (const [what, fg, bg, expected] of measured) {
    it(`${what}: ${expected}`, () => {
      expect(contrast(fg, bg)).toBe(expected);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  it('Upcoming moved from status.tomorrow.fg to text.secondary: 4.87 → 7.48', () => {
    expect(contrast(status.tomorrow.fg, surface.bar)).toBe(4.87);
    expect(contrast(text.secondary, surface.bar)).toBe(7.48);
  });
});

/**
 * §12.101 — the driver history page. Every text pair it adds, on its own
 * ground, measured; the print pairs on paper. The lowest is print's muted
 * ink (the "—" in an empty day) at 5.07.
 */
describe('the driver history page clears the floor (§12.101)', () => {
  const { surface, text, accent, status, history, print } = palette;
  const measured: [string, string, string, number][] = [
    ['Delivered on load block', status.ontime.fg, surface.raised, 8.91],
    ['Cancelled, TONU on load block', history.cancelled, surface.raised, 7.1],
    ['In progress on load block', status.arrived.fg, surface.raised, 8.84],
    ['muted on weekend cell (dash, No truck)', text.muted, history.weekend, 5.39],
    ['muted on page', text.muted, surface.base, 5.29],
    ['secondary on tooltip', text.secondary, surface.overlay, 6.59],
    ['Today pill', text.inverse, accent.DEFAULT, 8.96],
    ['weekend head label', text.secondary, history.weekendHead, 7.64],
    ['print ink', print.ink, print.paper, 16.55],
    ['print secondary', print.inkSecondary, print.paper, 8.26],
    ['print muted', print.inkMuted, print.paper, 5.07],
    ['print delivered', print.delivered, print.paper, 7.61],
    ['print cancelled', print.cancelled, print.paper, 8.31],
    ['print in progress', print.progress, print.paper, 9.92],
    ['print ink on head', print.ink, print.head, 14.11],
    ['print secondary on weekend', print.inkSecondary, print.weekend, 7.65],
  ];
  for (const [what, fg, bg, expected] of measured) {
    it(`${what}: ${expected}`, () => {
      expect(contrast(fg, bg)).toBe(expected);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(FLOOR);
    });
  }
});
