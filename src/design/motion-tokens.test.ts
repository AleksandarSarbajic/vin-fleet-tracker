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

  it('the board opens in 300ms, a row in 120ms, linear, with gaps of 20ms at most', () => {
    expect(MOTION_MS.boardOpen).toBe(300);
    expect(MOTION_MS.boardOpenRow).toBe(120);
    expect(MOTION_MS.boardOpenGapMax).toBe(20);
    expect(EASING.fade).toBe('linear');
  });

  it('the selection slides in 180ms, the map travels in 450ms, other pans stay at 150ms', () => {
    expect(MOTION_MS.selectionSlide).toBe(180);
    expect(MOTION_MS.mapTravel).toBe(450);
    expect(MOTION_MS.map).toBe(150);
  });

  it('rows glide in 260ms', () => {
    expect(MOTION_MS.rowGlide).toBe(260);
  });

  it('the curve is the windows’ curve', () => {
    expect(EASING.dialog).toBe('cubic-bezier(.22,.61,.36,1)');
  });
});
