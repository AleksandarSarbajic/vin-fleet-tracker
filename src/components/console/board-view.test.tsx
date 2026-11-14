// @vitest-environment happy-dom
import { createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { recordAnimations, reduceMotion } from '@/test/animations';
import type { FleetResponse } from '@/hooks/useFleet';
import { TOUR_STORAGE_KEY, TOUR_VERSION } from '@/lib/tour';

/**
 * §12.159, phase 3bt: the board's view stays where it was on a person's pin or density, on the
 * real console. happy-dom lays nothing out, so `stubScroll` lays the board out as Chromium does:
 * a 600px scroller, its sticky column header 28px, then the pinned block (its 24px bar, its rows,
 * a 1px rule), then the list's rows at their virtualized places; scrollTop clamps to what there is
 * to scroll, and a scroll is told to the page a task later, as a browser tells it. Every number
 * is worked out from that and written out. The same, at 1440x900 in Chromium, is
 * `e2e/new-motion.spec.ts`'s ("phase 3bt").
 */

// The tokens as a copy this file may change: two tests take both glides back to 0.
vi.mock('@/design/tokens', async (original) => {
  const tokens = await original<typeof import('@/design/tokens')>();
  return { ...tokens, MOTION_MS: { ...tokens.MOTION_MS } };
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
const { MOTION_MS } = await import('@/design/tokens');
const tokens = MOTION_MS as unknown as Record<'pinGlide' | 'densityGlide', number>;
/** Both glides taken back, for one test. */
const tokensAtZero = () => {
  const was = { pin: tokens.pinGlide, density: tokens.densityGlide };
  tokens.pinGlide = 0;
  tokens.densityGlide = 0;
  return () => {
    tokens.pinGlide = was.pin;
    tokens.densityGlide = was.density;
  };
};

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
/** Sixty trucks, 1001 to 1060. */
const SIXTY = Array.from({ length: 60 }, (_, i) => truck(1001 + i));

const answer = (fleet: FleetResponse['fleet'], fetchedAt = '2026-09-18T12:00:00.000Z'): FleetResponse => ({
  fleet,
  fetchedAt,
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};
let restoreScroll: () => void = () => {};
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
let untoken: (() => void) | null = null;
const store = new Map<string, string>();
/** Each commit: the scroller's scrollTop and the rows' height, as React left them. */
let commits: { scrollTop: number; height: string }[];

const VIEW = 600;
const HEAD = 28;

const scrollerOf = () =>
  document.querySelector('[data-board-rows]')?.parentElement as HTMLElement | null | undefined;
const rowHeight = () =>
  Number.parseFloat(document.querySelector<HTMLElement>('[data-row-id]')?.style.height ?? '44');
const pinnedHosts = () => [...document.querySelectorAll('[data-pinned-host]')];
const blockHeight = () => {
  const n = pinnedHosts().length;
  return n === 0 ? 0 : 24 + n * rowHeight() + 1;
};
const bodyOf = () => document.querySelector<HTMLElement>('[data-board-rows] > div:last-child');
const isWrapper = (el: Element) =>
  el.firstElementChild?.hasAttribute('data-row-id') === true &&
  el.parentElement?.parentElement?.hasAttribute('data-board-rows') === true;
const startOf = (el: HTMLElement) =>
  Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0');
/** Where an element rests in the scroller's content, as Chromium lays the board out. */
const contentTop = (el: HTMLElement): number | null => {
  if (el.hasAttribute('data-pinned-host')) return HEAD + 24 + pinnedHosts().indexOf(el) * rowHeight();
  if (el === bodyOf()) return HEAD + blockHeight();
  if (isWrapper(el)) return HEAD + blockHeight() + startOf(el);
  return null;
};

/**
 * The board laid out, scrolled: places from the layout above, scrollTop clamped to what there is
 * to scroll and told a task later, a host drawn where it rests less the scroll (a glide's
 * `translate` is not laid out here: rests are what this phase holds).
 */
function stubScroll(): () => void {
  const realRect = Element.prototype.getBoundingClientRect;
  const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  let scrollTop = 0;
  const contentHeight = () => HEAD + blockHeight() + Number.parseFloat(bodyOf()?.style.height ?? '0');
  const scrollDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return this === scrollerOf() ? scrollTop : 0;
    },
    set(this: Element, value: number) {
      if (this !== scrollerOf()) return;
      const next = Math.max(0, Math.min(value, Math.max(0, contentHeight() - VIEW)));
      if (next === scrollTop) return;
      scrollTop = next;
      const scroller = scrollerOf();
      setTimeout(() => scroller?.dispatchEvent(new Event('scroll')), 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return contentTop(this) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute('role') === 'row' && this.parentElement === scrollerOf()) return HEAD;
      if (this.hasAttribute('data-pinned-host') || isWrapper(this)) return rowHeight();
      return offsetHeight.get!.call(this) as number;
    },
  });
  Element.prototype.getBoundingClientRect = function place(this: Element): DOMRect {
    const top = contentTop(this as HTMLElement);
    if (top !== null && this !== bodyOf()) return new DOMRect(0, top - scrollTop, 1100, rowHeight());
    return realRect.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = realRect;
    if (offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    if (scrollDesc) Object.defineProperty(Element.prototype, 'scrollTop', scrollDesc);
    else delete (Element.prototype as unknown as Record<string, unknown>).scrollTop;
  };
}

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
  restoreLayout = stubLayout({ width: 1100, height: VIEW });
  restoreScroll = stubScroll();
  recorder = recordAnimations();
  commits = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreScroll();
  restoreLayout();
  recorder.restore();
  unreduce?.();
  unreduce = null;
  untoken?.();
  untoken = null;
  root = null;
  container = null;
});

/** Waits on what the page shows, an act at a time, with a limit. Never one tick on its own. */
const untilShown = async (what: string, shown: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!shown()) {
    if (Date.now() > deadline) throw new Error(`not shown within ${timeoutMs}ms: ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
const press = async (key: string) => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

const render = async (fleet = SIXTY) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(
        Profiler,
        {
          id: 'board',
          onRender: () =>
            void commits.push({
              scrollTop: scrollerOf()?.scrollTop ?? -1,
              height: document.querySelector<HTMLElement>('[data-row-id]')?.style.height ?? '',
            }),
        },
        createElement(
          QueryClientProvider,
          { client },
          createElement(Console, {
            initial: answer(fleet),
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
      ),
    );
  });
  await untilShown('the list', () => listed().length > 0);
  act(() => recorder.finishAll());
  recorder.played.length = 0;
};

const rowEl = (n: number) => container!.querySelector<HTMLElement>(`[data-row-id="${idOf(n)}"]`)!;
const hostEl = (n: number) => rowEl(n).parentElement as HTMLElement;
const listed = () =>
  [...(bodyOf()?.querySelectorAll('[data-row-id]') ?? [])].map((r) =>
    Number(r.getAttribute('data-row-id')!.slice(0, 8)),
  );
const pinnedTrucks = () =>
  [...container!.querySelectorAll('[data-pinned-host] [data-row-id]')].map((r) =>
    Number(r.getAttribute('data-row-id')!.slice(0, 8)),
  );
/** Scrolled by a person, and told to the page, until the virtualizer has drawn that truck. */
const scrollTo = async (y: number, drawn: number) => {
  await act(async () => {
    scrollerOf()!.scrollTop = y;
  });
  await untilShown(`scrolled to ${y}`, () => listed().includes(drawn));
};
/** Where a truck rests in the view: from the scroller's top edge, the header included. */
const viewTop = (n: number) => contentTop(hostEl(n))! - scrollerOf()!.scrollTop;
/** The truck at the top of the view: the first whose bottom is below the header. */
const topTruck = () => {
  const h = rowHeight();
  return [...pinnedTrucks(), ...listed()]
    .map((n) => ({ n, top: viewTop(n) }))
    .filter(({ top }) => top + h > HEAD + 0.5 && top < VIEW)
    .sort((a, b) => a.top - b.top)[0]?.n;
};
const scrollTop = () => scrollerOf()!.scrollTop;
const toHeight = async (px: '32px' | '44px') =>
  untilShown(`rows ${px} tall`, () => rowEl(listed()[0]!).style.height === px);
const clickStar = async (n: number) => {
  await act(async () => rowEl(n).querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
};

describe('density keeps the truck at the top of the view (§12.159, phase 3bt)', () => {
  it('in the middle of the list: Compact keeps 1020 at the top, partly under the header by the same share of its height, in the commit the rows change height in', async () => {
    await render();
    await scrollTo(865, 1040);
    // 1020 is the 20th: it rests at 28 + 19·44 - 865 = -1, 29px of its 44 under the header.
    expect(topTruck()).toBe(1020);
    expect(viewTop(1020)).toBe(-1);
    const before = commits.length;
    await press('d');
    await toHeight('32px');
    // 29/44 of a 32px row is 21.09px under the header: at 6.91, so scrollTop is
    // 28 + 19·32 - 6.91 = 629.09, where it stayed at 865 before this phase.
    expect(scrollTop()).toBeCloseTo(629.091, 2);
    expect(topTruck()).toBe(1020);
    expect(viewTop(1020)).toBeCloseTo(6.909, 2);
    // Held in the commit the rows change height in: no commit shows 32px rows at the old scroll.
    const compact = commits.slice(before).filter((c) => c.height === '32px');
    expect(compact[0]!.scrollTop).toBeCloseTo(629.091, 2);
    // And back: D keeps 1020 there, 21.09/32 of 44 under the header again, so scrollTop 865.
    await press('d');
    await toHeight('44px');
    expect(scrollTop()).toBeCloseTo(865, 2);
    expect(topTruck()).toBe(1020);
  });

  it('deep in the list the held view’s rows are drawn in the commit itself, and glide', async () => {
    await render();
    await scrollTo(1800, 1055);
    // 1041 rests at 28 + 40·44 - 1800 = -12: 40px of its 44 under the header.
    expect(topTruck()).toBe(1041);
    await press('d');
    await toHeight('32px');
    // 40/44 of 32 is 29.09 under the header: at -1.09, so scrollTop 28 + 40·32 + 1.09 = 1309.09.
    // At the old 1800 the virtualizer would have drawn from the 49th truck: 1041 is drawn for
    // this commit.
    expect(scrollTop()).toBeCloseTo(1309.091, 2);
    expect(topTruck()).toBe(1041);
    // Each row of the held view glides from where it was drawn to where it rests: 1041 from -12
    // to -1.09, 1042 from 32 to 30.91.
    const glides = recorder.played.filter((p) => JSON.stringify(p.keyframes).includes('translate'));
    const from = (n: number) => {
      const p = glides.find((g) => g.el.firstElementChild?.getAttribute('data-row-id') === idOf(n));
      return Number(/0px (-?[\d.]+)px/.exec(String((p?.keyframes[0] as { translate?: string })?.translate))?.[1]);
    };
    expect(from(1041)).toBeCloseTo(-12 + 1.091, 2);
    expect(from(1042)).toBeCloseTo(32 - 30.909, 2);
  });

  it('at the end of the list: what it asks for is clamped, as before', async () => {
    await render();
    // The last scroll there is: 28 + 60·44 - 600 = 2068. 1048 rests at the header's edge, 28.
    await scrollTo(2068, 1060);
    expect(topTruck()).toBe(1048);
    await press('d');
    await toHeight('32px');
    // It asks for 28 + 47·32 - 28 = 1504; there is only 28 + 60·32 - 600 = 1348 to scroll.
    expect(scrollTop()).toBe(1348);
  });

  it('at the top of the list (scrollTop 0) nothing changes from before', async () => {
    await render();
    await press('d');
    await toHeight('32px');
    expect(scrollTop()).toBe(0);
    expect(topTruck()).toBe(1001);
  });

  it('under reduced motion it holds the same, and nothing plays', async () => {
    unreduce = reduceMotion();
    await render();
    await scrollTo(865, 1040);
    await press('d');
    await toHeight('32px');
    expect(scrollTop()).toBeCloseTo(629.091, 2);
    expect(topTruck()).toBe(1020);
    expect(recorder.played).toEqual([]);
  });

  it('with the glide’s token at 0 it holds the same, and nothing plays', async () => {
    untoken = tokensAtZero();
    await render();
    await scrollTo(865, 1040);
    await press('d');
    await toHeight('32px');
    expect(scrollTop()).toBeCloseTo(629.091, 2);
    expect(topTruck()).toBe(1020);
    expect(recorder.played.filter((p) => p.el.closest('[data-board-rows]'))).toEqual([]);
  });

  it('a poll after it moves nothing', async () => {
    await render();
    await scrollTo(865, 1040);
    await press('d');
    await toHeight('32px');
    const held = scrollTop();
    const late = SIXTY.map((row) => ({ ...row, status: 'LATE' as const, computed: 'LATE' as const }));
    await act(async () => {
      client.setQueryData(['fleet'], answer(late, '2026-09-18T12:00:20.000Z'));
    });
    await untilShown('the poll', () => (container!.textContent ?? '').includes('Late'));
    expect(scrollTop()).toBe(held);
  });
});

describe('a pin or unpin keeps the trucks in view where they were (§12.159, phase 3bt)', () => {
  it('a truck in view pinned from its star: those above it stay, those below close up, and it leaves the view for the block', async () => {
    await render();
    await scrollTo(865, 1040);
    expect(topTruck()).toBe(1020);
    expect([1020, 1021, 1022].map(viewTop)).toEqual([-1, 43, 87]);
    await clickStar(1023);
    await untilShown('1023 pinned', () => pinnedTrucks().join() === '1023');
    // The block, 69px (bar, row, rule), is above the list now. 1020 rests at
    // 28 + 69 + 19·44 - scrollTop, held at -1: scrollTop 934, where it stayed at 865 before.
    expect(scrollTop()).toBe(934);
    expect([1020, 1021, 1022].map(viewTop)).toEqual([-1, 43, 87]);
    // 1024 was at 175, under 1023; it is at 131, where 1023 was. 1023 is out of view above.
    expect(viewTop(1024)).toBe(131);
    expect(viewTop(1023)).toBe(28 + 24 - 934);
  });

  it('unpinned again from its star in the block: it goes back, and 1020 stays at -1', async () => {
    await render();
    await scrollTo(865, 1040);
    await clickStar(1023);
    await untilShown('1023 pinned', () => pinnedTrucks().join() === '1023');
    expect(scrollTop()).toBe(934);
    await clickStar(1023);
    await untilShown('1023 unpinned', () => pinnedTrucks().length === 0);
    // No block; 1020 at 28 + 19·44 - scrollTop = -1: scrollTop 865 again.
    expect(scrollTop()).toBe(865);
    expect([1020, 1021, 1022, 1023].map(viewTop)).toEqual([-1, 43, 87, 131]);
  });

  it('a truck above the view pinned by P: every truck in view stays', async () => {
    await render();
    // Selected first, at the top; then scrolled away from it.
    await act(async () => rowEl(1006).click());
    await scrollTo(865, 1040);
    const before = [1020, 1021, 1030].map(viewTop);
    await press('p');
    await untilShown('1006 pinned', () => pinnedTrucks().join() === '1006');
    // The block is 69px and the list lost a row above: 1020 is the 19th now, at
    // 28 + 69 + 18·44 - scrollTop, held at -1: scrollTop 890.
    expect(scrollTop()).toBe(890);
    expect([1020, 1021, 1030].map(viewTop)).toEqual(before);
  });

  it('at the top of the list (scrollTop 0) nothing changes from before', async () => {
    await render();
    await clickStar(1003);
    await untilShown('1003 pinned', () => pinnedTrucks().join() === '1003');
    expect(scrollTop()).toBe(0);
  });

  it('with the glide’s token at 0 it holds the same, and nothing plays', async () => {
    untoken = tokensAtZero();
    await render();
    await scrollTo(865, 1040);
    await clickStar(1023);
    await untilShown('1023 pinned', () => pinnedTrucks().join() === '1023');
    expect(scrollTop()).toBe(934);
    expect(recorder.played.filter((p) => p.el.closest('[data-board-rows]'))).toEqual([]);
  });

  it('under reduced motion it holds the same, and nothing plays', async () => {
    unreduce = reduceMotion();
    await render();
    await scrollTo(865, 1040);
    await clickStar(1023);
    await untilShown('1023 pinned', () => pinnedTrucks().join() === '1023');
    expect(scrollTop()).toBe(934);
    expect(recorder.played).toEqual([]);
  });
});
