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

const ROW_A = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
});
const ROW_B = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  truckNumber: 202,
  samsaraName: 'Truck #202',
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
