// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { DESKTOP_ONLY, EDIT_MEDIA } from '@/lib/editing';
import type { FleetRow } from '@/server/fleet-query';

/**
 * §12.94 — below 768px no route opens the Edit Stop modal or a bulk edit.
 * The width is the media query's answer; the map is a stand-in that records
 * whether it was handed an editor.
 */

let mapOnEdit: unknown = undefined;
vi.mock('./map/FleetMap', () => ({
  FleetMap: (props: { onEdit: unknown }) => {
    mapOnEdit = props.onEdit;
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

const ROWS: FleetRow[] = [101, 102].map((n) =>
  fleetRow({
    id: `00000000-0000-4000-8000-000000000${n}`,
    truckNumber: n,
    samsaraName: `Truck #${n}`,
  }),
);

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};
const realMatchMedia = window.matchMedia;

/** The width, as the editing rule asks for it. */
const screenIs = (wide: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: query === EDIT_MEDIA ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mapOnEdit = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
  window.matchMedia = realMatchMedia;
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
          initial: {
            fleet: ROWS,
            fetchedAt: '2026-09-18T12:00:00.000Z',
            feedStale: false,
            feedNewestAt: '2026-09-18T12:00:00.000Z',
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
      ),
    );
  });
};

const row = (n: number) =>
  [...container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find((el) =>
    (el.textContent ?? '').includes(String(n)),
  )!;
const editor = () => document.querySelector('[role="dialog"][aria-label^="Edit stop"]');
const press = (key: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
const check = (n: number) =>
  act(async () => {
    container!
      .querySelector<HTMLInputElement>(`input[aria-label="Select truck ${n}"]`)!
      .click();
  });

describe('below 768px, nothing opens an editor (§12.94)', () => {
  beforeEach(() => screenIs(false));

  it('Enter on the selected row selects, and opens nothing', async () => {
    await render();
    await act(async () => row(101).click());
    await press('Enter');
    expect(editor()).toBeNull();
  });

  it('a double-tap on a row opens nothing', async () => {
    await render();
    await act(async () => {
      row(102).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(editor()).toBeNull();
  });

  it('the map is handed no editor, so its popup shows the note instead', async () => {
    await render();
    expect(mapOnEdit).toBeNull();
  });

  it('the bulk bar offers no bulk edit, and says where editing is', async () => {
    await render();
    await check(101);
    await check(102);
    const bar = container!.textContent ?? '';
    expect(bar).toContain('2 trucks selected');
    expect(bar).not.toContain('Force status');
    expect(bar).not.toContain('Add note');
    expect(container!.querySelector('[data-desktop-only]')?.textContent).toBe(
      DESKTOP_ONLY,
    );
  });
});

describe('at 768px and wider, editing is unchanged', () => {
  beforeEach(() => screenIs(true));

  it('Enter opens the editor on the selected row', async () => {
    await render();
    await act(async () => row(101).click());
    await press('Enter');
    expect(editor()).not.toBeNull();
  });

  it('the map is handed the editor, and the bulk bar its edits', async () => {
    await render();
    expect(typeof mapOnEdit).toBe('function');
    await check(101);
    await check(102);
    expect(container!.textContent).toContain('Force status');
    expect(container!.querySelector('[data-desktop-only]')).toBeNull();
  });
});
