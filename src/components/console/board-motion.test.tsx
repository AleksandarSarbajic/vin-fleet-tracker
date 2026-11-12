// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import { GROUND_POP } from '@/lib/appear-motion';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.152, the board's eight small motions, on the real console. What starts each one is
 * its cause, and nothing else: each has a test that its cause starts it, at its own length
 * written out, and a test that what is not its cause (a poll, a re-render, the page's own
 * first paint) does not. Real frames, presses and scrollers are `e2e/new-motion.spec.ts`'s.
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

const row = (n: number, status: 'LATE' | 'ON_TIME' | 'AT_RISK', driver: string | null = 'Sam') =>
  fleetRow({
    id: `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    driverName: driver,
    status,
    computed: status,
    nextStop: nextStop({ stopId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001` }),
  });
const A = row(101, 'LATE');
const B = row(202, 'LATE');
const C = row(303, 'ON_TIME');
const D = row(404, 'ON_TIME', null);

const answer = (fleet: FleetResponse['fleet'], feedStale = false): FleetResponse => ({
  fleet,
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
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
  unreduce?.();
  unreduce = null;
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

const render = async (fleet = [A, B, C], initialChips: string[] = [], feedStale = false) => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: answer(fleet, feedStale),
          initialHealth: fleetHealth(),
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
          initialQuery: '',
          initialTruck: null,
          initialChips,
          drivers: [],
          role: 'admin' as const,
        }),
      ),
    );
  });
};

const press = async (key: string) => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};
const poll = async (fleet: FleetResponse['fleet'], feedStale = false) => {
  await act(async () => {
    client.setQueryData(['fleet'], answer(fleet, feedStale));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const rowEl = (n: number) =>
  [...container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find((el) =>
    (el.textContent ?? '').includes(String(n)),
  );
const boxOf = (n: number) => rowEl(n)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const chip = (label: string) =>
  [...container!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) =>
    (b.textContent ?? '').startsWith(label),
  )!;
/** What played, by what it played on. */
const on = (match: (el: Element) => boolean) => recorder.played.filter((p) => match(p.el));
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });

const DROP_14 = {
  keyframes: [
    { opacity: 0, translate: '0 -14px' },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
};
const FADE_270 = { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 270, easing: 'linear' };
const POP_HALF = {
  keyframes: [
    { opacity: 0, scale: '0.5' },
    { opacity: 1, scale: '1' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
};

describe('chip: a chip’s chosen look', () => {
  it('a key turns Late on: its look grows in from 75% and All’s shrinks away, 270ms each', async () => {
    await render();
    await press('1');
    const looks = on((el) => el.hasAttribute(GROUND_POP));
    expect(looks.map((p) => [p.el.parentElement === chip('Late'), p.el.parentElement === chip('All')])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(shape(looks[1]!)).toEqual({
      keyframes: [
        { opacity: 0, scale: '0.75' },
        { opacity: 1, scale: '1' },
      ],
      duration: 270,
      easing: 'cubic-bezier(.22,.61,.36,1)',
    });
    expect(looks[0]!.keyframes).toEqual([
      { opacity: 1, scale: '1' },
      { opacity: 0, scale: '0.75' },
    ]);
  });

  it('a click does it too, and once it lands nothing is left on the chip', async () => {
    await render();
    await act(async () => chip('Late').click());
    expect(on((el) => el.hasAttribute(GROUND_POP))).toHaveLength(2);
    act(() => recorder.finishAll());
    expect(container!.querySelector(`[${GROUND_POP}]`)).toBeNull();
    expect(container!.querySelector('[data-ground-host]')).toBeNull();
  });

  it('a poll that changes every count plays no chip’s look', async () => {
    await render([A, B, C], ['late']);
    await poll([row(101, 'ON_TIME'), row(202, 'AT_RISK'), C]);
    expect(on((el) => el.hasAttribute(GROUND_POP))).toEqual([]);
  });

  it('the page’s first paint, with a chip already on, plays nothing', async () => {
    await render([A, B, C], ['late']);
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion nothing starts and nothing is added', async () => {
    unreduce = reduceMotion();
    await render();
    await press('1');
    expect(recorder.played).toEqual([]);
    expect(container!.querySelector(`[${GROUND_POP}]`)).toBeNull();
  });
});

describe('check: a row’s checkbox', () => {
  const boxPops = () => recorder.played.filter((p) => p.el instanceof HTMLInputElement && p.el.type === 'checkbox');

  it('a click on a box pops that box, 270ms from 50%, and leaves nothing on it', async () => {
    await render();
    await act(async () => boxOf(101).click());
    expect(boxPops().map((p) => p.el)).toEqual([boxOf(101)]);
    expect(shape(boxPops()[0]!)).toEqual(POP_HALF);
    act(() => recorder.finishAll());
    expect(boxOf(101).getAttribute('style')).toBeNull();
  });

  it('a click on the box’s place, in its cell, is the box’s: it checks, and the row is not selected', async () => {
    await render();
    const cell = boxOf(101).parentElement!;
    // The layout stub gives every box the same place, so this lands on it, as a press beside
    // a box still smaller than its place would.
    await act(async () => {
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 550, clientY: 300 }));
    });
    expect(boxOf(101).checked).toBe(true);
    expect(rowEl(101)!.getAttribute('aria-selected')).not.toBe('true');
    expect(boxPops().map((p) => p.el)).toEqual([boxOf(101)]);
  });

  it('a shift-click checks a range, and only the box pressed pops', async () => {
    await render();
    await act(async () => boxOf(101).click());
    act(() => recorder.finishAll());
    const before = boxPops().length;
    await act(async () => {
      boxOf(303).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    expect([101, 202, 303].map((n) => boxOf(n).checked)).toEqual([true, true, true]);
    expect(boxPops().slice(before).map((p) => p.el)).toEqual([boxOf(303)]);
  });

  it('X checks the selected row without a pop: no box was pressed', async () => {
    await render();
    await act(async () => rowEl(101)!.click());
    await press('x');
    expect(boxOf(101).checked).toBe(true);
    expect(boxPops()).toEqual([]);
  });

  it('a poll with boxes checked pops nothing', async () => {
    await render();
    await act(async () => boxOf(101).click());
    act(() => recorder.finishAll());
    const before = boxPops().length;
    await poll([A, row(202, 'AT_RISK'), C]);
    expect(boxPops().slice(before)).toEqual([]);
  });

  it('under reduced motion a click checks the box and nothing starts', async () => {
    unreduce = reduceMotion();
    await render();
    await act(async () => boxOf(101).click());
    expect(boxOf(101).checked).toBe(true);
    expect(recorder.played).toEqual([]);
  });
});

describe('empty: the empty list', () => {
  const empty = () => container!.querySelector('[data-empty]');

  it('a chip that leaves no rows: it drops in, 14px in 270ms', async () => {
    await render();
    await press('4'); // Arrived: none.
    expect(empty()).not.toBeNull();
    expect(on((el) => el === empty()).map(shape)).toEqual([DROP_14]);
  });

  it('a poll that empties a filtered list: it is simply there', async () => {
    await render([A, B, C], ['late']);
    await poll([row(101, 'ON_TIME'), row(202, 'ON_TIME'), C]);
    expect(empty()).not.toBeNull();
    expect(on((el) => el === empty())).toEqual([]);
  });

  it('a filter that is empty on the page’s first paint plays nothing', async () => {
    await render([A, B, C], ['arrived']);
    expect(empty()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });

  it('a second chip while it stands plays nothing more', async () => {
    await render();
    await press('4');
    await press('5'); // Tomorrow too: still none.
    expect(on((el) => el === empty())).toHaveLength(1);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await render();
    await press('4');
    expect(empty()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('feedBanner: the feed banner', () => {
  const banner = () => container!.querySelector('[role="alert"]');

  it('a poll that finds the feed stale: it fades in, opacity only, 270ms linear', async () => {
    await render();
    await poll([A, B, C], true);
    expect(banner()?.textContent).toContain('Position feed');
    expect(on((el) => el === banner()).map(shape)).toEqual([FADE_270]);
  });

  it('stale with the page: it is simply there', async () => {
    await render([A, B, C], [], true);
    expect(banner()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });

  it('another stale poll while it stands: nothing more', async () => {
    await render();
    await poll([A, B, C], true);
    await poll([A, row(202, 'AT_RISK'), C], true);
    expect(on((el) => el === banner())).toHaveLength(1);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await render();
    await poll([A, B, C], true);
    expect(banner()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('fetchBanner: the server cannot be reached', () => {
  const banner = () =>
    [...container!.querySelectorAll('[role="status"]')].find((el) =>
      (el.textContent ?? '').includes('reach the console server'),
    ) ?? null;
  const failPoll = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['fleet'] }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it('a poll that fails: it fades in, opacity only, 270ms linear', async () => {
    await render();
    await failPoll();
    expect(banner()).not.toBeNull();
    expect(on((el) => el === banner()).map(shape)).toEqual([FADE_270]);
  });

  it('a second failure while it stands: nothing more', async () => {
    await render();
    await failPoll();
    await failPoll();
    expect(on((el) => el === banner())).toHaveLength(1);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await render();
    await failPoll();
    expect(banner()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('reorder: the reorder bar', () => {
  const bar = () =>
    [...container!.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('reorder — click to sort'),
    ) ?? null;

  it('a poll that changes the order: it fades in, opacity only, 270ms linear', async () => {
    await render();
    await poll([row(101, 'ON_TIME'), B, row(303, 'LATE')]);
    expect(bar()).not.toBeNull();
    expect(on((el) => el === bar()).map(shape)).toEqual([FADE_270]);
  });

  it('a poll that changes its count while it is up: nothing more', async () => {
    await render([A, B, C, row(505, 'AT_RISK')]);
    await poll([row(101, 'ON_TIME'), B, row(303, 'LATE'), row(505, 'AT_RISK')]);
    await poll([row(101, 'ON_TIME'), row(202, 'ON_TIME'), row(303, 'LATE'), row(505, 'LATE')]);
    expect(on((el) => el === bar())).toHaveLength(1);
  });

  it('a chip re-sorts and offers nothing, so no offer fades (the rows it moves glide, §12.149)', async () => {
    await render();
    await press('3');
    expect(bar()).toBeNull();
    expect(
      recorder.played.filter((p) => p.options.duration === 270 && p.options.easing === 'linear'),
    ).toEqual([]);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await render();
    await poll([row(101, 'ON_TIME'), B, row(303, 'LATE')]);
    expect(bar()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('note: the note beside the chips', () => {
  const note = () => container!.querySelector('[data-note="drivers"]');

  it('Drivers only on: its note drops in, 14px in 270ms', async () => {
    await render([A, B, C, D]);
    await press('8');
    expect(note()?.textContent).toContain('without a driver hidden');
    expect(on((el) => el === note()).map(shape)).toEqual([DROP_14]);
  });

  it('a poll that changes how many it hides, and a truck selected, which swaps its form: nothing more', async () => {
    await render([A, B, C, D]);
    await press('8');
    await poll([A, B, row(303, 'ON_TIME', null), D]);
    await act(async () => rowEl(101)!.click());
    expect(on((el) => el === note())).toHaveLength(1);
  });

  it('on with the page: it is simply there', async () => {
    await render([A, B, C, D], ['drivers']);
    expect(note()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await render([A, B, C, D]);
    await press('8');
    expect(note()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('copied: the tick on a copy button', () => {
  const copyButton = () =>
    rowEl(101)!.querySelector<HTMLButtonElement>('button[aria-label="Copy address"]')!;
  const clipboard = (write: () => Promise<void>) =>
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(write) } });

  it('a copy that landed: the tick pops inside the button, 270ms from 50%, and the button never moves', async () => {
    clipboard(async () => {});
    await render();
    await act(async () => copyButton().click());
    expect(copyButton().textContent).toContain('Copied');
    const svg = copyButton().querySelector('svg');
    expect(on((el) => el === svg).map(shape)).toEqual([POP_HALF]);
    expect(on((el) => el === copyButton())).toEqual([]);
  });

  it('a copy the browser refused: nothing pops, because nothing was copied', async () => {
    clipboard(async () => {
      throw new Error('denied');
    });
    await render();
    await act(async () => copyButton().click());
    expect(copyButton().textContent).not.toContain('Copied');
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion it says Copied and nothing starts', async () => {
    unreduce = reduceMotion();
    clipboard(async () => {});
    await render();
    await act(async () => copyButton().click());
    expect(copyButton().textContent).toContain('Copied');
    expect(recorder.played).toEqual([]);
  });
});
