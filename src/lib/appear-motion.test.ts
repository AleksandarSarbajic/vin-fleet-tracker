// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAnimations, reduceMotion } from '@/test/animations';
import { GROUND_HOST, GROUND_POP, drawIn, dropIn, dropOn, fadeIn, groundPop, popIn, slideIn } from './appear-motion';

/**
 * §12.152. The shapes the small motions are made of. Every number is written out: a test
 * that read the token would pass whatever the token said. The components' own tests hold
 * what starts each one; `e2e/new-motion.spec.ts` holds them in a real browser.
 */

let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;

beforeEach(() => {
  recorder = recordAnimations();
});

afterEach(() => {
  recorder.restore();
  unreduce?.();
  unreduce = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const el = () => document.body.appendChild(document.createElement('div'));

describe('the shapes', () => {
  it('a drop comes 14px down from above and fades in, on the windows’ curve', () => {
    const box = el();
    dropIn(box, 270, 14);
    expect(recorder.played).toHaveLength(1);
    expect(recorder.played[0]!.el).toBe(box);
    expect(recorder.played[0]!.keyframes).toEqual([
      { opacity: 0, translate: '0 -14px' },
      { opacity: 1, translate: '0 0' },
    ]);
    expect(recorder.played[0]!.options).toEqual({
      duration: 270,
      easing: 'cubic-bezier(.22,.61,.36,1)',
    });
  });

  it('a fade is opacity alone, linear: no translate, no scale, no transform', () => {
    fadeIn(el(), 270);
    expect(recorder.played[0]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(recorder.played[0]!.options).toEqual({ duration: 270, easing: 'linear' });
  });

  it('a pop grows from 50% and fades in', () => {
    popIn(el(), 270, 0.5);
    expect(recorder.played[0]!.keyframes).toEqual([
      { opacity: 0, scale: '0.5' },
      { opacity: 1, scale: '1' },
    ]);
    expect(recorder.played[0]!.options).toEqual({
      duration: 270,
      easing: 'cubic-bezier(.22,.61,.36,1)',
    });
  });

  it('a slide comes 28px from the side and clips its box sideways until the last lands', () => {
    const box = el();
    const first = box.appendChild(document.createElement('div'));
    const second = box.appendChild(document.createElement('div'));
    slideIn(first, box, 270, 28);
    slideIn(second, box, 270, -28);
    expect(recorder.played.map((p) => p.keyframes[0])).toEqual([
      { opacity: 0, translate: '28px 0' },
      { opacity: 0, translate: '-28px 0' },
    ]);
    expect(box.style.overflowX).toBe('clip');
    recorder.played[0]!.animation.cancel();
    expect(box.style.overflowX).toBe('clip');
    recorder.played[1]!.animation.finish();
    expect(box.getAttribute('style')).toBeNull();
  });

  it('no shape uses `transform`, so none overrides a press, a lift or a copy button’s place', () => {
    dropIn(el(), 270, 14);
    fadeIn(el(), 270);
    popIn(el(), 270, 0.5);
    slideIn(el(), el(), 270, 28);
    expect(recorder.played).toHaveLength(4);
    for (const { keyframes } of recorder.played) {
      expect(keyframes.at(-1)).toMatchObject({ opacity: 1 });
      expect(keyframes.every((k) => !('transform' in k))).toBe(true);
    }
  });
});

describe('taken back, or reduced', () => {
  it('a duration of 0 runs nothing, for every shape', () => {
    const host = el();
    expect(dropIn(el(), 0, 14)).toBeNull();
    expect(fadeIn(el(), 0)).toBeNull();
    expect(popIn(el(), 0, 0.5)).toBeNull();
    expect(slideIn(el(), el(), 0, 28)).toBeNull();
    groundPop(host, true, 0, 0.75);
    expect(recorder.played).toEqual([]);
    expect(host.querySelector(`[${GROUND_POP}]`)).toBeNull();
  });

  it('reduced motion starts nothing and adds nothing', () => {
    unreduce = reduceMotion();
    const host = el();
    expect(dropIn(el(), 270, 14)).toBeNull();
    expect(fadeIn(el(), 270)).toBeNull();
    expect(popIn(el(), 270, 0.5)).toBeNull();
    expect(slideIn(el(), el(), 270, 28)).toBeNull();
    groundPop(host, true, 270, 0.75);
    expect(recorder.played).toEqual([]);
    expect(host.innerHTML).toBe('');
    expect(host.hasAttribute(GROUND_HOST)).toBe(false);
  });
});

describe('a chip’s look (groundPop)', () => {
  it('arriving: an overlay grows in from 75%, the chip’s own look held back, and all of it goes on landing', () => {
    const chip = el();
    groundPop(chip, true, 270, 0.75);
    const look = chip.querySelector(`[${GROUND_POP}]`)!;
    expect(look.getAttribute('aria-hidden')).toBe('true');
    expect(chip.hasAttribute(GROUND_HOST)).toBe(true);
    expect(recorder.played[0]!.el).toBe(look);
    expect(recorder.played[0]!.keyframes).toEqual([
      { opacity: 0, scale: '0.75' },
      { opacity: 1, scale: '1' },
    ]);
    expect(recorder.played[0]!.options.duration).toBe(270);
    recorder.finishAll();
    expect(chip.outerHTML).toBe('<div></div>');
  });

  it('leaving: the same overlay shrinks away to 75%', () => {
    groundPop(el(), false, 270, 0.75);
    expect(recorder.played[0]!.keyframes).toEqual([
      { opacity: 1, scale: '1' },
      { opacity: 0, scale: '0.75' },
    ]);
  });

  it('a second change mid-way: one overlay, and the chip held back until the last one lands', () => {
    const chip = el();
    groundPop(chip, true, 270, 0.75);
    groundPop(chip, false, 270, 0.75);
    expect(chip.querySelectorAll(`[${GROUND_POP}]`)).toHaveLength(1);
    recorder.played[0]!.animation.finish();
    expect(chip.hasAttribute(GROUND_HOST)).toBe(true);
    recorder.played[1]!.animation.finish();
    expect(chip.outerHTML).toBe('<div></div>');
  });
});

describe('a drop carried on (dropOn)', () => {
  it('starts where the last one stood, 100ms in', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_100);
    const animation = dropOn(el(), 270, 14, { at: 1_000 });
    expect(animation?.currentTime).toBe(100);
    expect(recorder.played[0]!.options.duration).toBe(270);
  });

  it('past its end, plays nothing: the strip is simply there', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_270);
    expect(dropOn(el(), 270, 14, { at: 1_000 })).toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

/** §12.153. A box at `top`, `height` tall: happy-dom lays nothing out. */
const placed = (top: number, height = 50) => {
  const box = el();
  box.getBoundingClientRect = () => new DOMRect(0, top, 400, height);
  return box;
};

describe('a page’s rows drawing in (§12.153)', () => {
  it('each row in view fades in for 180ms, one after the other, linear, held at nothing until its turn', () => {
    const scroller = placed(0, 600);
    const rows = [placed(0), placed(50), placed(100)];
    drawIn(rows, scroller, 450, 180, 30);
    expect(recorder.played.map((p) => p.el)).toEqual(rows);
    for (const p of recorder.played) {
      expect(p.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    }
    expect(recorder.played.map((p) => p.options)).toEqual([
      { duration: 180, delay: 0, easing: 'linear', fill: 'backwards' },
      { duration: 180, delay: 30, easing: 'linear', fill: 'backwards' },
      { duration: 180, delay: 60, easing: 'linear', fill: 'backwards' },
    ]);
  });

  it('many rows in view share what is left of 450ms: the last one starts at 270 and ends at 450', () => {
    const scroller = placed(0, 600);
    const rows = Array.from({ length: 12 }, (_, i) => placed(i * 50));
    drawIn(rows, scroller, 450, 180, 30);
    expect(recorder.played).toHaveLength(12);
    expect(recorder.played.at(-1)!.options.delay).toBeCloseTo(270, 6);
    expect(recorder.played[1]!.options.delay).toBeCloseTo(270 / 11, 6);
  });

  it('rows above or below the view are left alone, and are simply there', () => {
    const scroller = placed(100, 200);
    const above = placed(0, 100);
    const seen = placed(150);
    const below = placed(300);
    drawIn([above, seen, below], scroller, 450, 180, 30);
    expect(recorder.played.map((p) => p.el)).toEqual([seen]);
  });

  it('taken back (0): nothing plays', () => {
    expect(drawIn([placed(0)], placed(0, 600), 0, 180, 30)).toEqual([]);
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion nothing plays', () => {
    unreduce = reduceMotion();
    expect(drawIn([placed(0), placed(50)], placed(0, 600), 450, 180, 30)).toEqual([]);
    expect(recorder.played).toEqual([]);
  });
});
