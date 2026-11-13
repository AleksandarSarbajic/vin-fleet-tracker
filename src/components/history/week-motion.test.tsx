// @vitest-environment happy-dom
import { createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { HistoryEntry, HistoryRow, HistoryWeekView } from '@/lib/history';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.158, histWeek: a week a person moved to on History swings its rows in from the side it
 * lies on, 40px, in 270ms, in the commit those rows land in, whether from the cache at once or
 * from the network after the skeleton. On nothing else: not the page a load lands on, Back to
 * the page, a refetch or a poll of the same week, a week that lands with no rows, or the phone's
 * week. Every name and number is invented.
 *
 * The 3bq rule: a week from the network lands through react-query's own `setTimeout(0)`, so the
 * test never trusts one tick of its own. It waits on what the page shows, an act at a time, and
 * a Profiler reads what had played by the commit the rows first appeared in.
 */

const arrival = vi.hoisted(() => ({ byChange: false }));
const address = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('@/lib/page-arrival', () => ({ cameByPageChange: () => arrival.byChange, arrive: () => true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => address.params,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
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
const row = (name: string, load: string): HistoryRow => ({
  driverId: `d-${name}`,
  name,
  trucks: [{ label: '412', days: null, partial: false }],
  cells: DAYS.map((_, i) => ({ entries: i === 0 ? [entry(load)] : [], noTruck: false })),
  loadCount: 1,
});
const view = (week: string, names: string[]): HistoryWeekView => ({
  week,
  range: `${week} range`,
  days: DAYS,
  rows: names.map((n, i) => row(n, `${week}-${i}`)),
  notReached: [],
  noNumber: [],
  counts: { drivers: names.length, loads: names.length, notReached: 0 },
});

const W41 = view('2026-W41', ['Ada Quill', 'Bo Reyes', 'Cy Tamm']);
const W40 = view('2026-W40', ['Dee Vance', 'Eli Moss']);
const W39 = view('2026-W39', ['Fay Lund']);
const FLEET: FleetResponse = {
  fleet: [],
  fetchedAt: '2026-10-08T15:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-10-08T14:59:30.000Z',
};

const SWING = (dx: number) => ({
  keyframes: [
    { opacity: 0, translate: `${dx}px 0` },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
});
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
/** Each week's answer, and the weeks whose answer waits until the test lands it. */
let weeks: Record<string, HistoryWeekView>;
let held: Map<string, () => void>;
let fleetCalls = 0;
/** Each commit of the page as React made it: the rows on the page then, and the swings played by then. */
let commits: { rows: string[]; swung: number }[];

const desktopRows = () => [...container!.querySelectorAll<HTMLElement>('main [data-driver-row]')];
const names = () => desktopRows().map((r) => r.getAttribute('data-driver-row') ?? '');
const swings = () =>
  recorder.played.filter((p) => p.el.hasAttribute('data-driver-row') && p.options.duration === 270);
const toolbar = (label: string) =>
  container!.querySelector<HTMLButtonElement>(`[data-history-toolbar] button[aria-label="${label}"]`)!;
const thisWeek = () =>
  [...container!.querySelectorAll<HTMLButtonElement>('[data-history-toolbar] button')].find(
    (b) => (b.textContent ?? '').trim() === 'This week',
  )!;
const tableOf = () => container!.querySelector<HTMLElement>('main [role="table"]')!;
const skeleton = () => container!.querySelector('main [aria-busy="true"]');

beforeEach(() => {
  arrival.byChange = false;
  address.params = new URLSearchParams();
  recorder = recordAnimations();
  weeks = { '2026-W41': W41, '2026-W40': W40, '2026-W39': W39 };
  held = new Map();
  fleetCalls = 0;
  commits = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    const reply = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!url.startsWith('/api/history')) {
      fleetCalls += 1;
      return reply({ ...FLEET, fetchedAt: `2026-10-08T15:00:${String(fleetCalls).padStart(2, '0')}.000Z` });
    }
    const week = /week=([^&]+)/.exec(url)?.[1] ?? '';
    if (held.has(week)) await new Promise<void>((resolve) => held.set(week, resolve));
    return reply(weeks[week] ?? view(week, []));
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
  vi.restoreAllMocks();
});

const openPage = async (initialWeek = 41, initialView = W41) => {
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        // A Profiler's onRender runs in each commit, after its children's layout effects.
        createElement(
          Profiler,
          { id: 'history', onRender: () => void commits.push({ rows: names(), swung: swings().length }) },
          createElement(HistoryPage, {
            initialWeek: { year: 2026, week: initialWeek },
            initialView,
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
};
/** Holds a week's answer until `land` is called for it. */
const hold = (week: string) => held.set(week, () => {});
const land = (week: string) => held.get(week)!();
/** Phase 3bq: waits on the page, an act at a time, and returns at the first act that shows it. */
const untilShown = async (what: string, shown: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!shown()) {
    if (Date.now() > deadline) throw new Error(`not shown within ${timeoutMs}ms: ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
/** The first commit that drew these rows, as React made it. */
const firstCommitWith = (rows: string[]) => commits.find((c) => c.rows.join() === rows.join());
const click = async (button: HTMLButtonElement) => {
  await act(async () => button.click());
};

describe('histWeek: a change of week on the arrows swings its rows in from that side', () => {
  it('Previous: the skeleton while it loads, then each row from 40px to the left in 270ms, in the commit they land in', async () => {
    await openPage();
    hold('2026-W40');
    await click(toolbar('Previous week'));
    // The skeleton keeps its pulse and gets nothing more: no swing while it waits.
    expect(skeleton()).not.toBeNull();
    expect(swings()).toEqual([]);
    land('2026-W40');
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    expect(swings().map((p) => p.el)).toEqual(desktopRows());
    expect(swings().map(shape)).toEqual([SWING(-40), SWING(-40)]);
    // The commit the rows land in already has both: a swing in any commit after it leaves this one short.
    expect(firstCommitWith(['Dee Vance', 'Eli Moss'])).toEqual({ rows: ['Dee Vance', 'Eli Moss'], swung: 2 });
  });

  it('Next: from 40px to the right, the other way', async () => {
    // The page's own clock is the fleet's (Oct 8, W41), so Next is open from W40.
    await openPage(40, W40);
    hold('2026-W41');
    await click(toolbar('Next week'));
    expect(skeleton()).not.toBeNull();
    expect(swings()).toEqual([]);
    land('2026-W41');
    await untilShown('the W41 rows', () => names().join() === 'Ada Quill,Bo Reyes,Cy Tamm');
    expect(swings().map(shape)).toEqual([SWING(40), SWING(40), SWING(40)]);
    expect(firstCommitWith(['Ada Quill', 'Bo Reyes', 'Cy Tamm'])).toEqual({
      rows: ['Ada Quill', 'Bo Reyes', 'Cy Tamm'],
      swung: 3,
    });
  });

  it('This week is a person’s change too: a later week, from the right', async () => {
    await openPage(39, W39);
    await click(thisWeek());
    await untilShown('the W41 rows', () => names().join() === 'Ada Quill,Bo Reyes,Cy Tamm');
    expect(swings().map(shape)).toEqual([SWING(40), SWING(40), SWING(40)]);
  });

  it('a week in the cache lands in the commit of the click itself, and swings there', async () => {
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    const before = swings().length;
    const at = commits.length;
    // W41 is the page's own week, in the cache from the server's answer.
    await click(toolbar('Next week'));
    expect(names()).toEqual(['Ada Quill', 'Bo Reyes', 'Cy Tamm']);
    const landed = commits.slice(at).find((c) => c.rows.length === 3);
    expect(landed).toEqual({ rows: ['Ada Quill', 'Bo Reyes', 'Cy Tamm'], swung: before + 3 });
    expect(swings().slice(before).map(shape)).toEqual([SWING(40), SWING(40), SWING(40)]);
  });

  it('the table clips sideways while they come in, and lets go when the last lands, leaving nothing', async () => {
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    expect(tableOf().style.overflowX).toBe('clip');
    swings()[0]!.animation.finish();
    expect(tableOf().style.overflowX).toBe('clip');
    recorder.finishAll();
    expect(tableOf().getAttribute('style')).toBeNull();
    expect(desktopRows().filter((r) => r.getAttribute('style'))).toEqual([]);
  });

  it('two weeks back before the first lands: the week that lands swings once, from the left', async () => {
    await openPage();
    hold('2026-W40');
    hold('2026-W39');
    await click(toolbar('Previous week'));
    await click(toolbar('Previous week'));
    land('2026-W40');
    land('2026-W39');
    await untilShown('the W39 row', () => names().join() === 'Fay Lund');
    expect(swings().map(shape)).toEqual([SWING(-40)]);
    expect(swings()[0]!.el).toBe(desktopRows()[0]);
  });

  it('back and forth before it lands: the week in the cache swings at once, and the late answer plays nothing', async () => {
    await openPage();
    hold('2026-W40');
    await click(toolbar('Previous week'));
    await click(toolbar('Next week'));
    expect(swings().map(shape)).toEqual([SWING(40), SWING(40), SWING(40)]);
    land('2026-W40');
    await untilShown('the W40 answer in the cache', () => client.getQueryData(['history', '2026-W40']) !== undefined);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(swings()).toHaveLength(3);
  });

  it('a refetch of the same week and a poll play nothing, even with new rows', async () => {
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    const before = recorder.played.length;
    weeks['2026-W40'] = view('2026-W40', ['Dee Vance', 'Eli Moss', 'Ivy Cole']);
    const polls = fleetCalls;
    await act(async () => {
      await client.refetchQueries();
    });
    await untilShown('the refetched W40 rows', () => desktopRows().length === 3);
    expect(fleetCalls).toBeGreaterThan(polls);
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('a week that lands with no rows spends it: its rows that come later by a refetch play nothing', async () => {
    weeks['2026-W40'] = view('2026-W40', []);
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the empty week', () => (container!.textContent ?? '').includes('No loads recorded this week'));
    expect(swings()).toEqual([]);
    weeks['2026-W40'] = W40;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['history', '2026-W40'] });
    });
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    expect(swings()).toEqual([]);
  });

  it('the empty week’s own Previous week is a person’s change too: from the left', async () => {
    weeks['2026-W40'] = view('2026-W40', []);
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the empty week', () => (container!.textContent ?? '').includes('No loads recorded this week'));
    const inPanel = [...container!.querySelectorAll<HTMLButtonElement>('main button')].find((b) =>
      (b.textContent ?? '').includes('Previous week'),
    )!;
    await click(inPanel);
    await untilShown('the W39 row', () => names().join() === 'Fay Lund');
    expect(swings().map(shape)).toEqual([SWING(-40)]);
  });

  it('the page a load lands on, and Back to History on a week its props do not hold, play nothing', async () => {
    // Back renders the page again from Next's cache: its props are W41, the address says W40.
    address.params = new URLSearchParams({ week: '2026-W40' });
    await openPage();
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    expect(recorder.played).toEqual([]);
  });

  it('the phone’s week change plays nothing: the phone rows are out of this phase', async () => {
    await openPage();
    await click(container!.querySelector<HTMLButtonElement>('[data-phone-week] button[aria-label="Previous week"]')!);
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    expect(swings()).toEqual([]);
  });

  it('under reduced motion nothing plays, and the table ends in the same markup', async () => {
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    recorder.finishAll();
    const moved = tableOf().outerHTML;
    act(() => root!.unmount());
    root = createRoot(container!);
    client.clear();
    recorder.played.length = 0;
    unreduce = reduceMotion();
    await openPage();
    await click(toolbar('Previous week'));
    await untilShown('the W40 rows', () => names().join() === 'Dee Vance,Eli Moss');
    expect(recorder.played).toEqual([]);
    expect(tableOf().outerHTML).toBe(moved);
  });
});
