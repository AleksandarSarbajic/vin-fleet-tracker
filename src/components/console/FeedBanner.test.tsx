// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.53 / design-spec §9.8 and §9.1.
 *
 * §5.9's fleet-wide withdrawal shipped in phase 5 and the two surfaces that
 * explain it did not, which produced the worst available pairing: a dimmed
 * board, every ETA reading `stale`, every chip neutral — under a green dot
 * and `Synced 12s ago`. Every assertion here is about the console SAYING
 * something, because the dimming on its own says only that the app is broken.
 *
 * The header's own failure was invisible from the outside for a specific
 * reason worth keeping: `feedNewestAt` was declared in `Props` and never
 * destructured. TypeScript is happy to accept a prop nobody reads, so nothing
 * in typecheck, lint or the suite could have noticed.
 */

/** Mapbox GL needs WebGL, which happy-dom does not have. */
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};

const ROW = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
});

/**
 * 12:00 fetched, positions last seen at 11:51 — nine minutes, which is the
 * number the spec's own sentence uses. Both derived from one instant so the
 * arithmetic is visible rather than pasted.
 */
const FETCHED_AT = '2026-09-18T17:00:00.000Z';
const NINE_MINUTES_BEFORE = new Date(Date.parse(FETCHED_AT) - 9 * 60_000).toISOString();

const response = (over: Partial<FleetResponse> = {}): FleetResponse => ({
  fleet: [ROW],
  fetchedAt: FETCHED_AT,
  feedStale: false,
  feedNewestAt: FETCHED_AT,
  ...over,
});

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

const render = async (initial: FleetResponse) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial,
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

const banner = () => container!.querySelector('[role="alert"]');

describe('the offline banner (§9.8)', () => {
  it('says nothing at all while the feed is healthy', async () => {
    await render(response());
    // A banner that is always there is a banner nobody reads.
    expect(banner()).toBeNull();
    expect(container!.textContent).not.toContain('do not quote an ETA');
  });

  it('names the instant, the age in words, and the instruction', async () => {
    const el = await render(
      response({ feedStale: true, feedNewestAt: NINE_MINUTES_BEFORE }),
    );

    expect(banner()).not.toBeNull();
    expect(el.textContent).toContain('Position feed unreachable since');
    // Nine minutes in WORDS. `9m` is the chip's format, not this sentence's.
    expect(el.textContent).toContain('9 minutes stale');
    // The clause the whole banner exists to deliver.
    expect(el.textContent).toContain('do not quote an ETA from this screen');
  });

  it('prints the instant in the DISPATCH zone, computed at render', async () => {
    const el = await render(
      response({ feedStale: true, feedNewestAt: NINE_MINUTES_BEFORE }),
    );

    // 17:00Z minus nine minutes is 11:51 in Chicago. Derived, not pasted:
    // the same Intl call the row uses, against the same instant.
    const expected = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(NINE_MINUTES_BEFORE));
    expect(el.textContent).toContain(expected);
  });

  it('offers a retry and an honest countdown to the next poll', async () => {
    const el = await render(
      response({ feedStale: true, feedNewestAt: NINE_MINUTES_BEFORE }),
    );

    const retry = Array.from(el.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Retry now'),
    );
    expect(retry).not.toBeUndefined();
    // Counted from the fetch instant plus the real poll interval, so it
    // describes something rather than decorating the banner.
    expect(el.textContent).toMatch(/auto-retry in \d+s/);
  });

  /**
   * §12.34's singleton, seen from the console. A fresh deployment has no
   * `newest_position_at` at all, and `isFeedStale` returns true for null — so
   * this banner renders with nothing to put after "since".
   */
  it('says the true thing when no position has ever arrived', async () => {
    const el = await render(response({ feedStale: true, feedNewestAt: null }));

    expect(el.textContent).toContain('No position has ever reached this database');
    expect(el.textContent).not.toContain('since —');
    expect(el.textContent).toContain('do not quote an ETA from this screen');
  });
});

describe('the header sync cluster (§9.1)', () => {
  /** The dot is found by its token class, which is the thing that was wrong. */
  const dot = () =>
    container!.querySelector('.bg-status-ontime-fg, .bg-status-late-fg');

  it('is green and counts from the fetch while the feed is healthy', async () => {
    const el = await render(response());
    expect(dot()?.className).toContain('bg-status-ontime-fg');
    expect(el.textContent).toContain('Synced');
  });

  it('goes red and names the last sync when the feed is down', async () => {
    const el = await render(
      response({ feedStale: true, feedNewestAt: NINE_MINUTES_BEFORE }),
    );

    // The bug: this stayed `bg-status-ontime-fg` under a fully dimmed board.
    expect(dot()?.className).toContain('bg-status-late-fg');
    expect(el.textContent).toContain('Last sync');
    // And it must stop claiming a healthy sync, which is the misleading half.
    expect(el.textContent).not.toContain('Synced ');
  });

  it('distinguishes the age of the POSITIONS from the age of the fetch', async () => {
    const el = await render(
      response({ feedStale: true, feedNewestAt: NINE_MINUTES_BEFORE }),
    );

    // `fetchedAt` is 0s old; the positions are nine minutes old. The header
    // must be reporting the second number, not the first.
    expect(el.textContent).toContain('9m ago');
    expect(el.textContent).not.toContain('0s ago');
  });

  it('says so rather than printing a blank when there is no last sync', async () => {
    const el = await render(response({ feedStale: true, feedNewestAt: null }));
    expect(el.textContent).toContain('No positions yet');
  });
});
