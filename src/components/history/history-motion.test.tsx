// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { HistoryEntry, HistoryRow, HistoryWeekView } from '@/lib/history';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.153, Driver history's two small motions: the rows in view drawing in when a change of
 * page opens it, and a folded day's loads dropping in on "+N more". Each starts on its cause,
 * at its own length written out, and on nothing else: not the page a load lands on, not a
 * filter, a week or a re-render. Every name and number is invented.
 */

const arrival = vi.hoisted(() => ({ byChange: true }));
vi.mock('@/lib/page-arrival', () => ({ cameByPageChange: () => arrival.byChange, arrive: () => true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => createElement('img', { alt }) }));

const { HistoryPage } = await import('./HistoryPage');
const { HistoryTable } = await import('./HistoryTable');

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

const row = (name: string, loadsOnMonday: string[]): HistoryRow => ({
  driverId: `d-${name}`,
  name,
  trucks: [{ label: '412', days: null, partial: false }],
  cells: DAYS.map((_, i) => ({ entries: i === 0 ? loadsOnMonday.map(entry) : [], noTruck: false })),
  loadCount: loadsOnMonday.length,
});

const view = (rows: HistoryRow[], week = '2026-W41'): HistoryWeekView => ({
  week,
  range: 'Oct 5 – 11, 2026',
  days: DAYS,
  rows,
  notReached: [],
  noNumber: [],
  counts: { drivers: rows.length, loads: rows.reduce((n, r) => n + r.loadCount, 0), notReached: 0 },
});

const THREE = view([row('Ada Quill', ['VT-1']), row('Bo Reyes', ['VT-2']), row('Cy Tamm', ['VT-3'])]);
const FLEET: FleetResponse = {
  fleet: [],
  fetchedAt: '2026-10-08T15:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-10-08T14:59:30.000Z',
};

const FADE_ROW = { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 180, easing: 'linear', fill: 'backwards' };
const DROP_14 = {
  keyframes: [
    { opacity: 0, translate: '0 -14px' },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
};
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
let weeks: Record<string, HistoryWeekView>;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  arrival.byChange = true;
  recorder = recordAnimations();
  weeks = {};
  /*
   * happy-dom lays nothing out: the page's scroller is 800px tall and each driver's row 52px,
   * one under the other, so all of these are in view.
   */
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.tagName === 'MAIN') return new DOMRect(0, 0, 1200, 800);
    if (this.hasAttribute('data-driver-row')) {
      const i = [...(this.parentElement?.children ?? [])].indexOf(this);
      return new DOMRect(0, 100 + i * 52, 1200, 52);
    }
    return new DOMRect(0, 0, 0, 0);
  };
  globalThis.fetch = vi.fn(async (url: string) => {
    const week = /week=([^&]+)/.exec(url)?.[1];
    const body = url.startsWith('/api/history') ? (weeks[week ?? ''] ?? view([], week)) : FLEET;
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
  recorder.restore();
  unreduce?.();
  unreduce = null;
  HTMLElement.prototype.getBoundingClientRect = realRect;
  vi.restoreAllMocks();
});

const openPage = async (initial = THREE) => {
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(HistoryPage, {
          initialWeek: { year: 2026, week: 41 },
          initialView: initial,
          initialQ: '',
          initialFleet: FLEET,
          listIds: [],
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Rae Ostrom', email: 'rae@example.test', role: 'dispatcher' },
        }),
      ),
    );
  });
};
const desktopRows = () => [...container!.querySelectorAll('main [data-driver-row]')];
const drawn = () => recorder.played.filter((p) => p.el.hasAttribute('data-driver-row'));
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const type = async (input: HTMLInputElement, text: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('histRows: the rows in view draw in when a change of page opens History', () => {
  it('each row in view fades in for 180ms, 30ms after the one before, opacity only, linear', async () => {
    await openPage();
    expect(drawn().map((p) => p.el)).toEqual(desktopRows());
    expect(drawn().map(shape)).toEqual([
      { ...FADE_ROW, delay: 0 },
      { ...FADE_ROW, delay: 30 },
      { ...FADE_ROW, delay: 60 },
    ]);
  });

  it('the page a load lands on draws nothing: its rows are the server’s first paint', async () => {
    arrival.byChange = false;
    await openPage();
    expect(desktopRows()).toHaveLength(3);
    expect(drawn()).toEqual([]);
  });

  it('a filter typed after it plays nothing more, and neither does clearing it', async () => {
    await openPage();
    const before = recorder.played.length;
    const filter = container!.querySelector<HTMLInputElement>('input[aria-label="Filter drivers"]')!;
    await type(filter, 'Bo');
    expect(desktopRows()).toHaveLength(1);
    await type(filter, '');
    expect(desktopRows()).toHaveLength(3);
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('another week, its fetch landing, and the week back play nothing more', async () => {
    await openPage();
    const before = recorder.played.length;
    weeks['2026-W40'] = view([row('Dee Vance', ['VT-9']), row('Eli Moss', ['VT-8'])], '2026-W40');
    const previous = container!.querySelector<HTMLButtonElement>('button[aria-label="Previous week"]')!;
    await act(async () => previous.click());
    await settle();
    expect(desktopRows().map((r) => r.getAttribute('data-driver-row'))).toEqual(['Dee Vance', 'Eli Moss']);
    const next = container!.querySelector<HTMLButtonElement>('button[aria-label="Next week"]')!;
    await act(async () => next.click());
    await settle();
    expect(desktopRows()).toHaveLength(3);
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('a week with no loads at the open, then one with loads: nothing, because it was not there when the page opened', async () => {
    await openPage(view([]));
    weeks['2026-W40'] = THREE;
    const previous = container!.querySelector<HTMLButtonElement>('button[aria-label="Previous week"]')!;
    await act(async () => previous.click());
    await settle();
    expect(desktopRows()).toHaveLength(3);
    expect(drawn()).toEqual([]);
  });

  it('under reduced motion nothing plays, and the rows are there', async () => {
    unreduce = reduceMotion();
    await openPage();
    expect(desktopRows()).toHaveLength(3);
    expect(recorder.played).toEqual([]);
  });
});

describe('histFold: a folded day’s loads drop in on “+N more”', () => {
  const FOUR = view([row('Ada Quill', ['VT-1', 'VT-2', 'VT-3', 'VT-4']), row('Bo Reyes', ['VT-5'])]);
  const drawTable = async (v = FOUR) => {
    await act(async () => {
      root!.render(createElement(HistoryTable, { view: v, rows: v.rows, todayIndex: null }));
    });
  };
  const more = () =>
    [...container!.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('more'))!;
  const loadsOf = (cell: Element) => [...cell.querySelectorAll('[data-load]')].map((l) => l.getAttribute('data-load'));

  it('the two that were folded drop 14px in 270ms, each, and the first two stay still', async () => {
    await drawTable();
    const cell = more().closest('[role="cell"]')!;
    await act(async () => more().click());
    expect(loadsOf(cell)).toEqual(['VT-1', 'VT-2', 'VT-3', 'VT-4']);
    expect(recorder.played.map((p) => p.el.querySelector('[data-load]')?.getAttribute('data-load'))).toEqual([
      'VT-3',
      'VT-4',
    ]);
    expect(recorder.played.map(shape)).toEqual([DROP_14, DROP_14]);
  });

  it('drawing a table with a folded day plays nothing, and a re-render of the open day plays nothing more', async () => {
    await drawTable();
    expect(recorder.played).toEqual([]);
    await act(async () => more().click());
    const played = recorder.played.length;
    await drawTable({ ...FOUR });
    expect(recorder.played).toHaveLength(played);
  });

  it('a new week draws its days folded again, and plays nothing until its own “+N more”', async () => {
    await drawTable();
    await act(async () => more().click());
    const played = recorder.played.length;
    const next = { ...FOUR, week: '2026-W42', days: DAYS.map((d) => ({ ...d, iso: `${d.iso}-next` })) };
    await drawTable(next);
    expect(more()).toBeDefined();
    expect(recorder.played).toHaveLength(played);
  });

  it('under reduced motion nothing plays, and all four loads are there', async () => {
    unreduce = reduceMotion();
    await drawTable();
    const cell = more().closest('[role="cell"]')!;
    await act(async () => more().click());
    expect(loadsOf(cell)).toEqual(['VT-1', 'VT-2', 'VT-3', 'VT-4']);
    expect(recorder.played).toEqual([]);
  });
});
