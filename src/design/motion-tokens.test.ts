import { describe, expect, it } from 'vitest';
import { EASING, MOTION_MS, MOTION_SHAPE } from './tokens';
import tailwind from '../../tailwind.config';

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

/**
 * §12.152. The small motions of phase 3bj, at the demo's Bold, written out here so taking
 * one back fails this until it is told.
 */
describe('the numbers of the small motions (§12.152)', () => {
  it('a chip’s chosen look: taken back (0), its 75% kept for when it returns', () => {
    expect(MOTION_MS.chipGround).toBe(0);
    expect(MOTION_SHAPE.chipGroundFromScale).toBe(0.75);
  });

  it('a checkbox pops: 270ms, from 50%', () => {
    expect(MOTION_MS.checkPop).toBe(270);
    expect(MOTION_SHAPE.checkPopFromScale).toBe(0.5);
  });

  it('the empty list drops 14px in 270ms', () => {
    expect(MOTION_MS.emptyDrop).toBe(270);
    expect(MOTION_SHAPE.emptyDropPx).toBe(14);
  });

  it('the two banners and the reorder bar fade in 270ms', () => {
    expect(MOTION_MS.feedBannerFade).toBe(270);
    expect(MOTION_MS.fetchBannerFade).toBe(270);
    expect(MOTION_MS.reorderFade).toBe(270);
  });

  it('the note beside the chips drops 14px in 270ms', () => {
    expect(MOTION_MS.noteDrop).toBe(270);
    expect(MOTION_SHAPE.noteDropPx).toBe(14);
  });

  it('“Copied” pops: 270ms, from 50%', () => {
    expect(MOTION_MS.copiedPop).toBe(270);
    expect(MOTION_SHAPE.copiedPopFromScale).toBe(0.5);
  });

  it('a field’s message drops 14px in 270ms', () => {
    expect(MOTION_MS.invalidDrop).toBe(270);
    expect(MOTION_SHAPE.invalidDropPx).toBe(14);
  });

  it('the edit window’s three strips drop 14px in 270ms', () => {
    expect(MOTION_MS.unsavedDrop).toBe(270);
    expect(MOTION_SHAPE.unsavedDropPx).toBe(14);
    expect(MOTION_MS.savedDrop).toBe(270);
    expect(MOTION_SHAPE.savedDropPx).toBe(14);
    expect(MOTION_MS.rateconDrop).toBe(270);
    expect(MOTION_SHAPE.rateconDropPx).toBe(14);
  });

  it('the palette’s results fade in 180ms', () => {
    expect(MOTION_MS.palResultsFade).toBe(180);
  });

  it('a tour step comes 28px in 270ms', () => {
    expect(MOTION_MS.tourStep).toBe(270);
    expect(MOTION_SHAPE.tourStepPx).toBe(28);
  });

  it('what only fades is linear', () => {
    expect(EASING.fade).toBe('linear');
  });
});

/**
 * §12.153. The small motions of phase 3bk, on History, Assignments and the login page, at the
 * demo's Bold, written out here so taking one back fails this until it is told.
 */
describe('the numbers of the pages’ small motions (§12.153)', () => {
  it('History’s rows draw in 450ms, a row in 180ms, with gaps of 30ms at most: not the board’s', () => {
    expect(MOTION_MS.histRowsDraw).toBe(450);
    expect(MOTION_MS.histRowsDrawRow).toBe(180);
    expect(MOTION_MS.histRowsDrawGapMax).toBe(30);
  });

  it('a folded day’s loads drop 14px in 270ms', () => {
    expect(MOTION_MS.histFoldDrop).toBe(270);
    expect(MOTION_SHAPE.histFoldDropPx).toBe(14);
  });

  it('Assignments’ rows draw in 450ms, a row in 180ms, with gaps of 30ms at most', () => {
    expect(MOTION_MS.asgRowsDraw).toBe(450);
    expect(MOTION_MS.asgRowsDrawRow).toBe(180);
    expect(MOTION_MS.asgRowsDrawGapMax).toBe(30);
  });

  it('a picked driver, the add form and “Saved” each drop 14px in 270ms', () => {
    expect(MOTION_MS.asgDriverDrop).toBe(270);
    expect(MOTION_SHAPE.asgDriverDropPx).toBe(14);
    expect(MOTION_MS.asgAddDrop).toBe(270);
    expect(MOTION_SHAPE.asgAddDropPx).toBe(14);
    expect(MOTION_MS.asgSavedDrop).toBe(270);
    expect(MOTION_SHAPE.asgSavedDropPx).toBe(14);
  });

  it('the login form comes up 16px from 92% in 330ms', () => {
    expect(MOTION_MS.loginFormIn).toBe(330);
    expect(MOTION_SHAPE.loginFormRisePx).toBe(16);
    expect(MOTION_SHAPE.loginFormFromScale).toBe(0.92);
  });

  it('a sign-in refusal drops 14px in 270ms', () => {
    expect(MOTION_MS.loginErrorDrop).toBe(270);
    expect(MOTION_SHAPE.loginErrorDropPx).toBe(14);
  });

  it('the board’s opening is left as it was: 500, 200, 35', () => {
    expect(MOTION_MS.boardOpen).toBe(500);
    expect(MOTION_MS.boardOpenRow).toBe(200);
    expect(MOTION_MS.boardOpenGapMax).toBe(35);
  });

  /**
   * The login form's is CSS, so Tailwind writes its keyframes from the tokens: the class it
   * makes is what the server's HTML carries. `translate` and `scale`, never `transform`, and
   * `backwards`, so nothing is left on the form once it lands.
   */
  it('the login form’s CSS animation: 330ms on the windows’ curve, backwards, up 16px from 92%', () => {
    const extend = tailwind.theme?.extend as {
      animation: Record<string, string>;
      keyframes: Record<string, unknown>;
    };
    expect(extend.animation['login-in']).toBe('login-in 330ms cubic-bezier(.22,.61,.36,1) backwards');
    expect(extend.keyframes['login-in']).toEqual({
      from: { opacity: '0', translate: '0 16px', scale: '0.92' },
      to: { opacity: '1', translate: '0 0', scale: '1' },
    });
  });
});
