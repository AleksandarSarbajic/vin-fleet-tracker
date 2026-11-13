// @vitest-environment happy-dom
import { createElement, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { FleetResponse } from '@/hooks/useFleet';
import type { SavedView } from '@/lib/views';
import type { FleetTruck } from '@/lib/truck-lists';
import type { TimelineStop } from '@/server/timeline';
import type { PaletteTruck } from '@/lib/palette';
import { ListFooter } from './ListFooter';
import { ScopeMenu } from './SavedViews';
import { TruckListEditor } from './TruckListEditor';
import { TruckTimeline } from './TruckTimeline';
import { CommandPalette } from '../overlay/CommandPalette';
import { OverlayProvider } from '../overlay/OverlayLayer';

/**
 * §12.156, the board's five medium motions, each on its own surface. What starts each one is
 * a person's cause and nothing else: each has a test that its cause starts it at its own length,
 * written out, a test for every non-cause the brief names, and one under reduced motion. Real
 * frames, scrollers and presses are `e2e/new-motion.spec.ts`'s ("phase 3bo").
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

const CURVE = 'cubic-bezier(.22,.61,.36,1)';

let root: Root;
let container: HTMLDivElement;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
const restores: (() => void)[] = [];
const store = new Map<string, string>();

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
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  recorder.restore();
  unreduce?.();
  unreduce = null;
  while (restores.length) restores.pop()!();
  vi.unstubAllGlobals();
});

const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });
const on = (match: (el: Element) => boolean) =>
  recorder.played.filter((p) => match(p.el));
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const clickOn = (el: Element) =>
  act(() => {
    (el as HTMLElement).click();
  });
const buttonNamed = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  )!;

/**
 * Places by order, as a list lays them out: a view row 40px below the one before, a truck 60px
 * right of the one before, a palette row 36px below. happy-dom lays nothing out, so without
 * this every place is the same and nothing has anywhere to slide from.
 */
function stubPlaces({ recentres = false }: { recentres?: boolean } = {}) {
  const indexIn = (el: Element, selector: string) =>
    [...(el.parentElement?.children ?? [])]
      .filter((c) => c.matches(selector))
      .indexOf(el);
  /*
   * The list editor is centred on the screen, so when its paste box empties (and the line under
   * it goes) the whole window moves down: here 26px, the measured 26.6 rounded.
   */
  const listTop = () => {
    const paste = document.querySelector<HTMLTextAreaElement>('textarea');
    return 200 + (recentres && paste?.value === '' ? 26 : 0);
  };
  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function place(this: Element): DOMRect {
    if (this.matches('[data-view-row]'))
      return new DOMRect(0, 100 + indexIn(this, '[data-view-row]') * 40, 360, 40);
    if (this.matches('[data-view-rows]')) return new DOMRect(0, 100, 360, 400);
    if (this.matches('[data-list-chip]'))
      return new DOMRect(indexIn(this, '[data-list-chip]') * 60, listTop(), 56, 20);
    if (this.matches('ul')) return new DOMRect(0, listTop(), 600, 60);
    return new DOMRect(0, 0, 600, 600);
  };
  const options = () => [...document.querySelectorAll('[role="option"]')];
  const top = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      // The cursor's overlay stands where its `top` puts it, as in a browser.
      if (this.hasAttribute('data-cursor-slide')) return parseFloat(this.style.top);
      const i = options().indexOf(this);
      return i < 0 ? 0 : 4 + i * 36;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.matches('[role="option"]')) return 36;
      if (this.matches('[data-view-row]')) return 40;
      if (this.matches('[data-list-chip]')) return 20;
      return 0;
    },
  });
  restores.push(() => {
    Element.prototype.getBoundingClientRect = realRect;
    if (top) Object.defineProperty(HTMLElement.prototype, 'offsetTop', top);
    if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  });
}

/* ------------------------------------------------------------------ views */

describe('views: a saved view added or deleted, in the Fleet menu', () => {
  const view = (id: string, name: string): SavedView => ({
    id,
    name,
    query: '',
    chips: ['late'],
  });
  const THREE = [view('v1', 'Late east'), view('v2', 'Late west'), view('v3', 'Night')];

  function Harness({ initial }: { initial: SavedView[] }) {
    const [views, setViews] = useState(initial);
    return (
      <ScopeMenu
        views={views}
        active={null}
        onApply={() => {}}
        onSave={(name) => {
          setViews((v) => [...v, view(`v${v.length + 1}`, name)]);
          return null;
        }}
        onRemove={(id) => setViews((v) => v.filter((x) => x.id !== id))}
        onRename={(id, name) => {
          setViews((v) => v.map((x) => (x.id === id ? { ...x, name } : x)));
          return null;
        }}
        canSaveCurrent
        scopeCount={3}
        fleetCount={3}
        viewCount={() => 1}
        onClear={() => {}}
      />
    );
  }
  const mount = (initial = THREE) =>
    act(() => root.render(<Harness initial={initial} />));
  const openMenu = () => clickOn(container.querySelector('[aria-haspopup="menu"]')!);
  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-view-row]')];
  const box = () => container.querySelector<HTMLElement>('[data-view-rows]')!;
  const onRows = () => on((el) => el.hasAttribute('data-view-row'));
  const copy = () => box().querySelector<HTMLElement>('[data-leaving-copy]');
  const save = (name: string) => {
    clickOn(buttonNamed('Save current view…'));
    const field = container.querySelector<HTMLInputElement>(
      'input[aria-label="Name this view"]',
    )!;
    setValue(field, name);
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  };
  const DROP_14 = {
    keyframes: [
      { opacity: 0, translate: '0 -14px' },
      { opacity: 1, translate: '0 0' },
    ],
    duration: 270,
    easing: CURVE,
  };

  it('a person’s Save: the new row drops 14px in 270ms, and no other row moves', () => {
    stubPlaces();
    mount();
    openMenu();
    save('Morning');
    const added = rows().find((r) => r.textContent?.includes('Morning'))!;
    expect(onRows().map((p) => [p.el, shape(p)])).toEqual([[added, DROP_14]]);
  });

  it('the menu opening plays nothing on its rows, nor does a rename or the find box', () => {
    stubPlaces();
    mount();
    openMenu();
    expect(rows()).toHaveLength(3);
    clickOn(buttonNamed('Rename the view Night'));
    const field = container.querySelector<HTMLInputElement>(
      'input[aria-label="New name for Night"]',
    )!;
    setValue(field, 'Nights');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    setValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Find a list or view"]',
      )!,
      'late',
    );
    setValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Find a list or view"]',
      )!,
      '',
    );
    expect(rows()).toHaveLength(3);
    expect(onRows()).toEqual([]);
    expect(on((el) => el.hasAttribute('data-leaving-copy'))).toEqual([]);
  });

  it('a person’s Delete: a copy goes back up 14px and fades in 270ms, the rows below slide up 40px in 270ms, and nothing is left once they land', () => {
    stubPlaces();
    mount();
    openMenu();
    clickOn(buttonNamed('Delete the view Late east'));
    expect(rows().map((r) => r.dataset.viewRow)).toEqual(['v2', 'v3']);
    const leaving = on((el) => el.hasAttribute('data-leaving-copy'));
    expect(leaving.map(shape)).toEqual([
      {
        keyframes: [
          { opacity: 1, translate: '0 0' },
          { opacity: 0, translate: '0 -14px' },
        ],
        duration: 270,
        easing: CURVE,
      },
    ]);
    expect(copy()?.textContent).toContain('Late east');
    expect(copy()?.style.top).toBe('0px');
    const SLIDE_UP = {
      keyframes: [{ translate: '0px 40px' }, { translate: '0 0' }],
      duration: 270,
      easing: CURVE,
    };
    expect(
      onRows().map((p) => [(p.el as HTMLElement).dataset.viewRow, shape(p)]),
    ).toEqual([
      ['v2', SLIDE_UP],
      ['v3', SLIDE_UP],
    ]);
    // The rows' own box clips while they land, never the scroller around it.
    expect(box().style.overflow).toBe('clip');
    expect(
      container.querySelector<HTMLElement>('[data-view-list]')!.getAttribute('style'),
    ).toBeNull();
    act(() => recorder.finishAll());
    expect(copy()).toBeNull();
    expect(box().getAttribute('style')).toBeNull();
  });

  it('the copy can take no press: inert, hidden, no pointer, behind the rows, with no control and nothing to find it by', () => {
    stubPlaces();
    mount();
    openMenu();
    clickOn(buttonNamed('Delete the view Late west'));
    const left = copy()!;
    expect(left.hasAttribute('inert')).toBe(true);
    expect(left.getAttribute('aria-hidden')).toBe('true');
    expect(left.classList.contains('pointer-events-none')).toBe(true);
    expect(left.classList.contains('-z-10')).toBe(true);
    expect(
      left.querySelectorAll(
        'button, a, input, [role], [aria-label], [id], [data-view-row]',
      ),
    ).toHaveLength(0);
    expect(left.textContent).toContain('Late west');
    // It stands first, behind the live rows, in the rows' own box.
    expect(box().firstElementChild).toBe(left);
  });

  it('the last view deleted: the list goes, and nothing is left behind', () => {
    stubPlaces();
    mount([view('v1', 'Only')]);
    openMenu();
    clickOn(buttonNamed('Delete the view Only'));
    expect(container.querySelector('[data-view-rows]')).toBeNull();
    expect(container.querySelector('[data-leaving-copy]')).toBeNull();
    expect(container.textContent).toContain('No saved views yet');
  });

  it('under reduced motion a Save and a Delete start nothing and leave no copy', () => {
    stubPlaces();
    unreduce = reduceMotion();
    mount();
    openMenu();
    save('Morning');
    clickOn(buttonNamed('Delete the view Late east'));
    expect(rows().map((r) => r.textContent?.includes('Morning'))).toEqual([
      false,
      false,
      true,
    ]);
    expect(onRows()).toEqual([]);
    expect(container.querySelector('[data-leaving-copy]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ foot */

describe('foot: the list footer’s numbers and words, on a person’s chip', () => {
  const r = (n: number, status: 'LATE' | 'ON_TIME') =>
    fleetRow({
      id: `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      truckNumber: n,
      status,
    });
  const ALL = [
    r(1, 'LATE'),
    r(2, 'LATE'),
    r(3, 'ON_TIME'),
    r(4, 'ON_TIME'),
    r(5, 'LATE'),
  ];
  const render = (
    rows: ReturnType<typeof r>[],
    first: number,
    last: number,
    cause: string,
  ) =>
    act(() =>
      root.render(
        <ListFooter rows={rows} firstVisible={first} lastVisible={last} cause={cause} />,
      ),
    );
  const part = (name: string) =>
    container.querySelector<HTMLElement>(`[data-foot="${name}"]`)!;
  const onPart = (name: string) =>
    on((el) => part(name)?.contains(el) || el === part(name));
  /** What React drew, without the old number a roll keeps beside it while it goes. */
  const shown = () =>
    ['from', 'to', 'total']
      .map((name) => part(name).firstElementChild?.textContent)
      .join(' ');
  const ROLL_DOWN = {
    keyframes: [
      { transform: 'translateY(-100%)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ],
    duration: 360,
    easing: CURVE,
  };
  const FADE_360 = {
    keyframes: [{ opacity: 0 }, { opacity: 1 }],
    duration: 360,
    easing: 'linear',
  };

  beforeEach(() => {
    restores.push(stubLayout({ width: 1100, height: 600 }));
  });

  it('a chip: the numbers that changed roll in 360ms, the words that changed fade in 360ms', () => {
    render(ALL, 0, 2, '');
    expect(container.textContent).toContain('Showing 1–3 of 5');
    render(
      ALL.filter((x) => x.status === 'LATE'),
      0,
      1,
      'late',
    );
    expect(shown()).toBe('1 2 3');
    expect(onPart('from')).toEqual([]);
    // The new number comes down into its place, and the old one goes on down out of it.
    expect(onPart('to').map(shape)[0]).toEqual(ROLL_DOWN);
    expect(onPart('total').map(shape)[0]).toEqual(ROLL_DOWN);
    expect(onPart('to')).toHaveLength(2);
    expect(onPart('total')).toHaveLength(2);
    // Below the fold: "1 problem" before and after, so those words stay; "2 below: 1 on time,
    // 1 late" became "1 below: 1 late", so those fade in.
    expect(container.textContent).toContain('1 problem below the fold');
    expect(onPart('problems')).toEqual([]);
    expect(onPart('below').map(shape)).toEqual([FADE_360]);
    act(() => recorder.finishAll());
    expect(container.querySelectorAll('[data-roll-copy]')).toHaveLength(0);
    expect(part('total').getAttribute('style')).toBeNull();
  });

  it('a scroll changes the numbers at once: nothing rolls or fades', () => {
    render(ALL, 0, 2, 'late');
    render(ALL, 1, 3, 'late');
    render(ALL, 2, 4, 'late');
    expect(container.textContent).toContain('Showing 3–5 of 5');
    expect(recorder.played).toEqual([]);
  });

  it('a poll changes them at once: nothing rolls or fades', () => {
    render(ALL, 0, 2, '');
    render(ALL.slice(0, 4), 0, 2, '');
    render([...ALL, r(6, 'LATE')], 0, 2, '');
    expect(container.textContent).toContain('of 6');
    expect(recorder.played).toEqual([]);
  });

  it('a scroll in the middle of a roll ends it at once, on the new number, with no copy left', () => {
    render(ALL, 0, 2, '');
    render(
      ALL.filter((x) => x.status === 'LATE'),
      0,
      1,
      'late',
    );
    const rolls = onPart('to');
    expect(rolls).toHaveLength(2);
    const started = recorder.played.length;
    render(
      ALL.filter((x) => x.status === 'LATE'),
      0,
      2,
      'late',
    );
    expect(rolls.map((p) => p.animation.playState)).toEqual(['idle', 'idle']);
    expect(part('to').querySelectorAll('[data-roll-copy]')).toHaveLength(0);
    expect(part('to').textContent).toBe('3');
    expect(recorder.played).toHaveLength(started);
  });

  it('under reduced motion a chip changes them and nothing starts', () => {
    unreduce = reduceMotion();
    render(ALL, 0, 2, '');
    render(
      ALL.filter((x) => x.status === 'LATE'),
      0,
      1,
      'late',
    );
    expect(container.textContent).toContain('Showing 1–2 of 3');
    expect(shown()).toBe('1 2 3');
    expect(recorder.played).toEqual([]);
  });
});

describe('foot, on the real board: a chip rolls it, and the chips are its only cause', () => {
  const row = (n: number, status: 'LATE' | 'ON_TIME') =>
    fleetRow({
      id: `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      truckNumber: n,
      samsaraName: `Truck #${n}`,
      status,
      computed: status,
      nextStop: nextStop({
        stopId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`,
      }),
    });
  const FLEET = [row(101, 'LATE'), row(202, 'LATE'), row(303, 'ON_TIME')];
  const answer = (fleet: FleetResponse['fleet']): FleetResponse => ({
    fleet,
    fetchedAt: '2026-09-18T12:00:00.000Z',
    feedStale: false,
    feedNewestAt: '2026-09-18T12:00:00.000Z',
  });
  let client: QueryClient;
  const mountBoard = async () => {
    restores.push(stubLayout({ width: 1100, height: 600 }));
    const { Console } = await import('./Console');
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchInterval: false } },
    });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Console, {
            initial: answer(FLEET),
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
  };
  const total = () => container.querySelector<HTMLElement>('[data-foot="total"]')!;
  const onTotal = () => on((el) => total().contains(el));

  it('the Late chip: the total rolls from 3 to 2 in 360ms', async () => {
    await mountBoard();
    expect(total().textContent).toBe('3');
    const late = [
      ...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
    ].find((b) => (b.textContent ?? '').startsWith('Late'))!;
    await act(async () => late.click());
    expect(total().firstElementChild?.textContent).toBe('2');
    expect(onTotal().map((p) => p.options.duration)).toEqual([360, 360]);
  });

  it('a poll that changes the total changes it at once', async () => {
    await mountBoard();
    await act(async () => {
      client.setQueryData(['fleet'], answer([...FLEET, row(404, 'ON_TIME')]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(total().textContent).toBe('4');
    expect(onTotal()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ palCursor */

describe('palCursor: the palette’s cursor, on the arrow keys', () => {
  const truck = (n: number, city: string): PaletteTruck => ({
    id: `t${n}`,
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    driverName: null,
    cityState: city,
    nextStop: null,
    formattedLocation: null,
  });
  const TRUCKS = [
    truck(101, 'Joliet, IL'),
    truck(202, 'Fargo, ND'),
    truck(303, 'Gary, IN'),
  ];
  // With the box empty the palette lists no trucks: these three views and its two actions.
  const VIEWS: SavedView[] = ['Late east', 'Late west', 'Night'].map((name, i) => ({
    id: `v${i + 1}`,
    name,
    query: '',
    chips: ['late'],
  }));
  const renderPalette = (trucks = TRUCKS) =>
    act(() => {
      root.render(
        <OverlayProvider>
          <CommandPalette
            trucks={trucks}
            views={VIEWS}
            selectedLabel={null}
            selectedPinned={false}
            density="comfortable"
            onSelectTruck={() => {}}
            onApplyView={() => {}}
            onTogglePin={() => {}}
            onToggleDensity={() => {}}
          />
        </OverlayProvider>,
      );
    });
  const open = () =>
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
      );
    });
  const field = () =>
    container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const key = (k: 'ArrowDown' | 'ArrowUp') =>
    act(() => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });
  const options = () => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  const active = () =>
    options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
  const slides = () => on((el) => el.hasAttribute('data-cursor-slide'));
  const SLIDE = (dy: number) => ({
    keyframes: [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
    duration: 270,
    easing: CURVE,
  });

  it('ArrowDown: the ground slides 36px down from the row it was on in 270ms, behind the rows, and nothing is left', () => {
    stubPlaces();
    renderPalette();
    open();
    key('ArrowDown');
    expect(active()).toBe(1);
    expect(slides().map(shape)).toEqual([SLIDE(-36)]);
    const overlay = slides()[0]!.el as HTMLElement;
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.className).toContain('-z-10');
    expect(overlay.style.top).toBe('40px');
    expect(options()[1]!.hasAttribute('data-cursor-target')).toBe(true);
    act(() => recorder.finishAll());
    expect(container.querySelector('[data-cursor-slide]')).toBeNull();
    expect(container.querySelector('[data-cursor-target]')).toBeNull();
  });

  it('ArrowUp: from below, and a second key takes it up from where it is drawn, one overlay at a time', () => {
    stubPlaces();
    renderPalette();
    open();
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowUp');
    expect(active()).toBe(1);
    expect(slides()).toHaveLength(3);
    expect(slides()[2]!.keyframes[0]).toEqual({ transform: 'translateY(36px)' });
    expect(container.querySelectorAll('[data-cursor-slide]')).toHaveLength(1);
  });

  it('the mouse pointing at a row moves the cursor at once: nothing slides, and a slide in flight lands', () => {
    stubPlaces();
    renderPalette();
    open();
    key('ArrowDown');
    expect(slides()).toHaveLength(1);
    act(() => {
      options()[2]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    expect(active()).toBe(2);
    expect(slides()).toHaveLength(1);
    expect(container.querySelector('[data-cursor-slide]')).toBeNull();
    expect(container.querySelector('[data-cursor-target]')).toBeNull();
  });

  it('typing, back to the first row, and the opening’s reset slide nothing', () => {
    stubPlaces();
    renderPalette();
    open();
    key('ArrowDown');
    key('ArrowDown');
    act(() => recorder.finishAll());
    const before = slides().length;
    setValue(field(), 'f');
    expect(active()).toBe(0);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
      );
    });
    open();
    expect(active()).toBe(0);
    expect(slides()).toHaveLength(before);
  });

  it('the box keeps the focus through a slide (§12.155)', () => {
    stubPlaces();
    renderPalette();
    open();
    field().focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(field());
    act(() => recorder.finishAll());
    expect(document.activeElement).toBe(field());
  });

  it('under reduced motion the cursor moves and nothing starts', () => {
    stubPlaces();
    unreduce = reduceMotion();
    renderPalette();
    open();
    key('ArrowDown');
    expect(active()).toBe(1);
    expect(slides()).toEqual([]);
    expect(container.querySelector('[data-cursor-target]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ listChips */

describe('listChips: trucks added or removed in the truck list editor', () => {
  const t = (n: number): FleetTruck => ({
    id: `t${n}`,
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    active: true,
  });
  const FLEET = [t(101), t(202), t(303), t(404)];
  const mount = (initialIds = ['t101', 't303'], checkedIds: string[] = []) => {
    const client = new QueryClient();
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TruckListEditor
            mode={{ kind: 'create', initialIds }}
            fleet={FLEET}
            checkedIds={checkedIds}
            canEdit
            onClose={() => {}}
            onSaved={() => {}}
            onDeleted={() => {}}
          />
        </QueryClientProvider>,
      );
    });
  };
  const chips = () => [...container.querySelectorAll<HTMLElement>('[data-list-chip]')];
  const onChips = () => on((el) => el.hasAttribute('data-list-chip'));
  const paste = () =>
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Truck numbers to add"]',
    )!;
  const POP_HALF = {
    keyframes: [
      { opacity: 0, scale: '0.5' },
      { opacity: 1, scale: '1' },
    ],
    duration: 270,
    easing: CURVE,
  };

  it('Add: only the truck added pops in from 50% in 270ms, and the truck it pushed slides 60px', () => {
    stubPlaces();
    mount();
    setValue(paste(), '202');
    clickOn(buttonNamed('Add 1'));
    expect(chips().map((c) => c.dataset.listChip)).toEqual(['t101', 't202', 't303']);
    expect(
      onChips().map((p) => [(p.el as HTMLElement).dataset.listChip, shape(p)]),
    ).toEqual([
      ['t202', POP_HALF],
      [
        't303',
        {
          keyframes: [{ translate: '-60px 0px' }, { translate: '0 0' }],
          duration: 270,
          easing: CURVE,
        },
      ],
    ]);
    act(() => recorder.finishAll());
    expect(container.querySelector('ul')!.getAttribute('style')).toBeNull();
    expect(container.querySelector('[data-arriving]')).toBeNull();
  });

  it('×: the truck leaves as a copy that shrinks to 50% and fades in 270ms, the one after it slides back, and nothing is left', () => {
    stubPlaces();
    mount(['t101', 't202', 't303']);
    clickOn(buttonNamed('Remove truck 202'));
    expect(chips().map((c) => c.dataset.listChip)).toEqual(['t101', 't303']);
    const copy = container.querySelector<HTMLElement>('[data-leaving-copy]')!;
    expect(copy.textContent).toContain('202');
    expect(copy.hasAttribute('inert')).toBe(true);
    expect(copy.classList.contains('pointer-events-none')).toBe(true);
    expect(copy.querySelectorAll('button, [aria-label], [data-list-chip]')).toHaveLength(
      0,
    );
    expect(on((el) => el === copy).map(shape)).toEqual([
      {
        keyframes: [
          { opacity: 1, scale: '1' },
          { opacity: 0, scale: '0.5' },
        ],
        duration: 270,
        easing: CURVE,
      },
    ]);
    expect(
      onChips().map((p) => [(p.el as HTMLElement).dataset.listChip, p.keyframes[0]]),
    ).toEqual([['t303', { translate: '60px 0px' }]]);
    act(() => recorder.finishAll());
    expect(container.querySelector('[data-leaving-copy]')).toBeNull();
    expect(container.querySelector('ul')!.getAttribute('style')).toBeNull();
  });

  it('Add the checked rows: those pop, and only those', () => {
    stubPlaces();
    mount(['t101'], ['t404']);
    clickOn(buttonNamed('Add the 1 checked row'));
    expect(
      onChips().map((p) => [(p.el as HTMLElement).dataset.listChip, shape(p)]),
    ).toEqual([['t404', POP_HALF]]);
  });

  it('the window moving as a whole as the paste box empties slides nothing more: only the truck pushed along its line, 60px across and none down', () => {
    stubPlaces({ recentres: true });
    mount();
    setValue(paste(), '202');
    clickOn(buttonNamed('Add 1'));
    expect(
      onChips().map((p) => [(p.el as HTMLElement).dataset.listChip, p.keyframes[0]]),
    ).toEqual([
      ['t202', { opacity: 0, scale: '0.5' }],
      ['t303', { translate: '-60px 0px' }],
    ]);
  });

  it('the editor opening, its name typed, and numbers waiting in the paste box pop nothing: no chip is drawn for them', () => {
    stubPlaces();
    mount(['t101', 't303']);
    setValue(
      container.querySelector<HTMLInputElement>('input[aria-label="List name"]')!,
      'Night shift',
    );
    setValue(paste(), '202, 404');
    expect(chips()).toHaveLength(2);
    expect(container.querySelector('[data-list-count]')?.textContent).toContain(
      '4 trucks',
    );
    expect(onChips()).toEqual([]);
    expect(container.querySelector('[data-leaving-copy]')).toBeNull();
  });

  it('under reduced motion Add and × start nothing and leave no copy', () => {
    stubPlaces();
    unreduce = reduceMotion();
    mount();
    setValue(paste(), '202');
    clickOn(buttonNamed('Add 1'));
    clickOn(buttonNamed('Remove truck 101'));
    expect(chips().map((c) => c.dataset.listChip)).toEqual(['t202', 't303']);
    expect(onChips()).toEqual([]);
    expect(container.querySelector('[data-leaving-copy]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ timeline */

describe('timeline: the stop cards, when it opens', () => {
  const stop = (seq: number, over: Partial<TimelineStop> = {}): TimelineStop => ({
    stopId: `22222222-2222-4222-8222-22222222222${seq}`,
    loadId: '33333333-3333-4333-8333-333333333333',
    loadNumber: 'LD-4417',
    loadStatus: 'DISPATCHED',
    loadCreatedAt: '2026-09-18T06:00:00.000Z',
    sequence: seq,
    type: seq === 1 ? 'PU' : 'DEL',
    addressLine: '1 Broadway',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    apptStartUtc: null,
    apptEndUtc: null,
    apptTz: 'America/Chicago',
    apptType: 'APPT',
    arrivedAt: null,
    arrivedSource: null,
    departedAt: null,
    departedSource: null,
    dispatcherNote: null,
    noteAt: null,
    overrides: [],
    ...over,
  });
  const THREE = [stop(1), stop(2), stop(3)];
  let client: QueryClient;
  const mount = (
    cached: TimelineStop[] | null,
    fetched: Promise<TimelineStop[]> = Promise.resolve(THREE),
  ) => {
    restores.push(stubLayout({ width: 1100, height: 600 }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (cached) client.setQueryData(['timeline', 'truck-1'], cached);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ stops: await fetched }) })),
    );
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TruckTimeline
            truckId="truck-1"
            truckLabel="101"
            dispatchTz="America/Chicago"
            onClose={() => {}}
          />
        </QueryClientProvider>,
      );
    });
  };
  const cards = () => on((el) => el.hasAttribute('data-stop-state'));
  const lines = () => on((el) => el.hasAttribute('data-stop-line'));
  const DRAWN = (delay: number) => ({
    keyframes: [{ opacity: 0 }, { opacity: 1 }],
    duration: 180,
    delay,
    easing: 'linear',
    fill: 'backwards',
  });
  const GROWN = (delay: number) => ({
    keyframes: [{ scale: '1 0' }, { scale: '1 1' }],
    duration: 180,
    delay,
    easing: CURVE,
    fill: 'backwards',
  });

  it('cached: at the opening the cards in view draw, 180ms each, linear, 30ms apart, each line growing down with its card', () => {
    mount(THREE);
    expect(cards().map(shape)).toEqual([DRAWN(0), DRAWN(30), DRAWN(60)]);
    expect(lines().map(shape)).toEqual([GROWN(0), GROWN(30), GROWN(60)]);
    const line = container.querySelector('[data-stop-line]')!;
    expect(line.className).toContain('origin-top');
  });

  it('fetched: nothing at the opening, while it says Loading…, and the draw in the commit it lands in', async () => {
    let land: (stops: TimelineStop[]) => void = () => {};
    mount(null, new Promise((resolve) => (land = resolve)));
    expect(container.textContent).toContain('Loading…');
    expect(cards()).toEqual([]);
    await act(async () => {
      land(THREE);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelectorAll('[data-stop-state]')).toHaveLength(3);
    expect(cards().map(shape)).toEqual([DRAWN(0), DRAWN(30), DRAWN(60)]);
  });

  it('a refetch while it is open draws nothing: the cards change at once', async () => {
    mount(THREE);
    expect(cards()).toHaveLength(3);
    await act(async () => {
      client.setQueryData(['timeline', 'truck-1'], [...THREE, stop(4)]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelectorAll('[data-stop-state]')).toHaveLength(4);
    expect(cards()).toHaveLength(3);
    expect(lines()).toHaveLength(3);
  });

  it('a first answer with no cards spends it: cards that come later are simply there', async () => {
    mount([]);
    expect(container.textContent).toContain('Nothing on this truck');
    await act(async () => {
      client.setQueryData(['timeline', 'truck-1'], THREE);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelectorAll('[data-stop-state]')).toHaveLength(3);
    expect(cards()).toEqual([]);
  });

  it('opened again: it draws again, once', () => {
    mount(THREE);
    act(() => root.render(<div />));
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TruckTimeline
            truckId="truck-1"
            truckLabel="101"
            dispatchTz="America/Chicago"
            onClose={() => {}}
          />
        </QueryClientProvider>,
      );
    });
    expect(cards()).toHaveLength(6);
  });

  it('under reduced motion the cards are simply there', () => {
    unreduce = reduceMotion();
    mount(THREE);
    expect(container.querySelectorAll('[data-stop-state]')).toHaveLength(3);
    expect(cards()).toEqual([]);
    expect(lines()).toEqual([]);
  });
});
