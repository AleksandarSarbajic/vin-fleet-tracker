// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { recordAnimations } from '@/test/animations';
import type { FleetResponse } from '@/hooks/useFleet';
import { TOUR_STORAGE_KEY, TOUR_VERSION } from '@/lib/tour';

/**
 * §12.159: "To take one back: one line in `tokens.ts`". With `pinGlide` and `densityGlide` at 0
 * a pin and a density change play nothing and measure nothing: no row's host is asked where it
 * is drawn. The tokens are taken back here, for this file only.
 */

vi.mock('@/design/tokens', async (original) => {
  const tokens = await original<typeof import('@/design/tokens')>();
  return { ...tokens, MOTION_MS: { ...tokens.MOTION_MS, pinGlide: 0, densityGlide: 0 } };
});
vi.mock('./map/FleetMap', () => ({
  FleetMap: () => createElement('div', { 'data-testid': 'map' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { Console } = await import('./Console');

const idOf = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const truck = (n: number) =>
  fleetRow({
    id: idOf(n),
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    driverName: 'Sam',
    status: 'ON_TIME',
    computed: 'ON_TIME',
    nextStop: nextStop({ stopId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001` }),
  });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};
let recorder: ReturnType<typeof recordAnimations>;
const store = new Map<string, string>();
/** Every box read on a row's host: a pinned host or a list row's wrapper. */
let hostReads = 0;

const isHost = (el: Element) =>
  el.hasAttribute('data-pinned-host') ||
  (el.firstElementChild?.hasAttribute('data-row-id') === true &&
    el.parentElement?.parentElement?.hasAttribute('data-board-rows') === true);

beforeEach(() => {
  store.clear();
  store.set(TOUR_STORAGE_KEY, String(TOUR_VERSION));
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
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  const stubbed = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function counted(this: Element): DOMRect {
    if (isHost(this)) hostReads += 1;
    return stubbed.call(this);
  };
  const unstub = restoreLayout;
  restoreLayout = () => {
    Element.prototype.getBoundingClientRect = stubbed;
    unstub();
  };
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
  recorder.restore();
  root = null;
  container = null;
});

const render = async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const answer: FleetResponse = {
    fleet: [truck(101), truck(202), truck(303), truck(404)],
    fetchedAt: '2026-09-18T12:00:00.000Z',
    feedStale: false,
    feedNewestAt: '2026-09-18T12:00:00.000Z',
  };
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: answer,
          initialHealth: fleetHealth(),
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
          initialQuery: '',
          initialTruck: null,
          initialChips: [],
          drivers: [],
          role: 'admin' as const,
        }),
      ),
    );
  });
  act(() => recorder.finishAll());
  recorder.played.length = 0;
  hostReads = 0;
};
const untilShown = async (what: string, shown: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!shown()) {
    if (Date.now() > deadline) throw new Error(`not shown within ${timeoutMs}ms: ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
const rowEl = (n: number) => container!.querySelector<HTMLElement>(`[data-row-id="${idOf(n)}"]`)!;

describe('the two tokens at 0 (§12.159)', () => {
  it('a pin, an unpin and two density changes play nothing and read no row’s place', async () => {
    await render();
    await act(async () => rowEl(303).querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
    await untilShown('303 pinned', () => container!.querySelectorAll('[data-pinned-host]').length === 1);
    await act(async () => rowEl(303).querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
    await untilShown('303 unpinned', () => container!.querySelectorAll('[data-pinned-host]').length === 0);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    await untilShown('compact rows', () => rowEl(101).style.height === '32px');
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });
    await untilShown('comfortable rows', () => rowEl(101).style.height === '44px');
    // The Density control's own highlight still slides (§12.149's, not these): nothing on a row or a star.
    expect(recorder.played.filter((p) => isHost(p.el) || p.el.tagName.toLowerCase() === 'svg')).toEqual([]);
    expect(recorder.played.map((p) => p.options.duration)).toEqual([260, 260]);
    expect(hostReads).toBe(0);
    expect(container!.querySelector('[data-board-rows]')!.getAttribute('style')).toBeNull();
  });
});
