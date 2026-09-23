// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.46. Enter had two owners that agreed by luck.
 *
 * The row's own `onKeyDown` selected, and the event then bubbled to Console's
 * window listener, which opened the modal on `selectedId` — the value in its
 * effect closure, captured BEFORE the row's `setSelectedId` could land.
 *
 * So Tab from a selected row A to row B and press Enter, and the modal opened
 * on A. Nothing in the suite could see it, because nothing mounted the console.
 */

/** Mapbox GL needs WebGL, which happy-dom does not have. */
vi.mock('./map/FleetMap', () => ({
  FleetMap: () => createElement('div', { 'data-testid': 'map' }),
}));
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { Console } = await import('./Console');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Both carry a routed distance, so the §12.47 miles line has something to say. */
const ROW_A = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
  milesRemaining: 412,
  distanceBasis: 'routed',
});
const ROW_B = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  truckNumber: 202,
  samsaraName: 'Truck #202',
  milesRemaining: 88,
  distanceBasis: 'lane-estimate',
  laneRatio: 1.24,
});

const INITIAL: FleetResponse = {
  fleet: [ROW_A, ROW_B],
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
};

let restoreLayout: () => void = () => {};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  replace.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
  root = null;
  container = null;
});

const render = async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: INITIAL,
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
  return container!;
};

/**
 * Rows are found by the truck number they render, not by any attribute the
 * fix adds. The test has to be able to run against the CURRENT code and fail
 * on the behaviour, rather than on a missing hook it put there itself.
 *
 * The sticky header also carries role="row", hence tabindex.
 */
const dataRows = () =>
  Array.from(container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]'));

const rowFor = (truck: string) =>
  dataRows().find((el) => (el.textContent ?? '').includes(truck));

const press = async (target: EventTarget, key: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

/** The modal is identified by its own heading, not by a test id. */
const openModalTruck = (): string | null => {
  const dialog = container!.querySelector('[role="dialog"]');
  if (!dialog) return null;
  const text = dialog.textContent ?? '';
  for (const n of ['101', '202']) if (text.includes(n)) return n;
  return 'unknown';
};

describe('Enter has one owner (§12.46)', () => {
  it('renders both rows, so the test below is measuring something', async () => {
    await render();
    expect(dataRows()).toHaveLength(2);
    expect(rowFor('101')).toBeDefined();
    expect(rowFor('202')).toBeDefined();
  });

  /**
   * The defect, exactly as reported. Select A with the mouse, Tab to B —
   * which moves DOM FOCUS without moving the selection — and press Enter.
   */
  it('opens the modal on the row that has focus, not the one selected earlier', async () => {
    await render();

    await act(async () => {
      rowFor('101')!.click();
    });
    expect(container!.querySelector('[role="dialog"]')).toBeNull();

    const b = rowFor('202')!;
    act(() => b.focus());
    await press(b, 'Enter');

    // Was truck 101: the window listener read the selectedId from before the
    // row's own handler had changed it.
    expect(openModalTruck()).toBe('202');
  });

  it('still opens on the selection when focus is not on a row', async () => {
    await render();
    await act(async () => {
      rowFor('101')!.click();
    });
    // Arrow keys move the selection without moving DOM focus, so Enter from
    // the document has to keep working off selectedId.
    await press(document.body, 'Enter');
    expect(openModalTruck()).toBe('101');
  });

  it('does nothing when there is neither a focused row nor a selection', async () => {
    await render();
    await press(document.body, 'Enter');
    expect(container!.querySelector('[role="dialog"]')).toBeNull();
  });

  it('leaves the focused row selected, so the map is not showing someone else', async () => {
    await render();
    await act(async () => {
      rowFor('101')!.click();
    });
    const b = rowFor('202')!;
    act(() => b.focus());
    await press(b, 'Enter');

    expect(rowFor('202')?.getAttribute('aria-selected')).toBe('true');
    expect(rowFor('101')?.getAttribute('aria-selected')).toBe('false');
  });
});

/* -------------------------------------------------------------------------
 * §12.47 — the miles line, and §12.48 — double-click to edit
 * ---------------------------------------------------------------------- */

/**
 * Grid children, in order: checkbox, rail, truck, driver, position, next
 * stop, appt, ETA, status.
 *
 * §14 feature 2 added the checkbox as a leading column, which moved every
 * index here by one. Named rather than counted from now on — a positional
 * index into a grid is a comment that cannot be checked, and the next column
 * to be added should break something louder than an off-by-one assertion
 * about miles.
 */
const CELL = {
  checkbox: 0,
  rail: 1,
  truck: 2,
  driver: 3,
  position: 4,
  nextStop: 5,
  appt: 6,
  eta: 7,
  status: 8,
} as const;

const etaCell = (truck: string) => {
  const row = rowFor(truck)!;
  return row.children[CELL.eta] as HTMLElement;
};

describe('miles hang under the ETA (§12.47)', () => {
  it('renders the time and the miles as two lines in one cell', async () => {
    await render();
    const cell = etaCell('101');
    expect(cell.textContent).toContain('412 mi');
    // Two children: the time, and the miles out of flow beneath it.
    expect(cell.children).toHaveLength(2);
  });

  /**
   * The alignment property this design rests on cannot be asserted here —
   * happy-dom computes no layout. It was measured in Chromium instead: the
   * time stays at 22px from the row top, identical to the single-line cell,
   * while a normally-stacked block put it at 13.4px and 8.6px out of line
   * with the Appt column. What CAN be asserted is the mechanism that keeps
   * it there.
   */
  it('takes the miles out of flow, which is what keeps the time aligned', async () => {
    await render();
    const cell = etaCell('101');
    const milesEl = cell.children[1] as HTMLElement;
    expect(milesEl.className).toContain('absolute');
    expect(milesEl.className).toContain('top-full');
    // And pulled back up off the row's boundary — measured at 6.9px of
    // clearance rather than 1.9px.
    expect(milesEl.className).toContain('-mt-1');
  });

  it('marks any non-routed distance with a tilde (§12.47)', async () => {
    await act(async () => {
      root!.unmount();
    });
    root = createRoot(container!);
    // Rebuilt rather than mutated: a shared fixture that one test edits is
    // how the next test starts passing for the wrong reason.
    const straight = fleetRow({
      id: ROW_A.id,
      truckNumber: 101,
      samsaraName: 'Truck #101',
      distanceBasis: 'straight-line',
      milesRemaining: 412,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Console, {
            initial: { ...INITIAL, fleet: [straight] },
            dispatchTz: 'America/Chicago',
            user: { fullName: 'S L', email: null, role: 'admin' as const },
            initialQuery: '',
            initialTruck: null,
            initialChips: [],
            drivers: [],
            role: 'admin' as const,
          }),
        ),
      );
    });

    const milesEl = etaCell('101').children[1] as HTMLElement;
    expect(milesEl.textContent).toBe('~412 mi');
    // Always muted, whatever the basis: one token below the time, because
    // the time is the decision and these are supporting detail.
    expect(milesEl.className).toContain('text-text-muted');
    expect(milesEl.className).not.toContain('text-text-secondary');
  });
});

describe('double-click opens the edit modal (§12.48)', () => {
  const dblclick = async (el: HTMLElement) => {
    await act(async () => {
      el.click();
      el.click();
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
  };

  it('opens on the row that was double-clicked', async () => {
    await render();
    await dblclick(rowFor('202')!);
    expect(openModalTruck()).toBe('202');
  });

  it('selects that row too, so the map is not showing someone else', async () => {
    await render();
    await dblclick(rowFor('202')!);
    expect(rowFor('202')?.getAttribute('aria-selected')).toBe('true');
  });

  /**
   * The status chip is the one cell likely to grow its own click target.
   *
   * Both halves in one test on purpose: an exclusion asserted on its own
   * passes just as happily when the whole feature is dead, which is exactly
   * the test that goes green against a wrong fix (§12.38).
   */
  it('does not open from the status chip, but does from the cell beside it', async () => {
    await render();
    const row = rowFor('202')!;

    await dblclick(row.children[CELL.status] as HTMLElement);
    expect(container!.querySelector('[role="dialog"]')).toBeNull();

    await dblclick(row.children[CELL.eta] as HTMLElement);
    expect(openModalTruck()).toBe('202');
  });

  it('clears the word the double-click selected', async () => {
    await render();
    const row = rowFor('202')!;
    // A real double-click leaves a selection behind; nothing here is
    // select-none, deliberately, so click-drag copying still works.
    const range = document.createRange();
    range.selectNodeContents(row);
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.rangeCount).toBeGreaterThan(0);

    await dblclick(row);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------
 * §12.49 — the ETA carries the status colour, and four cases refuse it
 * ---------------------------------------------------------------------- */

describe('the ETA cell carries status ink (§12.49)', () => {
  const mountOne = async (over: Parameters<typeof fleetRow>[0], feedStale = false) => {
    await act(async () => {
      root!.unmount();
    });
    root = createRoot(container!);
    const one = fleetRow({
      id: ROW_A.id,
      truckNumber: 101,
      samsaraName: 'Truck #101',
      milesRemaining: 412,
      ...over,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Console, {
            initial: { ...INITIAL, fleet: [one], feedStale },
            dispatchTz: 'America/Chicago',
            user: { fullName: 'S L', email: null, role: 'admin' as const },
            initialQuery: '',
            initialTruck: null,
            initialChips: [],
            drivers: [],
            role: 'admin' as const,
          }),
        ),
      );
    });
    return (etaCell('101').children[0] as HTMLElement).className;
  };

  it('colours a LATE ETA with the late ink', async () => {
    const cls = await mountOne({
      status: 'LATE',
      etaAbsence: 'has-eta',
      etaUtc: '2026-09-18T22:05:00.000Z',
    });
    expect(cls).toContain('text-status-late-fg');
  });

  it('colours AT_RISK and ON_TIME with their own', async () => {
    expect(
      await mountOne({ status: 'AT_RISK', etaAbsence: 'has-eta', etaUtc: '2026-09-18T22:05:00.000Z' }),
    ).toContain('text-status-risk-fg');
    expect(
      await mountOne({ status: 'ON_TIME', etaAbsence: 'has-eta', etaUtc: '2026-09-18T22:05:00.000Z' }),
    ).toContain('text-status-ontime-fg');
  });

  /** §9.5: a forced chip keeps the status colour, so the ETA must agree. */
  it('follows the SHOWN status, not the computed one, under an override', async () => {
    const cls = await mountOne({
      status: 'LATE',
      computed: 'ON_TIME',
      etaAbsence: 'has-eta',
      etaUtc: '2026-09-18T22:05:00.000Z',
    });
    expect(cls).toContain('text-status-late-fg');
    expect(cls).not.toContain('text-status-ontime-fg');
  });

  it('refuses ink for "no ETA" — not a time, not a judgement', async () => {
    const cls = await mountOne({ status: 'LATE', etaAbsence: 'address-not-located', etaUtc: null });
    expect(cls).toContain('text-text-secondary');
    expect(cls).not.toContain('text-status-late-fg');
  });

  it('refuses ink for a dash', async () => {
    const cls = await mountOne({ status: 'NO_APPT', etaAbsence: 'no-appointment', etaUtc: null });
    expect(cls).toContain('text-text-secondary');
  });

  /**
   * §5.9, hard requirement. A green ETA built on nine-minute-old GPS is worse
   * than no ETA — so the whole board withdraws schedule colour, and this cell
   * is the one that just gained some.
   */
  it('withdraws the ink entirely when the feed is stale', async () => {
    const cls = await mountOne(
      { status: 'LATE', etaAbsence: 'has-eta', etaUtc: '2026-09-18T22:05:00.000Z' },
      true,
    );
    expect(cls).toContain('text-text-muted');
    expect(cls).not.toContain('text-status-late-fg');
    // And the cell says so rather than showing a time nobody should trust.
    expect((etaCell('101').children[0] as HTMLElement).textContent).toBe('stale');
  });

  /**
   * §12.57. Two claims, two words, one slot.
   *
   * `arrived` is a measurement — a fix inside the radius, stopped, held
   * across two polls. `marked` is somebody's word for it, typed because the
   * stop's coordinate cannot register an arrival at all. Printing both as
   * `arrived` would let a dispatcher's guess wear a measurement's clothes on
   * the one screen anybody reads at 4am.
   */
  it('says `arrived` for a detected arrival and `marked` for a typed one', async () => {
    const text = async (source: 'detected' | 'dispatcher') => {
      await mountOne({
        status: 'ARRIVED',
        computed: 'ARRIVED',
        etaAbsence: 'arrived',
        nextStop: nextStop({
          arrivedAt: '2026-09-18T11:44:00.000Z',
          arrivedSource: source,
        }),
      });
      return (etaCell('101').children[0] as HTMLElement).textContent;
    };

    expect(await text('detected')).toBe('arrived');
    expect(await text('dispatcher')).toBe('marked');
  });

  it('keeps the unassigned strike muted, never coloured (§5.8)', async () => {
    const cls = await mountOne({
      status: 'UNASSIGNED',
      etaAbsence: 'suppressed-unassigned',
      lastComputedEtaUtc: '2026-09-18T22:05:00.000Z',
    });
    expect(cls).toContain('text-text-muted');
    expect(cls).toContain('line-through');
    expect(cls).not.toContain('text-status');
  });
});

/* -------------------------------------------------------------------------
 * §12.50 — the toast actually reaches the screen
 * ---------------------------------------------------------------------- */

describe('a truck going LATE raises a toast (§12.50)', () => {
  /** A second poll, as react-query delivers one. */
  const poll = async (client: QueryClient, fleet: ReturnType<typeof fleetRow>[]) => {
    await act(async () => {
      client.setQueryData(['fleet'], {
        ...INITIAL,
        fleet,
        fetchedAt: new Date().toISOString(),
      });
      /**
       * react-query flushes its notify batch on a MACROTASK, so awaiting a
       * microtask here leaves the observer un-notified and the component
       * rendered exactly once — which looks identical to a component that
       * ignores the cache. Cost an hour; worth the comment.
       */
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const mountWith = async (fleet: ReturnType<typeof fleetRow>[]) => {
    await act(async () => {
      root!.unmount();
    });
    root = createRoot(container!);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root!.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Console, {
            initial: { ...INITIAL, fleet },
            dispatchTz: 'America/Chicago',
            user: { fullName: 'S L', email: null, role: 'admin' as const },
            initialQuery: '',
            initialTruck: null,
            initialChips: [],
            drivers: [],
            role: 'admin' as const,
          }),
        ),
      );
    });
    return client;
  };

  const onTime = fleetRow({ id: ROW_A.id, truckNumber: 101, samsaraName: 'Truck #101', status: 'ON_TIME' });
  const late = fleetRow({ id: ROW_A.id, truckNumber: 101, samsaraName: 'Truck #101', status: 'LATE' });
  const toastEl = () => container!.querySelector('[data-toast]');

  beforeEach(() => {
    // The ledger is persisted, so one test's toast would suppress the next.
    try {
      window.localStorage.clear();
    } catch {
      /* happy-dom without storage: the ledger falls back to empty anyway. */
    }
  });

  it('shows nothing on the first poll, however late the board is', async () => {
    await mountWith([late]);
    expect(toastEl()).toBeNull();
  });

  it('raises one when the truck crosses on a LATER poll', async () => {
    const client = await mountWith([onTime]);
    expect(toastEl()).toBeNull();

    await poll(client, [late]);
    expect(toastEl()).not.toBeNull();
    expect(toastEl()?.textContent).toContain('101');
    expect(toastEl()?.textContent).toContain('late');
  });

  it('never steals focus — polite, not an alert', async () => {
    const client = await mountWith([onTime]);
    await poll(client, [late]);

    const live = container!.querySelector('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    // "A toast is an echo, not the notification."
    expect(document.activeElement).toBe(document.body);
  });

  it('does not raise a second one for the same truck and stop', async () => {
    const client = await mountWith([onTime]);
    await poll(client, [late]);
    await poll(client, [onTime]);
    await poll(client, [late]);

    expect(container!.querySelectorAll('[data-toast]')).toHaveLength(1);
  });

  it('Open selects the truck and opens its modal', async () => {
    const client = await mountWith([onTime]);
    await poll(client, [late]);

    const open = Array.from(container!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Open',
    );
    expect(open).toBeDefined();
    await act(async () => {
      open!.click();
    });

    expect(openModalTruck()).toBe('101');
    // And it takes itself away once acted on.
    expect(toastEl()).toBeNull();
  });
});
