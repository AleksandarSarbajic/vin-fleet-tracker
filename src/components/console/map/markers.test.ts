import { describe, expect, it } from 'vitest';
import { palette } from '@/design/tokens';
import { PLATE_FILL, PLATE_RIM } from './markers';

/**
 * The satellite plate (§12.70), held to its guarantee arithmetically.
 *
 * The browser measurement that motivated it sampled 44 real grounds — the 22
 * trucks' positions at zoom 9 and 13. That is evidence about those grounds.
 * These tests make the claim that matters for the next truck, parked somewhere
 * nobody sampled: the plate separates from EVERY possible ground.
 */

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('the satellite plate separates from any ground', () => {
  it('keeps one edge at 3:1 or better for every ground luminance from 0 to 1', () => {
    const rim = luminance(PLATE_RIM);
    const plate = luminance(PLATE_FILL);

    /**
     * The rim's ratio falls as the ground brightens and the plate's rises. The
     * worst case is where they cross; sweeping the whole range finds it rather
     * than trusting the algebra.
     */
    let worst = Infinity;
    for (let ground = 0; ground <= 1; ground += 0.0005) {
      worst = Math.min(worst, Math.max(ratio(rim, ground), ratio(plate, ground)));
    }

    // WCAG 1.4.11's 3:1 for non-text graphics, with the margin stated: 3.86.
    expect(worst).toBeGreaterThanOrEqual(3);
    expect(worst).toBeCloseTo(3.86, 1);
  });

  /**
   * And why a SINGLE colour could not do it, which is the reason the plate has
   * two. Any one colour has some ground it matches: the dark-map markers failed
   * on satellite for exactly this reason, their two-tone pairs straddling the
   * mid-grey this fleet's imagery sits at (median luminance 0.139).
   */
  it('could not be done by either colour alone', () => {
    const midGround = 0.139;
    expect(ratio(luminance(PLATE_FILL), 0.35)).toBeGreaterThan(3);
    expect(ratio(luminance(PLATE_RIM), midGround)).toBeGreaterThan(3);
    // The rim alone fails on pale concrete; the plate alone fails on dark forest.
    expect(ratio(luminance(PLATE_RIM), 0.6)).toBeLessThan(3);
    expect(ratio(luminance(PLATE_FILL), 0.02)).toBeLessThan(3);
  });
});

describe('each glyph reads against the plate it now sits on', () => {
  /**
   * Inside the plate a glyph is on its designed ground again, so the colour
   * that DRAWS its outline there must clear the plate. For the four filled
   * shapes that is the fill — their dark stroke is the plate's colour and
   * merges into it by design. For the rings it is the ring.
   */
  const drawn: [string, string][] = [
    ['LATE', palette.status.late.fg],
    ['AT_RISK', palette.status.risk.fg],
    ['ON_TIME', palette.status.ontime.fg],
    ['ARRIVED', palette.status.arrived.fg],
    ['TOMORROW', palette.status.tomorrow.fg],
    ['NO_APPT', palette.status.neutral.fg],
    ['STALE_GPS', palette.status.neutral.fg],
    ['UNASSIGNED', palette.status.neutral.fg],
  ];

  it.each(drawn)('%s clears 3:1 on the plate', (_status, colour) => {
    expect(ratio(luminance(colour), luminance(PLATE_FILL))).toBeGreaterThanOrEqual(3);
  });

  it('includes Tomorrow, the marker that was invisible on raw imagery', () => {
    // 0% of the 44 real locations reached 3:1 without the plate; worst 1.00.
    expect(ratio(luminance(palette.status.tomorrow.fg), luminance(PLATE_FILL))).toBeGreaterThan(5);
  });
});
