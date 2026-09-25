// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';

/**
 * §12.78, through the whole console: the list, the MAP, the header's hidden
 * count and the URL all move together when Drivers only is switched.
 */

/** Mapbox GL needs WebGL; the stand-in records what the map was given. */
let mapRows: FleetRow[] = [];
vi.mock('./map/FleetMap', () => ({
  FleetMap: (props: { rows: FleetRow[] }) => {
    mapRows = props.rows;
    return createElement('div', { 'data-testid': 'map' });
  },
}));
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { Console } = await import('./Console');

const DRIVEN = fleetRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', truckNumber: 101, samsaraName: 'Truck #101', driverName: 'Sam Driver' });
const PARKED = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', truckNumber: 202, samsaraName: 'Truck #202',
  driverName: null, status: 'NO_APPT', computed: 'NO_APPT', nextStop: null,
});
const NEEDS_DRIVER = fleetRow({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', truckNumber: 303, samsaraName: 'Truck #303',
  driverName: null, status: 'UNASSIGNED', computed: 'UNASSIGNED',
});

const INITIAL: FleetResponse = {
  fleet: [DRIVEN, PARKED, NEEDS_DRIVER],
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  replace.mockClear();
  mapRows = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
});

const render = async (initialChips: string[] = []) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(QueryClientProvider, { client },
        createElement(Console, {
          initial: INITIAL,
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

const listed = () =>
  Array.from(container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]'))
    .map((el) => ['101', '202', '303'].find((n) => (el.textContent ?? '').includes(n)))
    .sort();
const onMap = () => mapRows.map((r) => String(r.truckNumber)).sort();
const hiddenNote = () =>
  [...container!.querySelectorAll('button')].find((b) => /without a driver hidden/.test(b.textContent ?? ''));

describe('Drivers only, in the console', () => {
  it('is off by default: all three listed, all three on the map, no note', async () => {
    await render();
    expect(listed()).toEqual(['101', '202', '303']);
    expect(onMap()).toEqual(['101', '202', '303']);
    expect(hiddenNote()).toBeUndefined();
  });

  it('on 8: the parked driverless truck leaves the list AND the map; the Unassigned one stays', async () => {
    await render();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '8' }));
    });
    expect(listed()).toEqual(['101', '303']);
    expect(onMap()).toEqual(['101', '303']);
    expect(hiddenNote()?.textContent).toBe('1 without a driver hidden');
    expect(replace).toHaveBeenLastCalledWith('/?chips=drivers', { scroll: false });
  });

  it('starts on from the URL, and the note turns it off', async () => {
    await render(['drivers']);
    expect(listed()).toEqual(['101', '303']);
    await act(async () => hiddenNote()!.click());
    expect(listed()).toEqual(['101', '202', '303']);
    expect(onMap()).toEqual(['101', '202', '303']);
    expect(replace).toHaveBeenLastCalledWith('/', { scroll: false });
  });
});
