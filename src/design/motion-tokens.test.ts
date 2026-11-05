import { describe, expect, it } from 'vitest';
import { EASING, MOTION_MS, MOTION_SHAPE } from './tokens';

/**
 * §12.149. The new motion's numbers, chosen by Alex from the demo at its On setting
 * (phase 3bd), written out here. The browser tests read a duration from the running
 * animation, and this holds the token to the spec.
 */
describe('the numbers of the new motion (§12.149)', () => {
  it('a segment highlight takes 180ms', () => {
    expect(MOTION_MS.segmentSlide).toBe(180);
  });

  it('a count rolls in 240ms', () => {
    expect(MOTION_MS.countRoll).toBe(240);
  });

  it('a page comes up 6px in 180ms', () => {
    expect(MOTION_MS.pageIn).toBe(180);
    expect(MOTION_SHAPE.pageRisePx).toBe(6);
  });

  it('the bulk bar takes 200ms', () => {
    expect(MOTION_MS.bulkBar).toBe(200);
  });

  it('the curve is the windows’ curve', () => {
    expect(EASING.dialog).toBe('cubic-bezier(.22,.61,.36,1)');
  });
});
