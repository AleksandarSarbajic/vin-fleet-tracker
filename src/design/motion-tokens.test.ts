import { describe, expect, it } from 'vitest';
import { EASING, MOTION_MS, MOTION_SHAPE } from './tokens';

/**
 * §12.149. The new motion's numbers, written out here. Alex chose them from the demo at
 * its Bold setting on 2026-11-06 (phase 3bg). The browser tests read a duration from the
 * running animation, and this holds the token to the spec.
 */
describe('the numbers of the new motion (§12.149)', () => {
  it('a segment highlight takes 260ms', () => {
    expect(MOTION_MS.segmentSlide).toBe(260);
  });

  it('a count rolls in 400ms', () => {
    expect(MOTION_MS.countRoll).toBe(400);
  });

  it('a page comes up 10px in 260ms', () => {
    expect(MOTION_MS.pageIn).toBe(260);
    expect(MOTION_SHAPE.pageRisePx).toBe(10);
  });

  it('the bulk bar takes 300ms', () => {
    expect(MOTION_MS.bulkBar).toBe(300);
  });

  it('the board opens in 500ms, a row in 200ms, linear, with gaps of 35ms at most', () => {
    expect(MOTION_MS.boardOpen).toBe(500);
    expect(MOTION_MS.boardOpenRow).toBe(200);
    expect(MOTION_MS.boardOpenGapMax).toBe(35);
    expect(EASING.fade).toBe('linear');
  });

  it('the selection slides in 280ms, the map travels in 700ms, other pans stay at 150ms', () => {
    expect(MOTION_MS.selectionSlide).toBe(280);
    expect(MOTION_MS.mapTravel).toBe(700);
    expect(MOTION_MS.map).toBe(150);
  });

  it('rows glide in 380ms', () => {
    expect(MOTION_MS.rowGlide).toBe(380);
  });

  it('the curve is the windows’ curve', () => {
    expect(EASING.dialog).toBe('cubic-bezier(.22,.61,.36,1)');
  });
});
