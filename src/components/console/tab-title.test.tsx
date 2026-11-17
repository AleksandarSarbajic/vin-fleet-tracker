// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';
import type { TruckList } from '@/lib/truck-lists';
import { APP_TITLE } from '@/lib/brand';
import { TabTitle } from './TabTitle';

/**
 * Phase 3bx, QoL 5 (§12.164). The tab's title as the console sets it: the Late chip's own count
 * (so a list in scope narrows it as it narrows the chip), the feed down claiming nothing while
 * the chip still counts, not updating when the console cannot reach its server, and the plain
 * title back when the board goes.
 */
vi.mock('./map/FleetMap', () => ({ FleetMap: () => createElement('div', { 'data-testid': 'map' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { Console } = await import('./Console');

let n = 0;
const truck = (status: 'LATE' | 'ON_TIME', active = true) => {
  n += 1;
  return fleetRow({ id: `0000${String(n).padStart(4, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, truckNumber: 500 + n, status, computed: status, active });
};
const LATE_A = truck('LATE');
const LATE_B = truck('LATE');
const LATE_C = truck('LATE');
const ON_TIME = truck('ON_TIME');
/** Inactive: the chip does not count it, so neither does the title. */
const LATE_INACTIVE = truck('LATE', false);
const FLEET = [LATE_A, LATE_B, LATE_C, ON_TIME, LATE_INACTIVE];
const LIST: TruckList = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
  name: 'Two',
  version: 1,
  truckIds: [LATE_A.id, ON_TIME.id],
  updatedAt: '2026-09-18T12:00:00.000Z',
  updatedByName: 'Sam Leasar',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  document.title = APP_TITLE;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
});

const render = async ({ feedStale = false, initialList = null as string | null } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: { fleet: FLEET, fetchedAt: new Date().toISOString(), feedStale, feedNewestAt: new Date().toISOString() } as FleetResponse,
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
const lateChip = () =>
  [...container!.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Late'))?.textContent ?? '';

describe('the tab title (QoL 5)', () => {
  it("says how many are late, the Late chip's own count", async () => {
    await render();
    expect(document.title).toBe('3 late · Fleet Tracker');
    expect(lateChip()).toContain('3');
  });

  it('a list in scope narrows it as it narrows the chip', async () => {
    await render({ initialList: LIST.id });
    expect(document.title).toBe('1 late · Fleet Tracker');
    expect(lateChip()).toContain('1');
  });

  it('on a stale feed it claims nothing and says the feed is down, while the chip still counts late', async () => {
    await render({ feedStale: true });
    expect(document.title).toBe('Feed down · Fleet Tracker');
    expect(lateChip()).toContain('3');
  });

  it('leaving the board puts the plain title back', async () => {
    await render();
    expect(document.title).not.toBe(APP_TITLE);
    act(() => root!.unmount());
    root = null;
    expect(document.title).toBe(APP_TITLE);
  });
});

describe('TabTitle (QoL 5)', () => {
  const mount = async (poll: { lastSuccessAt: number; visible: boolean; visibleSince: number | null }, late = 2) => {
    await act(async () => {
      root!.render(createElement(TabTitle, { late, feedStale: false, fetchedAt: null, poll }));
    });
    // The header's clock starts at the fetch it was given (none here), then ticks each second.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
  };

  it('not updating, from the header\'s own state, when nothing came back for a minute', async () => {
    await mount({ lastSuccessAt: Date.now() - 61_000, visible: true, visibleSince: null });
    expect(document.title).toBe('Not updating · Fleet Tracker');
  });

  it('hidden, three missed hidden polls, where the header says nothing', async () => {
    await mount({ lastSuccessAt: Date.now() - 181_000, visible: false, visibleSince: null });
    expect(document.title).toBe('Not updating · Fleet Tracker');
    await mount({ lastSuccessAt: Date.now() - 61_000, visible: false, visibleSince: null });
    expect(document.title).toBe('2 late · Fleet Tracker');
  });

  it('written over by something else (the layout writes its title after the board hydrates), it is put back within a tick', async () => {
    await mount({ lastSuccessAt: Date.now(), visible: true, visibleSince: null }, 2);
    expect(document.title).toBe('2 late · Fleet Tracker');
    document.title = APP_TITLE;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(document.title).toBe('2 late · Fleet Tracker');
  });

  it('below the editing width the title stays plain: nothing new is offered there', async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => {
      const list = real.call(window, query);
      Object.defineProperty(list, 'matches', { get: () => false });
      return list;
    }) as typeof window.matchMedia;
    try {
      await mount({ lastSuccessAt: Date.now(), visible: true, visibleSince: null });
      expect(document.title).toBe(APP_TITLE);
    } finally {
      window.matchMedia = real;
    }
  });
});
