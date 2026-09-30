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
import type { Status } from '@/lib/status';
import type { TruckList } from '@/lib/truck-lists';

/**
 * §12.8, through the whole console: every chip's number is the number of
 * rows that chip shows, with a shared list active and without one — and the
 * header says what the list leaves out.
 */

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

let n = 100;
const truck = (
  status: Status,
  over: { driver?: boolean; active?: boolean } = {},
): FleetRow => {
  n += 1;
  return fleetRow({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    status,
    computed: status,
    driverName: over.driver === false ? null : 'Sam Driver',
    active: over.active ?? true,
  });
};

const IN_LIST = [
  truck('LATE'),
  truck('AT_RISK'),
  truck('ON_TIME'),
  truck('ARRIVED'),
  truck('TOMORROW'),
  truck('STALE_GPS'),
  truck('UNASSIGNED', { driver: false }),
  truck('NO_APPT', { driver: false }),
  truck('LATE', { active: false }),
];
const OUTSIDE = [
  truck('LATE'),
  truck('LATE'),
  truck('UNASSIGNED', { driver: false }),
  truck('ON_TIME'),
  truck('NO_APPT', { active: false }),
];

const LIST: TruckList = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  name: "Bob's trucks",
  version: 1,
  truckIds: IN_LIST.map((r) => r.id),
  updatedAt: '2026-09-18T12:00:00.000Z',
  updatedByName: 'Sam Leasar',
};

const INITIAL: FleetResponse = {
  fleet: [...IN_LIST, ...OUTSIDE],
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 900 });
  replace.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
});

const render = async (initialList: string | null) => {
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
          initialHealth: fleetHealth(),
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
          initialQuery: '',
          initialTruck: null,
          initialChips: [],
          drivers: [],
          role: 'admin' as const,
          initialLists: [LIST],
          initialList,
        }),
      ),
    );
  });
};

const CHIPS = [
  'All',
  'Late',
  'At risk',
  'On time',
  'Arrived',
  'Upcoming',
  'Data issues',
  'Inactive',
  'Drivers only',
] as const;

const chipButtons = () => [
  ...container!.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Filter by status"] button',
  ),
];

/** The chip row as a person reads it: name → number, in drawn order. */
const chipRow = () =>
  Object.fromEntries(
    chipButtons().map((b, i) => [CHIPS[i], Number(b.lastElementChild?.textContent)]),
  ) as Record<(typeof CHIPS)[number], number>;

const shownRows = () => container!.querySelectorAll('[role="row"][tabindex]').length;
/** The footer's "of N" — so a virtualised-away row cannot pass as a missing one. */
const footerTotal = () => {
  const showing = [...container!.querySelectorAll('span')].find((s) =>
    (s.textContent ?? '').startsWith('Showing'),
  );
  return Number(showing?.lastElementChild?.textContent);
};
const outsideNote = () =>
  container!.querySelector<HTMLButtonElement>('[data-outside-list]');

/** Click All, then the one chip; report what it promised and what it showed. */
async function agreement(): Promise<{ chip: string; count: number; rows: number }[]> {
  const counts = chipRow();
  const seen = [];
  for (const [i, chip] of CHIPS.entries()) {
    await act(async () => chipButtons()[0]!.click());
    if (i > 0) await act(async () => chipButtons()[i]!.click());
    expect(footerTotal()).toBe(shownRows());
    seen.push({ chip, count: counts[chip], rows: shownRows() });
  }
  return seen;
}

describe('chip counts and rows agree, chip by chip', () => {
  it('with "Bob\'s trucks" active, every chip counts the list, and shows that many rows', async () => {
    await render(LIST.id);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(chipRow()).toEqual({
      All: 8,
      Late: 1,
      'At risk': 1,
      'On time': 1,
      Arrived: 1,
      Upcoming: 1,
      'Data issues': 3,
      Inactive: 1,
      'Drivers only': 7,
    });
    for (const { chip, count, rows } of await agreement()) {
      expect({ chip, rows }).toEqual({ chip, rows: count });
    }
  });

  it('with no list, every chip counts the fleet, and shows that many rows', async () => {
    await render(null);
    expect(chipRow()).toEqual({
      All: 12,
      Late: 3,
      'At risk': 1,
      'On time': 2,
      Arrived: 1,
      Upcoming: 1,
      'Data issues': 4,
      Inactive: 2,
      'Drivers only': 11,
    });
    for (const { chip, count, rows } of await agreement()) {
      expect({ chip, rows }).toEqual({ chip, rows: count });
    }
    expect(outsideNote()).toBeNull();
  });
});

describe('what the list leaves out is said, never hidden', () => {
  it('names the late and unassigned trucks outside, and clicking it shows the full fleet', async () => {
    await render(LIST.id);
    // The full wording is the accessible name; below 1440 it shows a short form (§12.91).
    expect(outsideNote()?.getAttribute('aria-label')).toBe(
      'Outside this list: 2 late, 1 unassigned',
    );
    await act(async () => outsideNote()!.click());
    expect(container!.querySelector('[data-list-title]')).toBeNull();
    expect(chipRow().All).toBe(12);
    expect(shownRows()).toBe(12);
    expect(replace).toHaveBeenLastCalledWith('/', { scroll: false });
  });
});
