/**
 * §12.152. A recorder for Web Animations in happy-dom, where `vitest.setup.ts` takes
 * `animate()` away (its animations never finish). Every call is kept with its element,
 * keyframes and options, and each animation finishes or cancels when the test says so, as a
 * real one does: its listeners hear it. Real timing is `e2e/new-motion.spec.ts`'s.
 */

export type FakeAnimation = {
  currentTime: number | null;
  playState: 'running' | 'paused' | 'finished' | 'idle';
  pause: () => void;
  play: () => void;
  cancel: () => void;
  finish: () => void;
  addEventListener: (type: string, listener: () => void) => void;
};

export type Played = {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: FakeAnimation;
};

function fakeAnimation(): FakeAnimation {
  const listeners = new Map<string, (() => void)[]>();
  const fire = (type: string) => (listeners.get(type) ?? []).forEach((listener) => listener());
  const animation: FakeAnimation = {
    currentTime: 0,
    playState: 'running',
    pause: () => {
      animation.playState = 'paused';
    },
    play: () => {
      animation.playState = 'running';
    },
    cancel: () => {
      if (animation.playState === 'idle' || animation.playState === 'finished') return;
      animation.currentTime = null;
      animation.playState = 'idle';
      fire('cancel');
    },
    finish: () => {
      if (animation.playState === 'idle' || animation.playState === 'finished') return;
      animation.playState = 'finished';
      fire('finish');
    },
    addEventListener: (type, listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  return animation;
}

export function recordAnimations() {
  const played: Played[] = [];
  const before = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = fakeAnimation();
      played.push({ el: this, keyframes, options, animation });
      return animation;
    },
  });
  return {
    played,
    /** Every animation still running, ended as a real one ends: so what it added goes. */
    finishAll: () => played.forEach((p) => p.animation.finish()),
    restore: () => {
      if (before) Object.defineProperty(Element.prototype, 'animate', before);
    },
  };
}

/** Under `prefers-reduced-motion: reduce`, and every other query as it was. */
export function reduceMotion(): () => void {
  const real = window.matchMedia;
  window.matchMedia = (query: string) => {
    if (!query.includes('prefers-reduced-motion')) return real.call(window, query);
    return {
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
  return () => {
    window.matchMedia = real;
  };
}
