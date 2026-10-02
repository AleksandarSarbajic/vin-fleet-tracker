// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Split } from './Split';

/**
 * §12.96, stage 2. Below 1086px the split is a toggle, and both panes stay
 * MOUNTED: the toggle used to render one or the other, so every switch threw
 * the map away and built a new one. CSS hides one now — the desktop toggle's
 * rule at 768px and up (`md:`), the phone tab's below (`max-md:`).
 */

let root: Root;
let container: HTMLDivElement;
const realObserver = globalThis.ResizeObserver;

beforeEach(() => {
  // Measured at 900px: under 1086, so the toggle layout.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback(
        [{ contentRect: { width: 900 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.ResizeObserver = realObserver;
});

function render(phonePane: 'list' | 'map', onResizeEnd = vi.fn()) {
  act(() => {
    root.render(
      <Split
        list={<p data-list="">list</p>}
        map={<p data-map="">map</p>}
        onResizeEnd={onResizeEnd}
        phonePane={phonePane}
      />,
    );
  });
  return onResizeEnd;
}

const pane = (name: string) =>
  container.querySelector(`[data-pane="${name}"]`)!.className.split(/\s+/);
const toggle = () =>
  [...container.querySelectorAll('button')].find((b) => /map$/.test(b.textContent ?? ''))!;

describe('below 1086px', () => {
  it('mounts both panes; the desktop toggle shows the map first, the phone the list', () => {
    render('list');
    expect(container.querySelector('[data-map]')).not.toBeNull();
    expect(container.querySelector('[data-list]')).not.toBeNull();
    // 768px and up: the map, the list hidden.
    expect(pane('map')).not.toContain('md:hidden');
    expect(pane('list')).toContain('md:hidden');
    // Below 768px: the list, the map hidden.
    expect(pane('list')).not.toContain('max-md:hidden');
    expect(pane('map')).toContain('max-md:hidden');
  });

  it('the toggle swaps them without unmounting the map, and asks it to measure', () => {
    const onResizeEnd = render('list');
    const map = container.querySelector('[data-map]');
    act(() => toggle().click()); // Hide map
    expect(pane('map')).toContain('md:hidden');
    expect(pane('list')).not.toContain('md:hidden');
    expect(onResizeEnd).not.toHaveBeenCalled();
    act(() => toggle().click()); // Show map
    expect(container.querySelector('[data-map]')).toBe(map);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it("the phone's Map tab shows the map, the same one", () => {
    render('list');
    const map = container.querySelector('[data-map]');
    render('map');
    expect(pane('map')).not.toContain('max-md:hidden');
    expect(pane('list')).toContain('max-md:hidden');
    expect(container.querySelector('[data-map]')).toBe(map);
  });

  it('the desktop toggle is not drawn on a phone', () => {
    render('list');
    expect(toggle().className.split(/\s+/)).toContain('max-md:hidden');
  });
});
