// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §14 feature 7, wired.
 *
 * `empty-state.test.ts` proves the decision; this proves Console hands it the
 * right counts. The two are separable and both are needed: a perfect decision
 * fed `afterSearch` where it wanted `afterChips` produces a confident, wrong
 * message, and no unit test of a pure function can see that.
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

const ACTIVE = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
});
const INACTIVE = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  truckNumber: 202,
  samsaraName: 'Truck #202',
  active: false,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
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

const mount = async (fleet: FleetResponse['fleet'], query = '', chips: string[] = []) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: {
            fleet,
            fetchedAt: '2026-09-18T12:00:00.000Z',
            feedStale: false,
            feedNewestAt: '2026-09-18T12:00:00.000Z',
          },
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
          initialQuery: query,
          initialTruck: null,
          initialChips: chips,
          drivers: [],
          role: 'admin' as const,
        }),
      ),
    );
  });
  return container!;
};

const empty = () => container!.querySelector('[data-empty]');
const kind = () => empty()?.getAttribute('data-empty') ?? null;

describe('which reason the console reports', () => {
  it('says nothing while there are rows', async () => {
    await mount([ACTIVE]);
    expect(empty()).toBeNull();
  });

  it('reports an empty fleet', async () => {
    await mount([]);
    expect(kind()).toBe('fleet');
  });

  /**
   * §12.9's active-only default. The fleet is not empty and no filter is on,
   * so the only honest message names the default — and offers the chip that
   * would reveal the truck.
   */
  it('names the active-only default when every truck is inactive', async () => {
    await mount([INACTIVE]);
    expect(kind()).toBe('inactive');
    expect(container!.textContent).toContain('Show inactive');
  });

  it('reports the chips when they exclude everything', async () => {
    // 101 is ON_TIME; the Late chip excludes it.
    await mount([ACTIVE], '', ['late']);
    expect(kind()).toBe('chips');
  });

  it('reports the search when the chips let something through', async () => {
    await mount([ACTIVE], 'kowalczyk');
    expect(kind()).toBe('search');
    expect(container!.textContent).toContain('kowalczyk');
  });
});

describe('the way out', () => {
  it('clears the search from the message, and the field goes with it', async () => {
    await mount([ACTIVE], 'kowalczyk');
    const field = container!.querySelector<HTMLInputElement>(
      'input[aria-label="Search the fleet"]',
    );
    // Asserted before the click as well, so an empty field at the end cannot
    // mean "the selector matched nothing".
    expect(field?.value).toBe('kowalczyk');

    const clear = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Clear search',
    );
    expect(clear).toBeDefined();
    await act(async () => {
      clear!.click();
    });

    // The field is the source; clearing only the derived query would leave
    // the box showing a term it no longer filters by.
    expect(field?.value).toBe('');
  });

  it('clears the filters from the message', async () => {
    await mount([ACTIVE], '', ['late']);
    const clear = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Clear filters',
    );
    await act(async () => {
      clear!.click();
    });
    expect(empty()).toBeNull();
  });
});
