// @vitest-environment happy-dom
import { createElement, useEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, HistoryRow, HistoryWeekView } from '@/lib/history';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.154, History and its address. The page opens on the week and the filter the address
 * holds, so Back and Forward, which draw it again from Next's cache with the props it was first
 * opened with, show the week it was left on. And it writes its address only once the router
 * has hooked `history.replaceState`, which the router does in an effect of its own, an
 * ancestor's, that React runs after the page's. Every name and number is invented.
 */

const nav = vi.hoisted(() => ({ address: '' }));
vi.mock('@/lib/page-arrival', () => ({ cameByPageChange: () => false, arrive: () => false }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.address),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children),
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => createElement('img', { alt }) }));

const { HistoryPage } = await import('./HistoryPage');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dow, i) => ({
  dow,
  date: 5 + i,
  month: 'Oct',
  iso: `2026-10-${String(5 + i).padStart(2, '0')}`,
  full: `${dow} Oct ${5 + i}`,
}));
const entry = (number: string): HistoryEntry => ({
  key: number,
  number,
  status: 'delivered',
  route: { pre: null, full: 'Joliet, IL → Gary, IN' },
  truck: null,
  tip: { title: `Load ${number}`, route: 'Joliet, IL → Gary, IN', stops: [], missing: null, meta: 'Truck 412' },
});
/** A driver with one load on Monday: a week with no loads draws its empty state, not its rows. */
const row = (name: string, i: number): HistoryRow => ({
  driverId: `d-${name}`,
  name,
  trucks: [{ label: '412', days: null, partial: false }],
  cells: DAYS.map((_, d) => ({ entries: d === 0 ? [entry(`VT-${i}`)] : [], noTruck: false })),
  loadCount: 1,
});
const view = (week: string, names: string[]): HistoryWeekView => ({
  week,
  range: '',
  days: DAYS,
  rows: names.map(row),
  notReached: [],
  noNumber: [],
  counts: { drivers: names.length, loads: names.length, notReached: 0 },
});
const FLEET: FleetResponse = {
  fleet: [],
  fetchedAt: '2026-10-08T15:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-10-08T14:59:30.000Z',
};
const WEEKS: Record<string, HistoryWeekView> = {
  '2026-W40': view('2026-W40', ['Ada Quill', 'Bo Reyes']),
  '2026-W41': view('2026-W41', ['Cy Tamm', 'Di Vance', 'Ed Wolfe']),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let asked: string[];

beforeEach(() => {
  nav.address = '';
  asked = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    const week = /week=([^&]+)/.exec(url)?.[1] ?? '';
    if (url.startsWith('/api/history')) asked.push(week);
    const body = url.startsWith('/api/history') ? (WEEKS[week] ?? view(week, [])) : FLEET;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
});

afterEach(() => {
  act(() => root?.unmount());
  client.clear();
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

/** History as the server answered for week 41 with no filter, under `wrap` (the router's stand-in). */
const openPage = async (wrap: (page: ReactNode) => ReactNode = (page) => page) => {
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        wrap(
          createElement(HistoryPage, {
            initialWeek: { year: 2026, week: 41 },
            initialView: WEEKS['2026-W41']!,
            initialQ: '',
            initialFleet: FLEET,
            listIds: [],
            dispatchTz: 'America/Chicago',
            user: { fullName: 'Rae Ostrom', email: 'rae@example.test', role: 'dispatcher' },
          }),
        ),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const range = () => container!.querySelector('[data-week-range]')?.textContent;
const names = () => [...container!.querySelectorAll('main [data-driver-row]')].map((r) => r.getAttribute('data-driver-row'));
const filterBox = () => container!.querySelector<HTMLInputElement>('[data-history-toolbar] input[aria-label="Filter drivers"]');

describe('the week and the filter come from the address', () => {
  it('Back to a week the page was left on: that week, not the one the server first answered', async () => {
    nav.address = 'week=2026-W40';
    await openPage();
    expect(range()).toBe('Sep 28 – Oct 4, 2026');
    expect(asked).toEqual(['2026-W40']);
    expect(names()).toEqual(['Ada Quill', 'Bo Reyes']);
  });

  it('and its filter', async () => {
    nav.address = 'week=2026-W41&q=di';
    await openPage();
    expect(filterBox()?.value).toBe('di');
    expect(names()).toEqual(['Di Vance']);
  });

  it('the server’s week, at once, when the address holds that week, none, or one that is not a week', async () => {
    for (const address of ['week=2026-W41', '', 'week=2026-W99', 'week=soon']) {
      nav.address = address;
      await openPage();
      expect(range(), address).toBe('Oct 5 – 11, 2026');
      expect(names(), address).toEqual(['Cy Tamm', 'Di Vance', 'Ed Wolfe']);
      act(() => root?.unmount());
      root = createRoot(container!);
    }
    expect(asked).toEqual([]);
  });
});

describe('the address is written once the router has hooked replaceState', () => {
  /** Next's router in small: it hooks `replaceState` in its own effect, which runs after the page's. */
  const hookedBy = (seen: string[]) =>
    function RouterLike({ children }: { children: ReactNode }) {
      useEffect(() => {
        const unhooked = window.history.replaceState;
        window.history.replaceState = function hooked(data, unused, url) {
          seen.push(String(url));
          return unhooked.call(window.history, data, unused, url);
        };
        // Leaves nothing of its own behind, or the next test's spy on the browser's is passed by.
        return () => void Reflect.deleteProperty(window.history, 'replaceState');
      }, []);
      return children;
    };

  it('on the page a load lands on: through the hook, never around it', async () => {
    const seen: string[] = [];
    const browser = vi.spyOn(History.prototype, 'replaceState');
    const RouterLike = hookedBy(seen);
    await openPage((page) => createElement(RouterLike, null, page));
    expect(seen).toEqual(['/history?week=2026-W41']);
    expect(browser.mock.calls.map((c) => String(c[2]))).toEqual(seen);
  });

  it('a week and a filter: the address follows each, the last one last', async () => {
    const seen: string[] = [];
    const RouterLike = hookedBy(seen);
    await openPage((page) => createElement(RouterLike, null, page));
    const previous = container!.querySelector<HTMLButtonElement>('button[aria-label="Previous week"]')!;
    await act(async () => {
      previous.click();
    });
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(filterBox()!, ' ada ');
      filterBox()!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(seen).toEqual(['/history?week=2026-W41', '/history?week=2026-W40', '/history?week=2026-W40&q=ada']);
  });

  it('two weeks in one task, each its own commit: only the last is written, never the one it replaced', async () => {
    const seen: string[] = [];
    const RouterLike = hookedBy(seen);
    await openPage((page) => createElement(RouterLike, null, page));
    seen.length = 0;
    const previous = container!.querySelector<HTMLButtonElement>('button[aria-label="Previous week"]')!;
    await act(async () => {
      flushSync(() => previous.click());
      flushSync(() => previous.click());
    });
    expect(seen).toEqual(['/history?week=2026-W39']);
  });

  it('a write still waiting when the page goes is dropped: nothing after the page is gone', async () => {
    const seen: string[] = [];
    // The browser's own, under the hook: the hook goes with the page, so a late write passes it by.
    const browser = vi.spyOn(History.prototype, 'replaceState');
    const RouterLike = hookedBy(seen);
    await openPage((page) => createElement(RouterLike, null, page));
    browser.mockClear();
    const previous = container!.querySelector<HTMLButtonElement>('button[aria-label="Previous week"]')!;
    await act(async () => {
      flushSync(() => previous.click());
      root!.unmount();
    });
    root = null;
    expect(browser).not.toHaveBeenCalled();
  });
});
