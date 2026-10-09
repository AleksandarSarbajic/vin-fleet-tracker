// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';

/**
 * React #418 on production. The server renders the board in UTC (Vercel) and
 * the dispatcher's browser hydrates it in its own zone, on its own clock. Any
 * text that reads either one while rendering differs between the two, and
 * React throws the server's HTML away. E2e never sees it: the test server and
 * the browser share one machine, one zone and one clock.
 *
 * So this renders the whole board to a string under TZ=UTC, then hydrates
 * that string under another zone, and fails on any recoverable error. Node
 * re-reads `TZ` when it is assigned, `Intl`'s default zone included.
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

const FETCHED = '2026-10-09T11:35:00.000Z';
const fetchedMs = Date.parse(FETCHED);

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};
const zoneBefore = process.env.TZ;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  restoreLayout = stubLayout({ width: 1600, height: 900 });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
  vi.useRealTimers();
  if (zoneBefore === undefined) delete process.env.TZ;
  else process.env.TZ = zoneBefore;
  root = null;
  container = null;
});

const board = () =>
  createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false, refetchInterval: false } },
      }),
    },
    createElement(Console, {
      initial: {
        fleet: [fleetRow()],
        fetchedAt: FETCHED,
        feedStale: false,
        feedNewestAt: FETCHED,
      },
      initialHealth: fleetHealth(),
      dispatchTz: 'America/Chicago',
      user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
      initialQuery: '',
      initialTruck: null,
      initialChips: [],
      drivers: [],
      role: 'admin' as const,
    }),
  );

/** Server in UTC a moment after the fetch; the browser in `zone`, at `browserNow`. */
const serveThenHydrate = async (zone: string, browserNow: number) => {
  process.env.TZ = 'UTC';
  vi.setSystemTime(fetchedMs + 500);
  const html = renderToString(board());

  process.env.TZ = zone;
  vi.setSystemTime(browserNow);
  container!.innerHTML = html;
  const errors: string[] = [];
  await act(async () => {
    root = hydrateRoot(container!, board(), {
      onRecoverableError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });
  });
  return errors;
};

describe('the board hydrates as the server rendered it (React #418)', () => {
  it('in a browser in another zone', async () => {
    expect(Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Belgrade' }).resolvedOptions().timeZone).toBe(
      'Europe/Belgrade',
    );
    expect(await serveThenHydrate('Europe/Belgrade', fetchedMs + 2_000)).toEqual([]);
  });

  it('in a browser whose clock is minutes behind the server’s', async () => {
    expect(await serveThenHydrate('America/Chicago', fetchedMs - 5 * 60_000)).toEqual([]);
  });

  it('and still shows the viewer’s own clock once it has loaded', async () => {
    await serveThenHydrate('Europe/Belgrade', fetchedMs + 2_000);
    const header = container!.querySelector('[data-console-header]')!;
    expect(header.textContent).toMatch(/GMT\+2 · YOU|CEST · YOU/);
  });
});
