import { createElement, act as reactAct } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * A two-line hook harness, because the project renders with `react-dom/client`
 * directly rather than depending on a testing library (see FeedBanner.test).
 *
 * **`rerender` already wraps itself in `act`.** Calling it inside another
 * `act(...)` swallows the flush: the effect runs and the state updates, but
 * the probe never re-renders, so `current()` hands back the value from before
 * the change — or `undefined` if it was the first one. Use bare `rerender`,
 * and keep `act` for the things that are not renders: firing a returned
 * callback, or advancing timers.
 */
export const act = reactAct;

export function renderHook<A, T>(
  hook: (arg: A) => T,
  initial?: A,
): { current: () => T; rerender: (arg: A) => void } {
  let value: T;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const Probe = ({ arg }: { arg: A }) => {
    value = hook(arg);
    return null;
  };
  const render = (arg: A) => reactAct(() => root.render(createElement(Probe, { arg })));
  render(initial as A);
  return { current: () => value, rerender: render };
}
