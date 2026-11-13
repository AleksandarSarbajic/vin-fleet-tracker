// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePinned } from './usePinned';
import { useDensity } from './useDensity';

/**
 * §12.159, rule 18: the two causes are counted where a person acts, and only there. Through a
 * component, not `renderHook`, so each act is one commit. The motions they start are
 * `console/board-large-motion.test.tsx`'s; this is what a stored value would start, where the
 * board's rows are not drawn yet in happy-dom to show it.
 */

const store = new Map<string, string>();
let root: Root;
let container: HTMLDivElement;
let pins: ReturnType<typeof usePinned>;
let density: ReturnType<typeof useDensity>;

function Probe({ selected }: { selected: string | null }) {
  pins = usePinned(selected);
  density = useDensity();
  return null;
}

beforeEach(() => {
  store.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (selected: string | null = null) =>
  act(() => root.render(createElement(Probe, { selected })));
const key = (k: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('the pin cause (§12.159)', () => {
  it('pins read from storage count nothing; a pin and an unpin count one each, with their truck', () => {
    store.set('ft.pinned', JSON.stringify(['a', 'b']));
    mount();
    expect(pins.pinned).toEqual(['a', 'b']);
    expect(pins.moved).toEqual({ count: 0, id: null });
    act(() => pins.toggle('c'));
    expect(pins.moved).toEqual({ count: 1, id: 'c' });
    act(() => pins.toggle('a'));
    expect(pins.moved).toEqual({ count: 2, id: 'a' });
    expect(pins.pinned).toEqual(['b', 'c']);
  });

  it('P on the selected truck counts one; the cap refusing counts nothing', () => {
    store.set('ft.pinned', JSON.stringify(['a', 'b', 'c', 'd']));
    mount('e');
    key('p');
    expect(pins.moved).toEqual({ count: 1, id: 'e' });
    act(() => pins.toggle('f'));
    expect(pins.refused).toBe(true);
    expect(pins.moved).toEqual({ count: 1, id: 'e' });
  });
});

describe('the density cause (§12.159)', () => {
  it('a stored density counts nothing; a change counts one; the density already chosen counts nothing', () => {
    store.set('ft.density', 'compact');
    mount();
    expect(density.density).toBe('compact');
    expect(density.moves).toBe(0);
    act(() => density.setDensity('compact'));
    expect(density.moves).toBe(0);
    act(() => density.setDensity('comfortable'));
    expect(density.moves).toBe(1);
    key('d');
    expect(density.density).toBe('compact');
    expect(density.moves).toBe(2);
    act(() => density.toggle());
    expect(density.moves).toBe(3);
  });
});
