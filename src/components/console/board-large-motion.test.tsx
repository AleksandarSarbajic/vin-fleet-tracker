// @vitest-environment happy-dom
import { createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { FleetResponse } from '@/hooks/useFleet';
import { TOUR_STORAGE_KEY, TOUR_VERSION } from '@/lib/tour';

/**
 * §12.159, the board's two large motions, on the real console: a truck a person pins or unpins,
 * and the density a person chooses. Each starts on its own cause, in the commit that cause lands
 * in, at its own length written out; every non-cause the brief names starts nothing. happy-dom
 * lays nothing out, so `stubBoard` places each row's host as the list lays it out: the column
 * header 28px, then the pinned block (its bar 24px, its rows, a 1px rule), then the list's rows
 * at their virtualized places. Real frames, scrollers and presses are `e2e/new-motion.spec.ts`'s
 * ("phase 3bs"), and so is a truck fading in where it was not drawn.
 */

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

const CURVE = 'cubic-bezier(.22,.61,.36,1)';

const idOf = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const truck = (n: number, status: 'LATE' | 'ON_TIME' = 'ON_TIME') =>
  fleetRow({
    id: idOf(n),
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    driverName: 'Sam',
    status,
    computed: status,
    nextStop: nextStop({ stopId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001` }),
  });
const FOUR = [truck(101), truck(202), truck(303), truck(404)];

const answer = (fleet: FleetResponse['fleet'], fetchedAt = '2026-09-18T12:00:00.000Z'): FleetResponse => ({
  fleet,
  fetchedAt,
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});
/** Each poll is a new answer, 20s after the one before, as the board's own poll is. */
let polled = 0;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};
let restoreBoard: () => void = () => {};
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
const store = new Map<string, string>();
/** Storage as a first visit leaves it, with the tour already seen: it would open over the board and take its keys. */
const freshStore = () => {
  store.clear();
  store.set(TOUR_STORAGE_KEY, String(TOUR_VERSION));
};
/** Each commit, as React made it: what had slid by then, how many trucks were pinned, the rows' height. */
let commits: { slides: number; pinned: number; height: string }[];
/** This phase's motions that played while the page loaded, before `render` clears the board's opening. */
let atLoad: Played[];

/**
 * Where each row's host is drawn, as the board lays it out: the scroller at the top of a 600px
 * view, its column header 28px, the pinned block's bar 24px and its rows, a 1px rule under the
 * block, then the list's wrappers at their virtualized places. A row is as tall as its own style.
 */
function stubBoard(): () => void {
  const real = Element.prototype.getBoundingClientRect;
  const rowHeight = () =>
    Number.parseFloat(document.querySelector<HTMLElement>('[data-row-id]')?.style.height ?? '44');
  const pinnedHosts = () => [...document.querySelectorAll('[data-pinned-host]')];
  const blockHeight = () => {
    const n = pinnedHosts().length;
    return n === 0 ? 0 : 24 + n * rowHeight() + 1;
  };
  Element.prototype.getBoundingClientRect = function place(this: Element): DOMRect {
    const el = this as HTMLElement;
    if (el.hasAttribute('data-pinned-host')) {
      return new DOMRect(0, 28 + 24 + pinnedHosts().indexOf(el) * rowHeight(), 1100, rowHeight());
    }
    if (
      el.firstElementChild?.hasAttribute('data-row-id') &&
      el.parentElement?.parentElement?.hasAttribute('data-board-rows')
    ) {
      const y = Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0');
      return new DOMRect(0, 28 + blockHeight() + y, 1100, rowHeight());
    }
    return real.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = real;
  };
}

beforeEach(() => {
  freshStore();
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
  restoreBoard = stubBoard();
  recorder = recordAnimations();
  commits = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreBoard();
  restoreLayout();
  recorder.restore();
  unreduce?.();
  unreduce = null;
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

const hostOf = (el: Element) =>
  el.hasAttribute('data-pinned-host') ||
  (el.firstElementChild?.hasAttribute('data-row-id') === true &&
    el.parentElement?.parentElement?.hasAttribute('data-board-rows') === true);
/** What slid on a row's host, a star's growth, a fade on a host: this phase's motions. */
const slides = () =>
  recorder.played.filter((p) => JSON.stringify(p.keyframes).includes('"translate"') && hostOf(p.el));
const fades = () =>
  recorder.played.filter(
    (p) => hostOf(p.el) && JSON.stringify(p.keyframes) === JSON.stringify([{ opacity: 0 }, { opacity: 1 }]),
  );
const stars = () => recorder.played.filter((p) => p.el.tagName.toLowerCase() === 'svg');
const keyOf = (p: Played) =>
  p.el.tagName.toLowerCase() === 'svg'
    ? p.el.closest('[data-row-id]')?.getAttribute('data-row-id')
    : p.el.firstElementChild?.getAttribute('data-row-id');
const truckOf = (p: Played) => Number(keyOf(p)?.slice(0, 8));
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });
const SLIDE = (dy: number) => ({
  keyframes: [{ translate: `0px ${dy}px` }, { translate: '0 0' }],
  duration: 390,
  easing: CURVE,
});
const byTruck = (list: Played[]) => Object.fromEntries(list.map((p) => [truckOf(p), shape(p)]));

const render = async (fleet = FOUR) => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  await act(async () => {
    root!.render(
      createElement(
        Profiler,
        {
          id: 'board',
          // After its children's layout effects: what had started by the end of each commit.
          onRender: () =>
            void commits.push({
              slides: slides().length,
              pinned: document.querySelectorAll('[data-pinned-host]').length,
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
  // A stored pin or density lands a moment after load: wait for it, so a glide it started is seen.
  await untilShown('the stored density and pins', () => {
    const stored = store.get('ft.density');
    const height = document.querySelector<HTMLElement>('[data-row-id]')?.style.height;
    const pins = JSON.parse(store.get('ft.pinned') ?? '[]') as string[];
    return (
      (stored !== 'compact' || height === '32px') &&
      pins.every((id) => document.querySelector(`[data-pinned-host] [data-row-id="${id}"]`))
    );
  });
  atLoad = [...slides(), ...stars(), ...fades()];
  // The board's opening, once per page load, is §12.149's and not this phase's.
  act(() => recorder.finishAll());
  recorder.played.length = 0;
};

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
const press = async (key: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
};
const poll = async (fleet: FleetResponse['fleet']) => {
  polled += 1;
  await act(async () => {
    client.setQueryData(['fleet'], answer(fleet, new Date(Date.parse('2026-09-18T12:00:00.000Z') + polled * 20_000).toISOString()));
  });
};
const rowEl = (n: number) => container!.querySelector<HTMLElement>(`[data-row-id="${idOf(n)}"]`)!;
const star = (n: number) => rowEl(n).querySelector<HTMLButtonElement>('button[aria-pressed]')!;
const pinnedTrucks = () =>
  [...container!.querySelectorAll('[data-pinned-host] [data-row-id]')].map((r) =>
    Number(r.getAttribute('data-row-id')!.slice(0, 8)),
  );
const listed = () =>
  [...container!.querySelectorAll('[data-board-rows] > div:last-child [data-row-id]')].map((r) =>
    Number(r.getAttribute('data-row-id')!.slice(0, 8)),
  );
const densityButton = (name: 'comfortable' | 'compact') =>
  container!.querySelector<HTMLButtonElement>(`[aria-label="Row density"] button[data-segment="${name}"]`)!;
const pinTruck = async (n: number) => {
  await act(async () => star(n).click());
  await untilShown(`truck ${n} pinned`, () => pinnedTrucks().includes(n));
};
const unpinTruck = async (n: number) => {
  await act(async () => star(n).click());
  await untilShown(`truck ${n} unpinned`, () => !pinnedTrucks().includes(n));
};
const toHeight = async (px: '32px' | '44px', act_: () => Promise<void>) => {
  await act_();
  await untilShown(`rows ${px} tall`, () => rowEl(Number(listed()[0])).style.height === px);
};
const paletteAction = async (label: string) => {
  await press('k', { metaKey: true });
  await untilShown(`the palette's ${label}`, () =>
    [...document.querySelectorAll('[role="option"]')].some((o) => (o.textContent ?? '').includes(label)),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
    (o.textContent ?? '').includes(label),
  )!;
  await act(async () => option.click());
};
/** Everything a motion here can leave: a style on the box, the scroller, the bar or a pinned host; a lifted or grounded host. */
const leftovers = () => {
  const box = container!.querySelector('[data-board-rows]')!;
  const hosts = [...box.querySelectorAll('[data-row-id]')].map((r) => r.parentElement as HTMLElement);
  return {
    box: box.getAttribute('style'),
    scroller: box.parentElement!.getAttribute('style'),
    bar: container!.querySelector('[data-pinned-bar]')?.getAttribute('style') ?? null,
    pinnedHosts: [...box.querySelectorAll('[data-pinned-host]')].filter(
      (h) => h.hasAttribute('style') || h.hasAttribute('class'),
    ).length,
    lifted: hosts.filter((h) => h.style.zIndex).length,
    grounded: hosts.filter((h) => h.classList.contains('bg-surface-base')).length,
  };
};
const AT_REST = { box: null, scroller: null, bar: null, pinnedHosts: 0, lifted: 0, grounded: 0 };
const markup = () => container!.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_');

describe('pin: a truck a person pins or unpins (§12.159)', () => {
  it('the star pins a truck: it glides from its row to the block, 390ms, over the rest; the rows it pushes glide from where they stood; its star grows from .2, in the commit it lands in', async () => {
    await render();
    expect(listed()).toEqual([101, 202, 303, 404]);
    const before = commits.length;
    await pinTruck(303);
    // Drawn at 28, 72, 116 and 160; now 303 is at 52 in the block (under its 24px bar), and the
    // list starts 69px lower: 101 at 97, 202 at 141, 404 at 185.
    expect(byTruck(slides())).toEqual({
      303: SLIDE(64),
      101: SLIDE(-69),
      202: SLIDE(-69),
      404: SLIDE(-25),
    });
    expect(stars().map(shape)).toEqual([
      { keyframes: [{ scale: '0.2' }, { scale: '1' }], duration: 390, easing: CURVE },
    ]);
    expect(truckOf(stars()[0]!)).toBe(303);
    // Drawn over the rest, on a solid ground; the others are grounded and not lifted.
    const flying = slides().find((p) => truckOf(p) === 303)!.el as HTMLElement;
    expect([flying.style.zIndex, flying.style.position]).toEqual(['3', 'relative']);
    for (const p of slides()) {
      expect((p.el as HTMLElement).classList.contains('bg-surface-base')).toBe(true);
      if (truckOf(p) !== 303) expect((p.el as HTMLElement).style.zIndex).toBe('');
    }
    // The box clips and is its own layer while they move; the bar is lifted over them.
    const box = container!.querySelector<HTMLElement>('[data-board-rows]')!;
    expect([box.style.overflow, box.style.isolation]).toEqual(['clip', 'isolate']);
    expect(container!.querySelector<HTMLElement>('[data-pinned-bar]')!.style.zIndex).toBe('4');
    // The commit 303 lands in the block in has every glide already: one a commit later leaves it short.
    expect(commits.slice(before).find((c) => c.pinned === 1)?.slides).toBe(4);
    act(() => recorder.finishAll());
    expect(leftovers()).toEqual(AT_REST);
  });

  it('P pins the selected truck the same way, and the palette’s Unpin takes it back the other way', async () => {
    await render();
    await act(async () => rowEl(202).click());
    await press('p');
    await untilShown('202 pinned', () => pinnedTrucks().join() === '202');
    // 202 from 72 to 52; 101 down by the block's 69px; 303 and 404 by 25.
    expect(byTruck(slides())).toEqual({ 202: SLIDE(20), 101: SLIDE(-69), 303: SLIDE(-25), 404: SLIDE(-25) });
    act(() => recorder.finishAll());
    recorder.played.length = 0;
    await paletteAction('Unpin Truck 202');
    await untilShown('202 unpinned', () => pinnedTrucks().length === 0);
    expect(byTruck(slides())).toEqual({ 202: SLIDE(-20), 101: SLIDE(69), 303: SLIDE(25), 404: SLIDE(25) });
  });

  it('the star in the block unpins it: it glides back from the block to its place in the list', async () => {
    store.set('ft.pinned', JSON.stringify([idOf(404)]));
    await render();
    expect(pinnedTrucks()).toEqual([404]);
    await unpinTruck(404);
    // 404 from 52 in the block down to 160; the three above it up by the block's 69px.
    expect(byTruck(slides())).toEqual({ 404: SLIDE(-108), 101: SLIDE(69), 202: SLIDE(69), 303: SLIDE(69) });
    expect(stars().map(truckOf)).toEqual([404]);
    act(() => recorder.finishAll());
    expect(leftovers()).toEqual(AT_REST);
  });

  it('a poll while it glides neither restarts nor doubles it', async () => {
    await render();
    await pinTruck(303);
    const started = recorder.played.length;
    expect(started).toBe(5);
    await poll([truck(101), truck(202), truck(303), truck(404)]);
    await poll([truck(101), truck(202), truck(303), truck(404)]);
    expect(recorder.played).toHaveLength(started);
    expect(recorder.played.every((p) => p.animation.playState === 'running')).toBe(true);
  });

  it('pins read from storage play nothing', async () => {
    store.set('ft.pinned', JSON.stringify([idOf(202), idOf(303)]));
    await render();
    expect(pinnedTrucks()).toEqual([202, 303]);
    expect(atLoad).toEqual([]);
  });

  it('the cap refusing ("unpin one first") plays nothing', async () => {
    const six = [101, 202, 303, 404, 505, 606].map((n) => truck(n));
    store.set('ft.pinned', JSON.stringify([101, 202, 303, 404, 505].map(idOf)));
    await render(six);
    expect(pinnedTrucks()).toHaveLength(5);
    await act(async () => star(606).click());
    await untilShown('the refusal', () => (container!.textContent ?? '').includes('unpin one first'));
    expect(pinnedTrucks()).toHaveLength(5);
    expect([...slides(), ...stars(), ...fades()]).toEqual([]);
  });

  it('a chip that hides a pinned truck takes it away at once: no pin glide', async () => {
    store.set('ft.pinned', JSON.stringify([idOf(101)]));
    await render([truck(101, 'LATE'), truck(202), truck(303), truck(404)]);
    expect(pinnedTrucks()).toEqual([101]);
    // 3 is On time.
    await press('3');
    await untilShown('the block gone', () => pinnedTrucks().length === 0);
    expect([...slides(), ...stars()]).toEqual([]);
  });

  it('a chip during a pin’s glide lands it at once, and leaves nothing on any host', async () => {
    await render([truck(101, 'LATE'), truck(202), truck(303), truck(404)]);
    await pinTruck(303);
    const pinGlides = slides();
    expect(pinGlides).toHaveLength(4);
    await press('3');
    await untilShown('the chip on', () => listed().join() === '202,404');
    expect(pinGlides.map((p) => p.animation.playState)).toEqual(['idle', 'idle', 'idle', 'idle']);
    act(() => recorder.finishAll());
    expect(leftovers()).toEqual(AT_REST);
  });

  it('a second pin during the first’s glide lands the first and starts its own', async () => {
    await render();
    await pinTruck(303);
    const first = slides();
    const at = recorder.played.length;
    await pinTruck(101);
    expect(first.map((p) => p.animation.playState)).toEqual(['idle', 'idle', 'idle', 'idle']);
    // 101 from 97 to 96, the block's second row; 303 stays at 52; the block grew by the row 101
    // left, so 202 and 404 stay at 141 and 185.
    const second = recorder.played.slice(at).filter((p) => JSON.stringify(p.keyframes).includes('"translate"'));
    expect(byTruck(second)).toEqual({ 101: SLIDE(1) });
    act(() => recorder.finishAll());
    expect(leftovers()).toEqual(AT_REST);
  });

  it('under reduced motion a pin and an unpin play nothing, and the board ends in the same markup', async () => {
    await render();
    await pinTruck(303);
    await unpinTruck(303);
    act(() => recorder.finishAll());
    const moved = markup();
    act(() => root!.unmount());
    root = createRoot(container!);
    freshStore();
    unreduce = reduceMotion();
    await render();
    await pinTruck(303);
    await unpinTruck(303);
    expect(recorder.played).toEqual([]);
    expect(markup()).toBe(moved);
  });
});

describe('density: the density a person chooses (§12.159)', () => {
  it('Compact: each row in view glides from its old top to its new one, 390ms, in the commit the rows change height in', async () => {
    await render();
    const before = commits.length;
    await toHeight('32px', () => act(async () => densityButton('compact').click()));
    // 28, 72, 116 and 160 become 28, 60, 92 and 124: the first has nowhere to go.
    expect(byTruck(slides())).toEqual({ 202: SLIDE(12), 303: SLIDE(24), 404: SLIDE(36) });
    expect([...stars(), ...fades()]).toEqual([]);
    for (const p of slides()) expect((p.el as HTMLElement).style.zIndex).toBe('');
    // The commit the rows are 32px tall in has the three glides already: the height jumps with them.
    expect(commits.slice(before).find((c) => c.height === '32px')?.slides).toBe(3);
    act(() => recorder.finishAll());
    expect(leftovers()).toEqual(AT_REST);
  });

  it('D goes back the same way, the other direction', async () => {
    store.set('ft.density', 'compact');
    await render();
    await toHeight('44px', () => press('d'));
    expect(byTruck(slides())).toEqual({ 202: SLIDE(-12), 303: SLIDE(-24), 404: SLIDE(-36) });
  });

  it('the palette’s density does it too', async () => {
    await render();
    await toHeight('32px', () => paletteAction('Switch to compact rows'));
    expect(byTruck(slides())).toEqual({ 202: SLIDE(12), 303: SLIDE(24), 404: SLIDE(36) });
  });

  it('rows whose new place is out of view jump; one coming from past the edge starts just past it', async () => {
    const many = Array.from({ length: 30 }, (_, i) => truck(100 + i));
    store.set('ft.density', 'compact');
    await render(many);
    await toHeight('44px', () => press('d'));
    // Row i: compact 28 + 32i, comfortable 28 + 44i. Its new place is in the 600px view for i = 0..12.
    const moved = byTruck(slides());
    expect(Object.keys(moved).map(Number)).toEqual(Array.from({ length: 12 }, (_, i) => 101 + i));
    expect(moved[101]).toEqual(SLIDE(-12));
    expect(moved[112]).toEqual(SLIDE(-144));
    act(() => recorder.finishAll());
    recorder.played.length = 0;
    // Back to compact: row 14 was at 644, past the 600px edge, and goes to 476: it starts at 600.
    await toHeight('32px', () => press('d'));
    expect(byTruck(slides())[114]).toEqual(SLIDE(124));
  });

  it('a stored density on load plays nothing', async () => {
    store.set('ft.density', 'compact');
    await render();
    expect(rowEl(101).style.height).toBe('32px');
    expect(atLoad).toEqual([]);
  });

  it('a poll and a resize play nothing', async () => {
    await render();
    await poll([truck(101), truck(202), truck(303), truck(404)]);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(slides()).toEqual([]);
  });

  it('the density already chosen plays nothing', async () => {
    await render();
    await act(async () => densityButton('comfortable').click());
    expect(slides()).toEqual([]);
  });

  it('density during a pin’s glide lands it, and starts its own from where the rows are: nothing is left when it ends', async () => {
    await render();
    await pinTruck(303);
    const pinGlides = slides();
    expect(pinGlides).toHaveLength(4);
    await toHeight('32px', () => press('d'));
    expect(pinGlides.map((p) => p.animation.playState)).toEqual(['idle', 'idle', 'idle', 'idle']);
    // At rest in happy-dom (it draws no animation): 303 52 to 52, 101 97 to 85, 202 141 to 117, 404 185 to 149.
    expect(byTruck(slides().slice(4))).toEqual({ 101: SLIDE(12), 202: SLIDE(24), 404: SLIDE(36) });
    act(() => recorder.finishAll());
    expect(leftovers()).toEqual(AT_REST);
  });

  it('under reduced motion Compact and D play nothing, and the board ends in the same markup', async () => {
    await render();
    await toHeight('32px', () => act(async () => densityButton('compact').click()));
    await toHeight('44px', () => press('d'));
    act(() => recorder.finishAll());
    const moved = markup();
    act(() => root!.unmount());
    root = createRoot(container!);
    freshStore();
    unreduce = reduceMotion();
    await render();
    await toHeight('32px', () => act(async () => densityButton('compact').click()));
    await toHeight('44px', () => press('d'));
    expect(recorder.played).toEqual([]);
    expect(markup()).toBe(moved);
  });
});
