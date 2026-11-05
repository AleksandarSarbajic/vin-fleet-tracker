/**
 * §12.149. Everything that moves by Web Animations goes through here, for the two
 * rules a call site could forget:
 *
 * 1. **Reduced motion.** `globals.css`'s rule cannot reach a Web Animation, so
 *    under `prefers-reduced-motion` `play` returns null and nothing runs. Each caller
 *    does what it would have done at the end, at once. `reduced-motion-rule.test.ts`
 *    fails on any `.animate(` anywhere else.
 * 2. **A press holds what is moving.** Whatever is moving stops where it is drawn
 *    from the instant a pointer comes down until it comes up, so that what the pointer
 *    came down on is still there when it comes up. The browser sends a click to what
 *    the press and the release have in common: move a row between them and the click
 *    goes to the list, or to the row that took its place.
 */

/**
 * Read at the moment it matters, not through `useReducedMotion`: that hook learns
 * the preference in a passive effect, after a layout effect has already decided
 * whether to animate.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Whether this element may move now. False too where there are no Web Animations. */
export function mayMove(el: Element): boolean {
  return !prefersReducedMotion() && typeof el.animate === 'function';
}

const moving = new Set<Animation>();
const held = new Set<Animation>();
let pressed = false;

/**
 * Stops it on the frame last drawn, not the next. `pause()` alone waits for the next
 * frame to take effect, and on that frame a row can move out from under a press that
 * has already come down. Setting the time settles it now (Web Animations: "silently
 * set the current time" cancels a pending pause).
 */
function hold(animation: Animation): void {
  const at = animation.currentTime;
  animation.pause();
  animation.currentTime = at;
  held.add(animation);
}

function letGo(): void {
  pressed = false;
  for (const animation of held) {
    if (animation.playState === 'paused') animation.play();
  }
  held.clear();
}

/**
 * From the start and not from the first animation: a press already down when the first
 * one ever starts has to be known about, or that one runs on under it.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      pressed = true;
      for (const animation of moving) hold(animation);
    },
    true,
  );
  window.addEventListener('pointerup', letGo, true);
  window.addEventListener('pointercancel', letGo, true);
  window.addEventListener('blur', letGo);
  // A release the page never heard: outside the window, or on a scrollbar.
  window.addEventListener(
    'pointermove',
    (event) => {
      if (pressed && event.buttons === 0) letGo();
    },
    true,
  );
}

/**
 * Runs a Web Animation under both rules, or returns null if nothing may move. It
 * leaves nothing behind: no fill past its end, so the element's own style takes over.
 */
export function play(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!mayMove(el)) return null;
  const animation = el.animate(keyframes, options);
  moving.add(animation);
  const drop = () => {
    moving.delete(animation);
    held.delete(animation);
  };
  animation.addEventListener('finish', drop);
  animation.addEventListener('cancel', drop);
  if (pressed) hold(animation);
  return animation;
}

/** Runs `then` once when the animation is over, however it ended. */
export function whenOver(animation: Animation, then: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    then();
  };
  animation.addEventListener('finish', once);
  animation.addEventListener('cancel', once);
}

/**
 * Takes an element's inline style off, attribute and all. Blink writes an inline style
 * out to the attribute only when something asks: remove the attribute before that and
 * it empties the style and leaves `style=""` behind. Asking first makes it a real removal.
 */
export function clearStyle(el: Element): void {
  el.getAttribute('style');
  el.removeAttribute('style');
}

const MOVEMENT = new Set(['transform', '--press', '--lift']);

/**
 * Makes a change of look land now rather than over the element's own transition: a
 * ground fading out behind a highlight that has already left would be seen twice. A
 * press letting go is left alone.
 */
export function settleLook(el: Element): void {
  void getComputedStyle(el).backgroundColor;
  for (const animation of el.getAnimations()) {
    if (animation instanceof CSSTransition && !MOVEMENT.has(animation.transitionProperty)) {
      animation.finish();
    }
  }
}
