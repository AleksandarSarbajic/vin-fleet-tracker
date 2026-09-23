// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, Toasts } from './Toasts';
import { MOTION_MS } from '@/design/tokens';
import type { StatusToast } from '@/lib/toast';

/**
 * §14 feature 14. The toast's motion and its new address.
 *
 * `ConsoleKeys.test.tsx` owns which toasts appear and when; this owns what
 * happens to one once it is there.
 */

const toast = (id: string, label: string): StatusToast => ({
  id,
  truckId: `truck-${id}`,
  truckLabel: label,
  status: 'LATE',
});

let container: HTMLDivElement;
let root: Root;

const render = (toasts: StatusToast[], onExpire = () => {}, reducedMotion = false) => {
  act(() => {
    root.render(
      <Toasts
        toasts={toasts}
        onOpen={() => {}}
        onExpire={onExpire}
        reducedMotion={reducedMotion}
      />,
    );
  });
};

const stack = () => container.querySelector('[role="status"]');
const boxes = () => [...container.querySelectorAll('[data-toast]')];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('where it sits (§14.5)', () => {
  /**
   * Bottom-left belongs to the bulk bar now. The replacement is the map's
   * top-right, and `absolute` rather than `fixed` is what makes that true:
   * the stack is positioned by the split area, so it stays over the visible
   * pane on a narrow screen instead of floating over the console header.
   */
  it('anchors to the top-right of its pane, not the window', () => {
    render([toast('a', '101')]);
    const className = stack()?.className ?? '';
    expect(className).toContain('absolute');
    expect(className).not.toContain('fixed');
    expect(className).toContain('right-4');
    expect(className).not.toContain('bottom-4');
  });

  /** `MapChrome` has held the map's top-right since phase 2. */
  it('starts below the zoom control rather than on top of it', () => {
    render([toast('a', '101')]);
    expect(stack()?.className).toContain('top-[76px]');
  });

  /**
   * The list is newest-first and the stack now grows DOWNWARD from a top
   * edge, so the newest belongs at the top. Reversed — which is what a
   * bottom-anchored stack needed — the newest would appear at the bottom and
   * push the older ones up, which is the one thing a stack of six-second
   * messages must not do.
   */
  it('grows downward, newest first', () => {
    render([toast('a', '101'), toast('b', '102')]);
    expect(stack()?.className).toContain('flex-col');
    expect(stack()?.className).not.toContain('flex-col-reverse');
    expect(boxes()[0]?.textContent).toContain('101');
  });
});

describe('how it arrives and leaves (§14.4)', () => {
  /**
   * Fake timers, so the suite does not spend twelve seconds waiting out two
   * six-second dwells. They are safe here because nothing nests `act` — that
   * is what breaks the flush, not the clock.
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('rises in on arrival', () => {
    render([toast('a', '101')]);
    expect(boxes()[0]?.className).toContain('animate-toast-in');
  });

  it('fades before it is taken away, not instead of it', () => {
    const onExpire = vi.fn();
    render([toast('a', '101')], onExpire);

    // Six seconds of dwell, then the fade begins.
    advance(TOAST_MS);
    expect(boxes()[0]?.className).toContain('animate-toast-out');
    // The parent has NOT been told yet — an unmounted element cannot fade.
    expect(onExpire).not.toHaveBeenCalled();

    advance(MOTION_MS.toastOut);
    expect(onExpire).toHaveBeenCalledWith('a');
  });

  it('skips the fade entirely under reduced motion', () => {
    const onExpire = vi.fn();
    render([toast('a', '101')], onExpire, true);
    expect(boxes()[0]?.className).not.toContain('animate-toast-in');

    advance(TOAST_MS);
    expect(onExpire).toHaveBeenCalledWith('a');
  });
});

describe('the cap', () => {
  it('shows three at most, however many are open', () => {
    render([toast('a', '1'), toast('b', '2'), toast('c', '3'), toast('d', '4')]);
    expect(boxes()).toHaveLength(3);
  });
});
