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
 * §12.160, the phone's two motions, on the real console at 390px: phPane, the pane a person taps
 * on the List | Map tabs coming in from its side; phSheet, the truck sheet and More coming up from
 * the bottom, and the copy of one a person closes going back down. Each on its own cause, with
 * its numbers written out; every non-cause the brief names starts nothing. happy-dom draws no
 * CSS: a sheet's motion is its classes here, and what they draw is `e2e/new-motion.spec.ts`'s
 * ("phase 3bt"), with the map's canvas.
 */

// The tokens as a copy this file may change: some tests take a motion back to 0.
vi.mock('@/design/tokens', async (original) => {
  const tokens = await original<typeof import('@/design/tokens')>();
  return { ...tokens, MOTION_MS: { ...tokens.MOTION_MS } };
});
vi.mock('../map/FleetMap', () => ({
  FleetMap: () => createElement('div', { 'data-testid': 'map' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { Console } = await import('../Console');
const { MOTION_MS } = await import('@/design/tokens');
const tokens = MOTION_MS as unknown as Record<'phPane' | 'phSheet', number>;
const atZero = (name: 'phPane' | 'phSheet') => {
  const was = tokens[name];
  tokens[name] = 0;
  return () => {
    tokens[name] = was;
  };
};

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

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};
let recorder: ReturnType<typeof recordAnimations>;
let undo: (() => void)[] = [];
const store = new Map<string, string>();
/** Each commit: the pane shown on the phone, what had swung by then, and the sheet's opening. */
let commits: { pane: string | null; swings: number; sheet: string | null }[];

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
  restoreLayout = stubLayout({ width: 390, height: 800 });
  recorder = recordAnimations();
  commits = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.querySelectorAll('[data-dialog-fading]').forEach((n) => n.remove());
  restoreLayout();
  recorder.restore();
  undo.forEach((u) => u());
  undo = [];
  root = null;
  container = null;
});

const paneOf = (name: 'list' | 'map') =>
  container!.querySelector<HTMLElement>(`[data-pane="${name}"]`)!;
/** The pane the phone shows: the one its class does not hide below 768px. */
const shownPane = () =>
  (['list', 'map'] as const).find((p) => !paneOf(p).className.includes('max-md:hidden')) ?? null;
const swings = () => recorder.played.filter((p) => p.el.hasAttribute('data-pane'));
const sheetPanel = () =>
  document.querySelector<HTMLElement>('[data-truck-sheet], [data-phone-more-sheet]');

const render = async (fleet = FOUR) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(
        Profiler,
        {
          id: 'console',
          onRender: () =>
            void commits.push({
              pane: shownPane(),
              swings: swings().length,
              sheet: sheetPanel()
                ? (sheetPanel()!.className.match(/animate-[a-z-]+/)?.[0] ?? '')
                : null,
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
  await untilShown('the cards', () => container!.querySelectorAll('[data-phone-card]').length === 4);
  act(() => recorder.finishAll());
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
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
};
const tab = (name: 'list' | 'map') =>
  container!.querySelector<HTMLButtonElement>(`[data-phone-tab="${name}"]`)!;
const tapTab = async (name: 'list' | 'map') => {
  await click(tab(name));
  await untilShown(`the ${name} pane`, () => shownPane() === name);
};
const card = (n: number) =>
  container!.querySelector<HTMLButtonElement>(`[data-phone-card="${idOf(n)}"]`)!;
const poll = async (fleet: FleetResponse['fleet'], at: string) => {
  await act(async () => {
    client.setQueryData(['fleet'], answer(fleet, at));
  });
};
const SWING = (dx: number) => ({
  keyframes: [
    { opacity: 0, translate: `${dx}px 0` },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: CURVE,
});
const shape = (p: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }) => ({
  keyframes: p.keyframes,
  ...p.options,
});
/** What clips the swing: the plain box around the split's own. */
const splitBox = () => paneOf('list').parentElement!.parentElement!;
const markup = () => container!.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_');

const openTruckSheet = async (n: number) => {
  card(n).focus();
  await click(card(n));
  await untilShown('the truck sheet', () => document.querySelector('[data-truck-sheet]') !== null);
};
const openMore = async () => {
  const more = container!.querySelector<HTMLButtonElement>('button[aria-label^="More filters"]')!;
  more.focus();
  await click(more);
  await untilShown('the More sheet', () => document.querySelector('[data-phone-more-sheet]') !== null);
};
/** The frame around the real sheet: its scrim, the tap to close, then the panel. */
const frameOf = (panel: HTMLElement) => panel.parentElement!;
/** The panel's opening, ended as the browser ends it. */
const endOpening = (panel: HTMLElement) =>
  act(() => {
    panel.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
const copies = () => [...document.querySelectorAll<HTMLElement>('[data-dialog-fading]')];
function buttonIn(scope: string, name: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>(`${scope} button`)].find(
    (b) => b.textContent?.trim() === name,
  )!;
}

describe('phPane: the pane a person taps comes in from its side (§12.160)', () => {
  it('Map: the map comes in from 40px to the right, fading in, 270ms, in the commit the pane changes; the list is hidden at once', async () => {
    await render();
    expect(shownPane()).toBe('list');
    const before = commits.length;
    await tapTab('map');
    expect(swings().map(shape)).toEqual([SWING(40)]);
    expect(swings()[0]!.el).toBe(paneOf('map'));
    // The first commit showing the map has its swing already, and the list already hidden.
    expect(commits.slice(before).find((c) => c.pane === 'map')?.swings).toBe(1);
    // The box clips sideways while it is on its way, and lets go when it lands.
    expect(splitBox().style.overflowX).toBe('clip');
    act(() => recorder.finishAll());
    expect(splitBox().getAttribute('style')).toBeNull();
    expect(paneOf('map').getAttribute('style')).toBeNull();
  });

  it('List: the list comes back in from 40px to the left', async () => {
    await render();
    await tapTab('map');
    act(() => recorder.finishAll());
    recorder.played.length = 0;
    await tapTab('list');
    expect(swings().map(shape)).toEqual([SWING(-40)]);
    expect(swings()[0]!.el).toBe(paneOf('list'));
  });

  it('a tap on the pane already shown plays nothing', async () => {
    await render();
    await click(tab('list'));
    expect(swings()).toEqual([]);
  });

  it('the pane on load, a poll and "Show on map" play nothing on a pane', async () => {
    await render();
    expect(swings()).toEqual([]);
    await poll([truck(101, 'LATE'), truck(202), truck(303), truck(404)], '2026-09-18T12:00:20.000Z');
    expect(swings()).toEqual([]);
    await openTruckSheet(202);
    await click(buttonIn('[data-truck-sheet]', 'Show on map'));
    await untilShown('the map pane', () => shownPane() === 'map');
    expect(swings()).toEqual([]);
  });

  it('a tap during the other pane’s swing: that one lands where it is, the new one plays, nothing is left', async () => {
    await render();
    await tapTab('map');
    const first = swings()[0]!;
    await tapTab('list');
    expect(first.animation.playState).toBe('idle');
    expect(swings().map(shape)).toEqual([SWING(40), SWING(-40)]);
    act(() => recorder.finishAll());
    expect(splitBox().getAttribute('style')).toBeNull();
  });

  it('a poll during the swing neither restarts nor doubles it', async () => {
    await render();
    await tapTab('map');
    await poll([truck(101, 'LATE'), truck(202), truck(303), truck(404)], '2026-09-18T12:00:20.000Z');
    await poll(FOUR, '2026-09-18T12:00:40.000Z');
    expect(swings()).toHaveLength(1);
    expect(swings()[0]!.animation.playState).toBe('running');
  });

  it('with its token at 0 nothing plays', async () => {
    undo.push(atZero('phPane'));
    await render();
    await tapTab('map');
    await tapTab('list');
    expect(swings()).toEqual([]);
    expect(splitBox().getAttribute('style')).toBeNull();
  });

  it('under reduced motion nothing plays, and the page ends in the same markup', async () => {
    await render();
    await tapTab('map');
    act(() => recorder.finishAll());
    const moved = markup();
    act(() => root!.unmount());
    root = createRoot(container!);
    undo.push(reduceMotion());
    recorder.played.length = 0;
    await render();
    await tapTab('map');
    expect(swings()).toEqual([]);
    expect(markup()).toBe(moved);
  });
});

describe('phSheet: a sheet a person opens comes up from the bottom (§12.160)', () => {
  it('a card’s tap: the panel comes up from below, its tap-to-close fades in, in the commit it opens; nothing is left when it ends', async () => {
    await render();
    const before = commits.length;
    await openTruckSheet(202);
    const panel = sheetPanel()!;
    const frame = frameOf(panel);
    const backdrop = frame.firstElementChild as HTMLElement;
    // Mounted, then its opening decided in the frame's layout effect, which commits again before
    // the first paint (§12.148's `useOpening`): the sheet is never painted without its opening.
    expect(
      commits
        .slice(before)
        .filter((c) => c.sheet !== null)
        .slice(0, 2)
        .map((c) => c.sheet),
    ).toEqual(['', 'animate-sheet-in']);
    expect(panel.classList.contains('animate-sheet-in')).toBe(true);
    expect(panel.classList.contains('animate-dialog-in')).toBe(false);
    // The scrim's own fade, on the backdrop: the panel coming up is not faded with the frame.
    expect(backdrop.classList.contains('animate-scrim-in')).toBe(true);
    expect(frame.classList.contains('animate-scrim-in')).toBe(false);
    await endOpening(panel);
    expect(panel.className).not.toMatch(/animate-/);
    expect(backdrop.className).not.toMatch(/animate-/);
    expect([
      panel.getAttribute('style'),
      frame.getAttribute('style'),
      backdrop.getAttribute('style'),
    ]).toEqual([null, null, null]);
  });

  it('More comes up the same way', async () => {
    await render();
    await openMore();
    const panel = sheetPanel()!;
    expect(panel.classList.contains('animate-sheet-in')).toBe(true);
    expect((frameOf(panel).firstElementChild as HTMLElement).classList.contains('animate-scrim-in')).toBe(
      true,
    );
  });

  it('a poll during the opening neither restarts nor replays it', async () => {
    await render();
    await openTruckSheet(202);
    const panel = sheetPanel()!;
    await poll([truck(101), truck(202, 'LATE'), truck(303), truck(404)], '2026-09-18T12:00:20.000Z');
    expect(sheetPanel()).toBe(panel);
    expect(panel.classList.contains('animate-sheet-in')).toBe(true);
    await endOpening(panel);
    await poll(FOUR, '2026-09-18T12:00:40.000Z');
    expect(panel.className).not.toMatch(/animate-/);
    expect(copies()).toEqual([]);
  });
});

describe('phSheet: a sheet a person closes leaves a copy that goes back down (§12.160)', () => {
  const closers: [string, () => Promise<void>, () => HTMLElement][] = [
    ['the truck sheet’s Close', () => openTruckSheet(202), () => buttonIn('[data-truck-sheet]', 'Close')],
    [
      'the truck sheet’s tap outside it',
      () => openTruckSheet(202),
      () => document.querySelector<HTMLElement>('button[aria-label="Close the truck sheet"]')!,
    ],
    [
      'the truck sheet’s Show on map',
      () => openTruckSheet(202),
      () => buttonIn('[data-truck-sheet]', 'Show on map'),
    ],
    ['More’s Done', openMore, () => buttonIn('[data-phone-more-sheet]', 'Done')],
    [
      'More’s tap outside it',
      openMore,
      () => document.querySelector<HTMLElement>('button[aria-label="Close filters"]')!,
    ],
  ];
  for (const [name, open, closer] of closers) {
    it(`${name}: the copy’s scrim fades, its panel goes down, and then it goes`, async () => {
      await render();
      await open();
      await endOpening(sheetPanel()!);
      await click(closer());
      await untilShown('the copy', () => copies().length === 1);
      const [copy] = copies();
      expect(sheetPanel()).toBeNull();
      expect(copy!.className).toBe('fixed inset-0 z-40 md:hidden pointer-events-none');
      expect((copy!.firstElementChild as HTMLElement).classList.contains('animate-sheet-scrim-out')).toBe(
        true,
      );
      expect((copy!.lastElementChild as HTMLElement).classList.contains('animate-sheet-out')).toBe(true);
      // It goes when its panel is down.
      act(() => {
        copy!.lastElementChild!.dispatchEvent(new Event('animationend', { bubbles: true }));
      });
      expect(copies()).toEqual([]);
    });
  }

  it('the copy matches nothing: no role, no aria-modal, no label, no data attribute but its own mark; inert and hidden', async () => {
    await render();
    await openTruckSheet(202);
    await click(buttonIn('[data-truck-sheet]', 'Close'));
    await untilShown('the copy', () => copies().length === 1);
    const [copy] = copies();
    const all = [copy!, ...copy!.querySelectorAll<HTMLElement>('*')];
    const named = all.flatMap((el) =>
      [...el.attributes]
        .map((a) => a.name)
        .filter((a) => /^(id|name|for|role|tabindex|aria-label|aria-modal|aria-pressed|data-.*)$/.test(a)),
    );
    expect(named).toEqual(['data-dialog-fading']);
    expect([copy!.getAttribute('inert'), copy!.getAttribute('aria-hidden')]).toEqual(['', 'true']);
    // Every selector the real sheet and its controls are found by finds nothing in it.
    for (const selector of [
      '[role="dialog"]',
      '[aria-modal]',
      '[data-truck-sheet]',
      '[aria-label="Truck 202"]',
      '[aria-label="Close the truck sheet"]',
      '[data-sheet-field]',
    ]) {
      expect(copy!.matches(selector) || copy!.querySelector(selector) !== null).toBe(false);
    }
  });

  it('focus goes back to the card, as it does with phSheet at 0', async () => {
    await render();
    await openTruckSheet(202);
    await click(buttonIn('[data-truck-sheet]', 'Close'));
    await untilShown('the sheet gone', () => sheetPanel() === null);
    expect(document.activeElement).toBe(card(202));
    act(() => root!.unmount());
    root = createRoot(container!);
    undo.push(atZero('phSheet'));
    await render();
    await openTruckSheet(202);
    await click(buttonIn('[data-truck-sheet]', 'Close'));
    await untilShown('the sheet gone', () => sheetPanel() === null);
    expect(document.activeElement).toBe(card(202));
  });

  it('with phSheet at 0 the sheets are §12.148’s: they rise, and a close leaves a fading copy', async () => {
    undo.push(atZero('phSheet'));
    await render();
    await openTruckSheet(202);
    const panel = sheetPanel()!;
    expect(panel.classList.contains('animate-dialog-in')).toBe(true);
    expect(frameOf(panel).classList.contains('animate-scrim-in')).toBe(true);
    expect((frameOf(panel).firstElementChild as HTMLElement).className).not.toMatch(/animate-/);
    await endOpening(panel);
    await click(buttonIn('[data-truck-sheet]', 'Close'));
    await untilShown('the copy', () => copies().length === 1);
    expect(copies()[0]!.className).toBe(
      'fixed inset-0 z-40 md:hidden pointer-events-none animate-window-out',
    );
    expect(copies()[0]!.querySelector('[class*="animate-sheet"]')).toBeNull();
  });

  it('under reduced motion they do what they do today: no opening, no copy', async () => {
    undo.push(reduceMotion());
    await render();
    await openTruckSheet(202);
    expect(sheetPanel()!.className).not.toMatch(/animate-/);
    expect((frameOf(sheetPanel()!).firstElementChild as HTMLElement).className).not.toMatch(/animate-/);
    await click(buttonIn('[data-truck-sheet]', 'Close'));
    await untilShown('the sheet gone', () => sheetPanel() === null);
    await untilShown('the commit over', () => true);
    expect(copies()).toEqual([]);
  });
});
