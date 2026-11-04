// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ListToolbar } from './ListToolbar';
import type { FleetHealth } from '@/server/health';

/**
 * Phase 3bc. The reorder bar's words and its click, and the strip giving way.
 * That no row moves for it is measured frame by frame in the browser, in
 * `e2e/dialog-motion.spec.ts`.
 */
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const HEALTH: FleetHealth = {
  day: '2026-11-04',
  onTime: 2,
  late: 1,
  unscheduled: 0,
  remaining: 4,
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const render = (drift: number, onResort: () => void = () => {}) =>
  act(() =>
    root!.render(
      createElement(ListToolbar, {
        density: 'comfortable',
        onDensity: () => {},
        health: HEALTH,
        drift,
        onResort,
      }),
    ),
  );

const bar = () =>
  Array.from(container!.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('reorder'),
  );

describe('the reorder bar (phase 3bc)', () => {
  it('is not there with nothing to re-sort', () => {
    render(0);
    expect(bar()).toBeUndefined();
  });

  it('says the same words, in the singular too', () => {
    render(1);
    expect(bar()!.textContent).toBe('1 row would reorder — click to sort');
    render(6);
    expect(bar()!.textContent).toBe('6 rows would reorder — click to sort');
  });

  it('clicking it re-sorts', () => {
    const onResort = vi.fn();
    render(3, onResort);
    act(() => bar()!.click());
    expect(onResort).toHaveBeenCalledTimes(1);
  });

  it('stands to the left of Density, which never gives way', () => {
    render(3);
    const density = bar()!.nextElementSibling!;
    expect(density.textContent).toContain('Density');
    expect(density.className).toContain('shrink-0');
  });

  it('the strip gives way only while the bar is up', () => {
    const strip = () => container!.querySelector<HTMLElement>('[title]')!;
    render(0);
    expect(strip().className).not.toContain('overflow-hidden');
    render(3);
    expect(strip().className).toContain('overflow-hidden');
  });
});

describe('the list has no offer of its own (phase 3bc)', () => {
  it('nothing in the scroller can push a row for it', () => {
    const list = readFileSync(join(__dirname, 'FleetList.tsx'), 'utf8');
    expect(list).not.toMatch(/reorder/);
    expect(list).not.toMatch(/\bdrift\b/);
    expect(list).not.toMatch(/onResort/);
  });
});
