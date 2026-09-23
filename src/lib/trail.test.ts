import { describe, expect, it } from 'vitest';
import { TRAIL_STEP_MS, TRAIL_WINDOW_MS, trailDots, type TrailPoint } from './trail';
import { TRAIL_RAMP } from '@/design/tokens';

/** §14 feature 9. */

const NOW = Date.parse('2026-09-23T18:00:00.000Z');

/** A reading `minutes` ago, at a coordinate that encodes its age. */
const at = (minutes: number): TrailPoint => ({
  lat: 41 + minutes / 1000,
  lng: -87,
  recordedAt: new Date(NOW - minutes * 60_000).toISOString(),
});

const ageOf = (dot: { recordedAt: string }) =>
  Math.round((NOW - Date.parse(dot.recordedAt)) / 60_000);

describe('the ramp', () => {
  it('spreads five dots across the half hour', () => {
    // One reading every 30 seconds, the worker's real cadence.
    const points = Array.from({ length: 61 }, (_, i) => at(i * 0.5));
    const dots = trailDots(points, NOW);
    expect(dots).toHaveLength(TRAIL_RAMP.length);
    expect(dots.map((d) => d.opacity)).toEqual([...TRAIL_RAMP]);
  });

  /**
   * The alternative — taking the last five rows — gives a trail two and a
   * half minutes long, which never reaches past the end of the block the
   * truck is on.
   */
  it('reaches back half an hour rather than five polls', () => {
    const points = Array.from({ length: 61 }, (_, i) => at(i * 0.5));
    const oldest = trailDots(points, NOW).at(-1)!;
    expect(ageOf(oldest)).toBeGreaterThanOrEqual(24);
  });

  it('drops the newest reading, because the marker is already drawn there', () => {
    const points = [at(0), at(1), at(7)];
    const dots = trailDots(points, NOW);
    expect(dots.some((d) => ageOf(d) === 0)).toBe(false);
    expect(ageOf(dots[0]!)).toBe(1);
  });

  it('takes the newest reading in each step, not the oldest', () => {
    const points = [at(0), at(1), at(2), at(3)];
    // Step 0 spans 0–6 minutes; 1, 2 and 3 all fall in it.
    expect(trailDots(points, NOW).filter((d) => d.step === 0)).toHaveLength(1);
    expect(ageOf(trailDots(points, NOW)[0]!)).toBe(1);
  });
});

describe('when there is less to draw', () => {
  it('degrades to however many steps have a reading', () => {
    // Tracked for nine minutes: steps 0 and 1 only.
    const points = [at(0), at(2), at(8)];
    const dots = trailDots(points, NOW);
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => d.step)).toEqual([0, 1]);
  });

  it('draws nothing from a single reading', () => {
    expect(trailDots([at(0)], NOW)).toEqual([]);
  });

  it('draws nothing at all from nothing', () => {
    expect(trailDots([], NOW)).toEqual([]);
  });

  it('ignores anything older than the window', () => {
    const points = [at(0), at(TRAIL_WINDOW_MS / 60_000 + 5)];
    expect(trailDots(points, NOW)).toEqual([]);
  });

  /**
   * The correct picture, not a bug: five dots at one coordinate draw as one
   * dot beside the marker, which is what "has not moved in half an hour"
   * looks like.
   */
  it('keeps every step for a truck that has not moved', () => {
    const parked = Array.from({ length: 61 }, (_, i) => ({
      lat: 41.5,
      lng: -87.5,
      recordedAt: new Date(NOW - i * 30_000).toISOString(),
    }));
    const dots = trailDots(parked, NOW);
    expect(dots).toHaveLength(TRAIL_RAMP.length);
    expect(new Set(dots.map((d) => `${d.lat},${d.lng}`)).size).toBe(1);
  });
});

describe('the dots themselves', () => {
  it('stays inside §14.5’s 4–5px, with the freshest the larger', () => {
    const dots = trailDots(
      Array.from({ length: 61 }, (_, i) => at(i * 0.5)),
      NOW,
    );
    expect(dots[0]!.radius).toBe(5);
    for (const dot of dots.slice(1)) expect(dot.radius).toBe(4);
  });

  it('divides the window evenly by the ramp', () => {
    expect(TRAIL_STEP_MS * TRAIL_RAMP.length).toBe(TRAIL_WINDOW_MS);
  });

  /** Unsorted input is the realistic case: SQL order is not a guarantee. */
  it('does not depend on the order it is given', () => {
    const points = [at(13), at(0), at(25), at(7), at(1)];
    const dots = trailDots(points, NOW);
    expect(dots.map((d) => d.step)).toEqual([0, 1, 2, 4]);
  });
});
