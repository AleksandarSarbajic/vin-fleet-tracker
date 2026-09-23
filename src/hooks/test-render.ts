import { createElement, act as reactAct } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * A two-line hook harness, because the project renders with `react-dom/client`
 * directly rather than depending on a testing library (see FeedBanner.test).
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
  const render = (arg: A) =>
    reactAct(() => root.render(createElement(Probe, { arg })));
  render(initial as A);
  return { current: () => value, rerender: render };
}
