// @vitest-environment happy-dom
import { StrictMode, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChipFilters } from './useChipFilters';
import type { FilterKey } from './FilterChips';

/**
 * §12.29. The bug this exists for passed typecheck, lint and 333 tests:
 * `syncUrl` was called INSIDE the `setChips` updater, so `router.replace`
 * ran during React's render phase instead of from the click.
 *
 * ## How this catches it without a real Router
 *
 * StrictMode double-invokes state updater functions on purpose, precisely to
 * surface side effects hiding in them. A pure updater is called twice and
 * nothing outside it notices. An updater that calls `syncUrl` writes the URL
 * **twice per click** — which is observable as a call count, with no Router
 * and no warning-string matching.
 *
 * So the assertion is exactly one URL write per toggle. That is both the
 * correct behaviour and the bug's fingerprint.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root && container) {
    const r = root;
    act(() => r.unmount());
    container.remove();
  }
  root = null;
  container = null;
});

interface Harness {
  toggle: (key: FilterKey) => void;
  reset: () => void;
  chips: () => FilterKey[];
  /** How many times the component rendered — StrictMode doubles this. */
  renders: () => number;
}

function mount(
  syncUrl: (next: { chips: FilterKey[] }) => void,
  initial: string[] = [],
): Harness {
  let api: ReturnType<typeof useChipFilters> | null = null;
  let renderCount = 0;

  function Probe() {
    const renders = useRef(0);
    renders.current += 1;
    renderCount += 1;
    api = useChipFilters(initial, syncUrl);
    return null;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  act(() => r.render(createElement(StrictMode, null, createElement(Probe))));

  return {
    toggle: (key) => act(() => api!.toggleChip(key)),
    reset: () => act(() => api!.resetChips()),
    chips: () => [...api!.chips],
    renders: () => renderCount,
  };
}

describe('the chips write the URL from the click, not the render (§12.29)', () => {
  it('writes nothing to the URL just by rendering', () => {
    const syncUrl = vi.fn();
    const harness = mount(syncUrl);
    // Rendering is not a user action. Mounting the console must not rewrite
    // the address bar.
    expect(syncUrl).not.toHaveBeenCalled();
    expect(harness.renders()).toBeGreaterThan(0);
  });

  /**
   * The regression test. With `syncUrl` inside the `setChips` updater this
   * fails with 2 calls, because StrictMode invokes the updater twice.
   */
  it('writes the URL exactly ONCE per click', () => {
    const syncUrl = vi.fn();
    const harness = mount(syncUrl);

    harness.toggle('late');

    expect(syncUrl).toHaveBeenCalledTimes(1);
    expect(syncUrl).toHaveBeenCalledWith({ chips: ['late'] });
    expect(harness.chips()).toEqual(['late']);
  });

  it('still writes once when toggling a chip off', () => {
    const syncUrl = vi.fn();
    const harness = mount(syncUrl, ['late']);

    harness.toggle('late');

    expect(syncUrl).toHaveBeenCalledTimes(1);
    expect(syncUrl).toHaveBeenCalledWith({ chips: [] });
    expect(harness.chips()).toEqual([]);
  });

  it('accumulates chips across clicks, one write each', () => {
    const syncUrl = vi.fn();
    const harness = mount(syncUrl);

    harness.toggle('late');
    harness.toggle('risk');

    expect(syncUrl).toHaveBeenCalledTimes(2);
    expect(syncUrl).toHaveBeenLastCalledWith({ chips: ['late', 'risk'] });
    expect(harness.chips()).toEqual(['late', 'risk']);
  });

  it('resets in one write', () => {
    const syncUrl = vi.fn();
    const harness = mount(syncUrl, ['late', 'risk']);

    harness.reset();

    expect(syncUrl).toHaveBeenCalledTimes(1);
    expect(syncUrl).toHaveBeenCalledWith({ chips: [] });
    expect(harness.chips()).toEqual([]);
  });

  it('ignores a chip key that is not one of ours', () => {
    const syncUrl = vi.fn();
    const harness = mount(syncUrl, ['late', 'not-a-real-chip']);
    expect(harness.chips()).toEqual(['late']);
    expect(syncUrl).not.toHaveBeenCalled();
  });
});
