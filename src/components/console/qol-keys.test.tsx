// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { KEYMAP } from '@/lib/keymap';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * Phase 3bw, QoL feature 11 (§12.163). C copies the selected row's address and T opens its
 * timeline: two rows in the keymap and Console's own handler, no new listener. They stand down
 * as P and X do, and "Copied" shows for the key on the row's own control.
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

const WITH_STOP = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
  nextStop: nextStop({ addressLine: '1 Test Dock', city: 'Joliet', state: 'IL', zip: '60433' }),
});
const NO_STOP = fleetRow({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  truckNumber: 202,
  samsaraName: 'Truck #202',
  nextStop: null,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
  vi.useRealTimers();
});

const render = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  const initial: FleetResponse = {
    fleet: [WITH_STOP, NO_STOP],
    fetchedAt: '2026-09-18T12:00:00.000Z',
    feedStale: false,
    feedNewestAt: '2026-09-18T12:00:00.000Z',
  };
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial,
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

const rowFor = (truck: string) =>
  [...container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find((el) =>
    (el.textContent ?? '').includes(truck),
  )!;
const select = async (truck: string) => {
  await act(async () => rowFor(truck).click());
};
const press = async (target: EventTarget, key: string, extra: KeyboardEventInit = {}) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};
const addressControl = (truck: string) => rowFor(truck).querySelector<HTMLButtonElement>('button[aria-label="Copy address"]');
const timeline = () => document.querySelector('[aria-label^="Timeline for truck"]');

describe('C copies the selected truck\'s address (QoL 11)', () => {
  it('copies the address and the row\'s own control says Copied, as for a click', async () => {
    await render();
    await select('101');
    expect(addressControl('101')!.textContent).toContain('Addr');
    await press(document.body, 'c');
    expect(writeText).toHaveBeenCalledWith('1 Test Dock, Joliet, IL, 60433');
    expect(addressControl('101')!.textContent).toContain('Copied');
  });

  it('on a row with no next stop, copies nothing and says why on the row', async () => {
    await render();
    await select('202');
    await press(document.body, 'C');
    expect(writeText).not.toHaveBeenCalled();
    expect(rowFor('202').querySelector('[data-key-refusal]')?.textContent).toBe('No next stop, so no address');
  });

  it('a clipboard the browser refuses is said, not silent', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await render();
    await select('101');
    await press(document.body, 'c');
    expect(rowFor('101').querySelector('[data-key-refusal]')?.textContent).toBe(
      'This browser would not copy, so nothing was copied',
    );
    expect(addressControl('101')!.textContent).not.toContain('Copied');
  });

  it('nothing selected: nothing copied', async () => {
    await render();
    await press(document.body, 'c');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('stands down while typing, as P and X do', async () => {
    await render();
    await select('101');
    const field = container!.querySelector<HTMLInputElement>('input[aria-label="Search the fleet"]')!;
    await press(field, 'c');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('stands down behind a window, as P and X do', async () => {
    await render();
    await select('101');
    const window = document.createElement('div');
    window.setAttribute('aria-modal', 'true');
    document.body.appendChild(window);
    try {
      await press(document.body, 'c');
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      window.remove();
    }
  });

  it('stands down with a modifier: ⌘C is the browser\'s copy', async () => {
    await render();
    await select('101');
    await press(document.body, 'c', { metaKey: true });
    await press(document.body, 'c', { ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('T opens the selected truck\'s timeline (QoL 11)', () => {
  it('opens it for the selected truck', async () => {
    await render();
    await select('101');
    expect(timeline()).toBeNull();
    await press(document.body, 't');
    expect(timeline()?.getAttribute('aria-label')).toBe('Timeline for truck 101');
  });

  it('stands down while typing and with nothing selected', async () => {
    await render();
    await press(document.body, 't');
    expect(timeline()).toBeNull();
    await select('101');
    await press(container!.querySelector<HTMLInputElement>('input[aria-label="Search the fleet"]')!, 't');
    expect(timeline()).toBeNull();
  });
});

describe('the shortcut sheet lists both (QoL 11)', () => {
  it('C and T are in the keymap the sheet prints, in the list group, owned by Console', () => {
    const c = KEYMAP.find((b) => b.keys.join('') === 'C');
    const t = KEYMAP.find((b) => b.keys.join('') === 'T');
    expect(c).toMatchObject({ label: "Copy the selected truck's address", group: 'list', owner: 'Console' });
    expect(t).toMatchObject({ label: "Open the selected truck's timeline", group: 'list', owner: 'Console' });
  });

  it('? opens the sheet, and it says both', async () => {
    await render();
    await press(document.body, '?');
    const sheet = document.querySelector('[aria-modal="true"]');
    expect(sheet?.textContent).toContain("Copy the selected truck's address");
    expect(sheet?.textContent).toContain("Open the selected truck's timeline");
  });
});
