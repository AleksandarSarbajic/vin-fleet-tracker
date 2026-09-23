// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { VIEW_CAP, VIEW_STORAGE_KEY } from '@/lib/views';
import { TOUR_STORAGE_KEY, TOUR_VERSION } from '@/lib/tour';

/**
 * §14 feature 11, wired. `views.test.ts` proves the rules; this proves the
 * console applies them to the two things a view actually is — the chip set
 * and the search term — and to nothing else.
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

const LATE = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
  status: 'LATE',
});
const ON_TIME = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  truckNumber: 202,
  samsaraName: 'Truck #202',
  status: 'ON_TIME',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  // happy-dom has no localStorage unless node is given --localstorage-file.
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  /*
   * §14 feature 12 opens itself on a first visit, and this suite gives the
   * console working storage — so without this the whole file would run with a
   * modal over the board. It passes either way, which is exactly why it is
   * worth pinning: a suite that is accidentally testing through an overlay
   * will mask the first real thing that overlay breaks.
   */
  store.set(TOUR_STORAGE_KEY, String(TOUR_VERSION));
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

const mount = async (chips: string[] = [], query = '') => {
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
            fleet: [LATE, ON_TIME],
            fetchedAt: '2026-09-18T12:00:00.000Z',
            feedStale: false,
            feedNewestAt: '2026-09-18T12:00:00.000Z',
          },
          initialHealth: fleetHealth(),
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

const button = (text: string) =>
  [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

/** The chips print their count inside the button — "All2", not "All". */
const chip = (name: string) =>
  [...container!.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().startsWith(name),
  );

const click = async (el: Element | undefined) => {
  expect(el).toBeDefined();
  await act(async () => {
    (el as HTMLElement).click();
  });
};

const viewsTrigger = () =>
  container!.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"][aria-expanded]',
  );

/** A menu row carries its name AND its description, so match on the start. */
const menuItem = (name: string) =>
  [...container!.querySelectorAll('[role="menuitem"]')].find((el) =>
    el.textContent?.trim().startsWith(name),
  );

/**
 * Idempotent. Saving leaves the menu open, so a helper that always clicked
 * the trigger would close it and every later assertion would be about a
 * closed menu — which is exactly the shape of a test that "fails for the
 * wrong reason" and gets the code changed to match.
 */
const openMenu = async () => {
  if (viewsTrigger()?.getAttribute('aria-expanded') === 'true') return;
  await click(viewsTrigger() ?? undefined);
};

const nameField = () =>
  container!.querySelector<HTMLInputElement>('input[aria-label="Name this view"]');

const type = async (value: string) => {
  const field = nameField()!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const saveAs = async (name: string) => {
  await click(button('Save current view…'));
  await type(name);
  await click(button('Save'));
};

describe('saving', () => {
  it('starts with nothing and says so', async () => {
    await mount();
    await openMenu();
    expect(container!.textContent).toContain('No saved views yet');
  });

  it('saves the chip set that is on screen', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');

    const stored = JSON.parse(store.get(VIEW_STORAGE_KEY) ?? '[]') as {
      name: string;
      chips: string[];
      query: string;
    }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('Late today');
    expect(stored[0]?.chips).toEqual(['late']);
  });

  it('saves the search term too, because a view is both', async () => {
    await mount([], 'joliet');
    await openMenu();
    await saveAs('Joliet runs');
    const stored = JSON.parse(store.get(VIEW_STORAGE_KEY) ?? '[]') as { query: string }[];
    expect(stored[0]?.query).toBe('joliet');
  });

  /**
   * A cursor, not a view. Saving it would mean applying a view moves the map,
   * and "show me the late ones" would drag the board to wherever a truck was
   * three days ago.
   */
  it('does not save the selected truck', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');
    expect(store.get(VIEW_STORAGE_KEY) ?? '').not.toContain(LATE.id);
  });

  /**
   * The name check and the "already saved" check are different rules, and
   * this reaches the first without the second. Saving `late` and then
   * clearing the chips makes the board a DIFFERENT view, so the save control
   * comes back — and the name is still taken.
   */
  it('refuses a name already in use rather than overwriting it', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');

    await click(chip('All'));
    await openMenu();
    await click(button('Save current view…'));
    await type('LATE TODAY');
    await click(button('Save'));

    expect(container!.textContent).toContain('is already saved');
    const stored = JSON.parse(store.get(VIEW_STORAGE_KEY) ?? '[]') as unknown[];
    expect(stored).toHaveLength(1);
  });
});

describe('applying', () => {
  it('puts the chips back', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');

    // Clear the filters. The trigger stops naming the view, which is the
    // cheapest proof the board really changed before the view is re-applied.
    await click(chip('All'));
    expect(viewsTrigger()?.textContent).toContain('Views');

    await openMenu();
    await click(menuItem('Late today'));
    expect(viewsTrigger()?.textContent).toContain('Late today');
  });

  it('puts the search term back into the field, not just into the filter', async () => {
    await mount([], 'joliet');
    await openMenu();
    await saveAs('Joliet runs');

    const field = container!.querySelector<HTMLInputElement>(
      'input[aria-label="Search the fleet"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field!, '');
      field!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field?.value).toBe('');

    await openMenu();
    await click(menuItem('Joliet runs'));
    // The field is the source; setting only the derived query would leave the
    // box empty while the list stayed filtered.
    expect(field?.value).toBe('joliet');
  });

  it('closes the menu once a view is applied', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');
    await click(chip('All'));
    await openMenu();
    await click(menuItem('Late today'));
    expect(
      container!.querySelector('[role="menu"][aria-label="Saved views"]'),
    ).toBeNull();
  });
});

describe('deleting', () => {
  it('removes the view and frees its name', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');

    await openMenu();
    const remove = [...container!.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Delete the view Late today',
    );
    await click(remove);
    expect(container!.textContent).toContain('No saved views yet');
    expect(JSON.parse(store.get(VIEW_STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});

describe('the trigger', () => {
  it('names the view the board is showing', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');
    expect(viewsTrigger()?.textContent).toContain('Late today');
  });

  it('says Views when the board is not showing a saved one', async () => {
    await mount(['late']);
    expect(viewsTrigger()?.textContent).toContain('Views');
  });

  it('offers nothing to save when the board already is a saved view', async () => {
    await mount(['late']);
    await openMenu();
    await saveAs('Late today');
    await openMenu();
    expect(container!.textContent).toContain('This view is already saved');
  });
});

describe('the cap', () => {
  it('refuses the ninth rather than dropping the first', async () => {
    const existing = Array.from({ length: VIEW_CAP }, (_, i) => ({
      id: `v${i}`,
      name: `View ${i}`,
      query: `q${i}`,
      chips: [],
    }));
    store.set(VIEW_STORAGE_KEY, JSON.stringify(existing));
    await mount(['late']);
    await openMenu();
    await click(button('Save current view…'));
    await type('One more');
    await click(button('Save'));
    expect(container!.textContent).toContain('is the limit');
    const stored = JSON.parse(store.get(VIEW_STORAGE_KEY) ?? '[]') as unknown[];
    expect(stored).toHaveLength(VIEW_CAP);
  });
});
