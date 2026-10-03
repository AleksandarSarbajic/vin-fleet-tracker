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
/** The width the observer reports first; `observed` reports a new one. */
let observedWidth = 900;
let observed: ((width: number) => void) | null = null;
const store = new Map<string, string>();

beforeEach(() => {
  // Measured at 900px: under 1086, so the toggle layout.
  observedWidth = 900;
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      observed = (width) =>
        this.callback(
          [{ contentRect: { width } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      observed(observedWidth);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  store.clear();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
    configurable: true,
  });
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

/**
 * §12.105. The 768–1085 choice is remembered per browser, and the switch from
 * the server's split to the measured toggle rebuilds nothing.
 */
describe('the toggle remembers, and the layout switch keeps both panes', () => {
  it('opens on the map when nothing is stored', () => {
    render('list');
    expect(toggle().textContent).toBe('Hide map');
    expect(pane('list')).toContain('md:hidden');
  });

  it('opens on the list when the list was chosen last time', () => {
    store.set('ft.narrowPane', 'list');
    render('list');
    expect(toggle().textContent).toBe('Show map');
    expect(pane('list')).not.toContain('md:hidden');
    expect(pane('map')).toContain('md:hidden');
  });

  it('stores each click', () => {
    render('list');
    act(() => toggle().click());
    expect(store.get('ft.narrowPane')).toBe('list');
    act(() => toggle().click());
    expect(store.get('ft.narrowPane')).toBe('map');
  });

  it('ignores anything else in storage', () => {
    store.set('ft.narrowPane', 'sideways');
    render('list');
    expect(toggle().textContent).toBe('Hide map');
  });

  it("leaves the phone's tabs alone: list first whatever is stored", () => {
    store.set('ft.narrowPane', 'map');
    render('list');
    expect(pane('list')).not.toContain('max-md:hidden');
    expect(pane('map')).toContain('max-md:hidden');
  });

  it('switching from the split to the toggle keeps the same list and map elements', () => {
    observedWidth = 1400;
    render('list');
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
    expect(pane('list')).toEqual(['contents']);
    const list = container.querySelector('[data-list]');
    const map = container.querySelector('[data-map]');
    act(() => observed!(900));
    expect(container.querySelector('[role="separator"]')).toBeNull();
    expect(toggle().textContent).toBe('Hide map');
    expect(container.querySelector('[data-list]')).toBe(list);
    expect(container.querySelector('[data-map]')).toBe(map);
    act(() => observed!(1400));
    expect(container.querySelector('[data-list]')).toBe(list);
    expect(container.querySelector('[data-map]')).toBe(map);
  });
});
