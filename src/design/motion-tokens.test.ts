import { describe, expect, it } from 'vitest';
import { EASING, MOTION_MS } from './tokens';

/**
 * §12.149. The new motion's numbers, chosen by Alex from the demo at its On setting
 * (phase 3bd), written out here. The browser tests read a duration from the running
 * animation, and this holds the token to the spec.
 */
describe('the numbers of the new motion (§12.149)', () => {
  it('a segment highlight takes 180ms', () => {
    expect(MOTION_MS.segmentSlide).toBe(180);
  });

  it('the curve is the windows’ curve', () => {
    expect(EASING.dialog).toBe('cubic-bezier(.22,.61,.36,1)');
  });
});
