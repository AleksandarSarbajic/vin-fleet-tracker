// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * A poll never closes a window (phase 3bc follow-up 2). The browser spec runs this on
 * the real 20s poll; this holds it in `npm run check`, where a change to the lookup
 * would otherwise go unnoticed until the full e2e.
 */

/** Mapbox GL needs WebGL, which happy-dom does not have. */
let openTimeline: ((id: string) => void) | undefined;
vi.mock('./map/FleetMap', () => ({
  FleetMap: (props: { onTimeline?: (id: string) => void }) => {
    // The Timeline button is on the map's popup, and the map is not drawn here.
    openTimeline = props.onTimeline;
    return createElement('div', { 'data-testid': 'map' });
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { Console } = await import('./Console');

const LATE_A = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
  status: 'LATE',
  computed: 'LATE',
  nextStop: nextStop({ stopId: 'a0000000-0000-4000-8000-000000000001' }),
});
const LATE_B = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  truckNumber: 202,
  samsaraName: 'Truck #202',
  status: 'LATE',
  computed: 'LATE',
  nextStop: nextStop({ stopId: 'b0000000-0000-4000-8000-000000000002' }),
});
const ARRIVED_A = { ...LATE_A, status: 'ARRIVED' as const, computed: 'ARRIVED' as const };

const answer = (fleet: FleetResponse['fleet']): FleetResponse => ({
  fleet,
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
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

const render = async (initialChips: string[]) => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  primeLoadRead(client, LATE_A);
  client.setQueryData(['timeline', LATE_A.id], []);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: answer([LATE_A, LATE_B]),
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

const dataRows = () =>
  Array.from(container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]'));
const rowFor = (truck: string) =>
  dataRows().find((el) => (el.textContent ?? '').includes(truck));
const press = async (key: string) => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};
const windows = () =>
  [...document.querySelectorAll('[aria-modal="true"]')].map((w) => w.getAttribute('aria-label'));
const poll = async (fleet: FleetResponse['fleet']) => {
  await act(async () => {
    client.setQueryData(['fleet'], answer(fleet));
    // React Query tells its observers on a timer.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const selectA = async () => {
  await act(async () => {
    rowFor('101')!.click();
  });
};
const clickButton = async (name: string) => {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );
  await act(async () => {
    button!.click();
  });
};

const EDIT = 'Edit load for truck 101';

describe('the edit window', () => {
  it('stays open when the poll moves its truck out of the chip', async () => {
    await render(['late']);
    await selectA();
    await press('Enter');
    expect(windows()).toEqual([EDIT]);

    await poll([ARRIVED_A, LATE_B]);
    expect(rowFor('101')).toBeUndefined();
    expect(windows()).toEqual([EDIT]);
  });

  /** The hold is for a truck that is gone. This one is not, so its row stays live. */
  it('keeps showing this poll’s row after its truck has left the chip', async () => {
    await render(['late']);
    await selectA();
    await press('Enter');
    // The status chip's own words: the panel's override list prints every status.
    const chips = (word: string) =>
      [...document.querySelectorAll('[role="tabpanel"] span')].filter(
        (span) => span.textContent?.trim() === word,
      ).length;
    expect(chips('Late')).toBeGreaterThan(0);
    expect(chips('Arrived')).toBe(0);

    await poll([ARRIVED_A, LATE_B]);
    expect(rowFor('101')).toBeUndefined();
    expect(chips('Late')).toBe(0);
    expect(chips('Arrived')).toBeGreaterThan(0);
  });

  it('stays open with no chips when the poll makes its truck inactive', async () => {
    await render([]);
    await selectA();
    await press('Enter');
    await poll([{ ...LATE_A, active: false }, LATE_B]);
    expect(rowFor('101')).toBeUndefined();
    expect(windows()).toEqual([EDIT]);
  });

  it('stays open, on the last row it had, when the truck is missing from the answer', async () => {
    await render([]);
    await selectA();
    await press('Enter');
    await poll([LATE_B]);
    expect(windows()).toEqual([EDIT]);
  });

  it('does not come back by itself once closed, when the truck returns', async () => {
    await render(['late']);
    await selectA();
    await press('Enter');
    await poll([ARRIVED_A, LATE_B]);
    await clickButton('Cancel');
    expect(windows()).toEqual([]);

    await poll([LATE_A, LATE_B]);
    expect(rowFor('101')).toBeDefined();
    expect(windows()).toEqual([]);
  });
});

describe('the timeline', () => {
  it('stays open when the poll moves its truck out of the chip', async () => {
    await render(['late']);
    await selectA();
    await act(async () => {
      openTimeline!(LATE_A.id);
    });
    expect(windows()).toEqual(['Timeline for truck 101']);

    await poll([ARRIVED_A, LATE_B]);
    expect(rowFor('101')).toBeUndefined();
    expect(windows()).toEqual(['Timeline for truck 101']);
  });
});

/**
 * `rows` also meant "a truck the board shows". The window's lookup no longer does, so
 * these two say it themselves, or a selection nobody can see would act.
 */
describe('a selected truck the board is not showing', () => {
  it('Enter does not open a window on it', async () => {
    await render(['late']);
    await selectA();
    await poll([ARRIVED_A, LATE_B]);
    expect(rowFor('101')).toBeUndefined();
    await press('Enter');
    expect(windows()).toEqual([]);
  });

  it('X does not check it unseen', async () => {
    await render(['late']);
    await selectA();
    await poll([ARRIVED_A, LATE_B]);
    await press('x');
    await poll([LATE_A, LATE_B]);
    const box = rowFor('101')!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
  });
});

describe('P on a selected truck the board is not showing', () => {
  it('pins nothing', async () => {
    await render(['late']);
    await selectA();
    await poll([ARRIVED_A, LATE_B]);
    await press('p');
    await poll([LATE_A, LATE_B]);
    const pin = rowFor('101')!.querySelector('button[aria-label$="truck 101"]');
    expect(pin?.getAttribute('aria-pressed')).toBe('false');
  });

  it('pins a truck the board is showing, as ever', async () => {
    await render(['late']);
    await selectA();
    await press('p');
    const pinned = [...document.querySelectorAll('button[aria-label="Unpin truck 101"]')];
    expect(pinned.length).toBeGreaterThan(0);
  });
});
