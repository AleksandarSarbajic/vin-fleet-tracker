// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §12.149. The two rules every Web Animation in the console is under. Real presses on
 * real rows are in `e2e/new-motion.spec.ts`; this is what `npm run check` holds.
 */

type Fake = {
  playState: string;
  currentTime: number | null;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  cancel: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
};

/**
 * As a real one behaves, where `hold` depends on it. After `cancel()` the time reads null,
 * `pause()` brings the animation back at its first frame, and setting a resolved time to
 * null throws. `e2e/new-motion.spec.ts` holds the same three facts against a real browser.
 */
function fakeAnimation(): Fake {
  const listeners = new Map<string, (() => void)[]>();
  let time: number | null = 40;
  const a: Fake = {
    playState: 'running',
    get currentTime() {
      return time;
    },
    set currentTime(to) {
      if (to === null && time !== null) {
        throw new TypeError('currentTime may not be changed from resolved to unresolved');
      }
      time = to;
    },
    pause: vi.fn(() => {
      time ??= 0;
      a.playState = 'paused';
    }),
    play: vi.fn(() => {
      a.playState = 'running';
    }),
    cancel: () => {
      time = null;
      a.playState = 'idle';
    },
    addEventListener: (type, listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    fire: (type) => (listeners.get(type) ?? []).forEach((l) => l()),
  };
  return a;
}

const reduced = (on: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on, media: query }));

const animating = () => {
  const made = fakeAnimation();
  const el = document.createElement('div');
  (el as unknown as { animate: unknown }).animate = vi.fn(() => made);
  return { el, made };
};

const pointer = (type: string, init: PointerEventInit = {}) =>
  window.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));

let motion: typeof import('./motion');

beforeEach(async () => {
  vi.resetModules();
  reduced(false);
  motion = await import('./motion');
});

afterEach(() => {
  pointer('pointerup');
  vi.unstubAllGlobals();
});

describe('reduced motion', () => {
  it('runs nothing, and says so', () => {
    reduced(true);
    const { el } = animating();
    expect(motion.play(el, [], { duration: 100 })).toBeNull();
    expect(el.animate).not.toHaveBeenCalled();
  });

  it('is read at the moment of asking, not once', () => {
    const { el } = animating();
    expect(motion.mayMove(el)).toBe(true);
    reduced(true);
    expect(motion.mayMove(el)).toBe(false);
  });

  it('where there are no Web Animations, nothing runs and nothing throws', () => {
    const el = document.createElement('div');
    (el as unknown as { animate: unknown }).animate = undefined;
    expect(motion.play(el, [], { duration: 100 })).toBeNull();
  });
});

describe('a press holds what is moving', () => {
  it('stops it at the time last drawn, not a frame later', () => {
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    made.currentTime = 73;
    pointer('pointerdown');
    expect(made.pause).toHaveBeenCalledTimes(1);
    // Setting the time is what settles a pending pause now. See `hold`.
    expect(made.currentTime).toBe(73);
    expect(made.playState).toBe('paused');
  });

  it.each(['pointerup', 'pointercancel'])('lets go on %s', (type) => {
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    pointer('pointerdown');
    pointer(type);
    expect(made.play).toHaveBeenCalledTimes(1);
  });

  it('lets go when a move says no button is down: a release nobody heard', () => {
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    pointer('pointerdown');
    pointer('pointermove', { buttons: 1 });
    expect(made.play).not.toHaveBeenCalled();
    pointer('pointermove', { buttons: 0 });
    expect(made.play).toHaveBeenCalledTimes(1);
  });

  it('lets go when the window loses focus', () => {
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    pointer('pointerdown');
    window.dispatchEvent(new Event('blur'));
    expect(made.play).toHaveBeenCalledTimes(1);
  });

  it('what starts during a press waits for it to end', () => {
    // With nothing having run yet: the first animation ever can start under a press.
    pointer('pointerdown');
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    expect(made.pause).toHaveBeenCalledTimes(1);
    pointer('pointerup');
    expect(made.play).toHaveBeenCalledTimes(1);
  });

  it('does not restart what ended while held', () => {
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    pointer('pointerdown');
    made.playState = 'finished';
    made.fire('finish');
    pointer('pointerup');
    expect(made.play).not.toHaveBeenCalled();
  });

  it('a second press does not touch what is over', () => {
    const { el, made } = animating();
    motion.play(el, [], { duration: 100 });
    made.fire('finish');
    pointer('pointerdown');
    expect(made.pause).not.toHaveBeenCalled();
  });
});

/**
 * After `cancel()` an animation stays in `moving` until its cancel event, a frame away at
 * most. A press can land in that gap: a chip mid-glide cancels every flight, and the main
 * thread is busy with that commit while the press waits behind it.
 */
describe('a press in the gap between a cancel and its cancel event', () => {
  const cancelThenOneStillMoving = () => {
    const gone = animating();
    const other = animating();
    motion.play(gone.el, [], { duration: 100 });
    motion.play(other.el, [], { duration: 100 });
    gone.made.cancel();
    return { gone: gone.made, other: other.made };
  };

  /** The press, with what it threw handed back, so each test here fails on its own claim. */
  const press = () => {
    const thrown: string[] = [];
    try {
      pointer('pointerdown');
    } catch (error) {
      thrown.push(String(error));
    }
    return thrown;
  };

  it('throws nothing', () => {
    cancelThenOneStillMoving();
    expect(press()).toEqual([]);
  });

  it('leaves the cancelled animation idle: it is not brought back at its first frame', () => {
    const { gone } = cancelThenOneStillMoving();
    press();
    expect(gone.playState).toBe('idle');
    expect(gone.currentTime).toBeNull();
  });

  it('still holds what is moving after it, and that resumes on the release', () => {
    const { other } = cancelThenOneStillMoving();
    press();
    expect(other.playState).toBe('paused');
    pointer('pointerup');
    expect(other.playState).toBe('running');
  });
});

describe('whenOver', () => {
  it.each(['finish', 'cancel'])('runs once on %s', (type) => {
    const { made } = animating();
    const then = vi.fn();
    motion.whenOver(made as unknown as Animation, then);
    made.fire(type);
    made.fire('finish');
    expect(then).toHaveBeenCalledTimes(1);
  });
});
