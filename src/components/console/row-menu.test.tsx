// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { KEYMAP } from '@/lib/keymap';
import type { Role } from '@/lib/roles';
import type { FleetResponse } from '@/hooks/useFleet';
import { rowMenuItems } from './row-menu';

/**
 * Phase 3bx, QoL 8 (§12.164). Right-click on a row: the demo's menu without Mark arrived, each item
 * through its own control's or key's code; the browser's own menu on selected text; Esc closes it
 * with the focus back on the row, and the press that closes it reaches nothing else; the board's
 * keys stand down while it is open; the keyboard's menu key and Shift+F10; a poll, a scroll and a
 * window opening; a viewer.
 *
 * The edit window and the timeline are stand-ins, recording what opened them.
 */
vi.mock('./map/FleetMap', () => ({ FleetMap: () => createElement('div', { 'data-testid': 'map' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));
const opened = vi.hoisted(() => ({ windows: [] as string[], timelines: [] as string[] }));
vi.mock('@/components/edit/EditStopModal', () => ({
  EditStopModal: (props: { row: { id: string }; onClose: () => void }) => {
    opened.windows.push(props.row.id);
    return createElement('div', { role: 'dialog', 'aria-modal': 'true', 'data-stub-window': '' }, 'window');
  },
}));
vi.mock('./TruckTimeline', () => ({
  TruckTimeline: (props: { truckId: string }) => {
    opened.timelines.push(props.truckId);
    return createElement('div', { role: 'dialog', 'aria-modal': 'true', 'data-stub-timeline': '' }, 'timeline');
  },
}));

const { Console } = await import('./Console');

const A = fleetRow({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  truckNumber: 101,
  samsaraName: 'Truck #101',
  driverName: 'Ana Petrovic',
  nextStop: nextStop({ addressLine: '1 Test Dock', city: 'Joliet', state: 'IL', zip: '60433', loadNumber: 'E2E-101' }),
});
const B = fleetRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', truckNumber: 202, samsaraName: 'Truck #202', nextStop: null });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  opened.windows.length = 0;
  opened.timelines.length = 0;
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
  window.getSelection()?.removeAllRanges();
});

const answer = (fleet: FleetResponse['fleet']): FleetResponse => ({
  fleet,
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});
const render = async (role: Role = 'dispatcher') => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: answer([A, B]),
          initialHealth: fleetHealth(),
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Sam Leasar', email: 's@x.test', role },
          initialQuery: '',
          initialTruck: null,
          initialChips: [],
          drivers: [],
          role,
        }),
      ),
    );
  });
};
const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
const poll = async (fleet: FleetResponse['fleet']) => {
  await act(async () => {
    client.setQueryData(['fleet'], answer(fleet));
  });
  await settle();
};

const rowFor = (truck: string) =>
  [...container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find((el) => (el.textContent ?? '').includes(truck))!;
const menu = () => document.querySelector<HTMLElement>('[data-row-menu]');
const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-menu-item="${id}"]`)!;
const labels = () => [...document.querySelectorAll('[data-menu-item]')].map((el) => el.firstElementChild?.textContent);
const rightClick = async (target: Element) => {
  const down = new MouseEvent('pointerdown', { bubbles: true, button: 2 });
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 });
  await act(async () => {
    target.dispatchEvent(down);
    target.dispatchEvent(event);
  });
  await settle();
  return event;
};
const press = async (target: EventTarget, key: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
};
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const cellOf = (truck: string) => rowFor(truck).querySelector('[title]') ?? rowFor(truck);

describe('the items (QoL 8)', () => {
  it("the demo's menu without Mark arrived, each disabled with its reason, never hidden", () => {
    expect(rowMenuItems(A, { role: 'dispatcher', pinned: false, checked: false })).toEqual([
      { id: 'edit', label: 'Edit load', key: 'Enter', disabled: null },
      { id: 'address', label: 'Copy address', key: 'C', disabled: null },
      { id: 'load', label: 'Copy load info', key: null, disabled: null },
      { id: 'pin', label: 'Pin', key: 'P', disabled: null },
      { id: 'timeline', label: 'Timeline', key: 'T', disabled: null },
      { id: 'check', label: 'Check', key: 'X', disabled: null },
    ]);
    const none = rowMenuItems(B, { role: 'viewer', pinned: true, checked: true });
    expect(none.map((i) => [i.label, i.disabled])).toEqual([
      ['Edit load', 'Your role is viewer. Editing needs dispatcher.'],
      ['Copy address', 'No next stop, so no address'],
      ['Copy load info', 'No next stop, so no load'],
      ['Unpin', null],
      ['Timeline', null],
      ['Uncheck', null],
    ]);
  });

  it('the keymap lists the keyboard way in', () => {
    expect(KEYMAP.some((b) => b.keys.join(' ') === '⇧ F10')).toBe(true);
  });
});

describe('right-click on a row (QoL 8)', () => {
  it("opens the menu at the pointer, the browser's own held back; the row is marked, not selected; the first item has the focus", async () => {
    await render();
    const event = await rightClick(cellOf('101'));
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute('role')).toBe('menu');
    expect(menu()?.getAttribute('aria-label')).toBe('Truck 101');
    expect(labels()).toEqual(['Edit load', 'Copy address', 'Copy load info', 'Pin', 'Timeline', 'Check']);
    expect(rowFor('101').hasAttribute('data-menu-for')).toBe(true);
    expect(rowFor('101').getAttribute('aria-selected')).toBe('false');
    expect(document.activeElement).toBe(item('edit'));
  });

  it("on selected text the browser's own menu stays", async () => {
    await render();
    const cell = [...rowFor('101').querySelectorAll('span')].find((s) => s.textContent === 'Ana Petrovic') ?? cellOf('101');
    const range = document.createRange();
    range.selectNodeContents(cell);
    window.getSelection()!.addRange(range);
    const event = await rightClick(cell);
    expect(event.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it("a press that selects the word under it first (Chrome on a Mac is said to): read at the press, the menu still opens, and the word is let go", async () => {
    await render();
    const target = cellOf('101');
    // After the row's own handler, as the browser's default action on the press would be.
    const macPress = (event: Event) => {
      if ((event as MouseEvent).button !== 2) return;
      const range = document.createRange();
      range.selectNodeContents(target);
      window.getSelection()!.addRange(range);
    };
    document.addEventListener('pointerdown', macPress);
    try {
      const event = await rightClick(target);
      expect(event.defaultPrevented).toBe(true);
      expect(menu()?.getAttribute('aria-label')).toBe('Truck 101');
      expect(window.getSelection()!.isCollapsed).toBe(true);
    } finally {
      document.removeEventListener('pointerdown', macPress);
    }
  });

  it("text selected somewhere else does not hold it back: the menu opens on a row the selection is not on", async () => {
    await render();
    const range = document.createRange();
    range.selectNodeContents(cellOf('202'));
    window.getSelection()!.addRange(range);
    const event = await rightClick(cellOf('101'));
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute('aria-label')).toBe('Truck 101');
  });

  it('arrows move through the items, disabled ones included so their reason can be read; Enter does one', async () => {
    await render();
    await rightClick(cellOf('202'));
    // Edit load does something for a dispatcher; the two copies are disabled with why.
    expect(document.activeElement).toBe(item('edit'));
    await press(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(item('address'));
    expect(item('address').getAttribute('aria-disabled')).toBe('true');
    expect(item('address').title).toBe('No next stop, so no address');
    await press(document.activeElement!, 'Enter');
    expect(writeText).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
    await press(document.activeElement!, 'End');
    expect(document.activeElement).toBe(item('check'));
    await press(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(item('edit'));
  });

  it('Esc closes it, the focus goes back to the row, and the press reaches nothing else', async () => {
    await render();
    await act(async () => rowFor('202').click());
    await rightClick(cellOf('101'));
    const esc = await press(document.activeElement!, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(rowFor('101'));
    // The board's Esc would have cleared the selection (202): it never heard this one.
    expect(rowFor('202').getAttribute('aria-selected')).toBe('true');
  });

  it("while it is open the board's keys stand down: X, C, T, P and a chip's digit change nothing behind it", async () => {
    await render();
    await act(async () => rowFor('202').click());
    await rightClick(cellOf('101'));
    for (const key of ['x', 'c', 't', 'p', '1']) await press(document.body, key);
    expect(rowFor('202').querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(opened.timelines).toEqual([]);
    expect(menu()).not.toBeNull();
  });

  it("each item goes through its own control's or key's code", async () => {
    await render();
    await rightClick(cellOf('101'));
    await click(item('address'));
    expect(writeText).toHaveBeenLastCalledWith('1 Test Dock, Joliet, IL, 60433');
    expect(rowFor('101').querySelector('button[aria-label="Copy address"]')!.textContent).toContain('Copied');

    await rightClick(cellOf('101'));
    await click(item('load'));
    expect(writeText).toHaveBeenLastCalledWith(
      'Load: E2E-101\nTruck: 101\nDriver: Ana Petrovic\nDeliver: 1 Test Dock, Joliet, IL, 60433',
    );
    expect(rowFor('101').querySelector('button[aria-label="Copy load info"]')!.textContent).toContain('Copied');

    await rightClick(cellOf('101'));
    await click(item('check'));
    expect(rowFor('101').querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);

    await rightClick(cellOf('101'));
    expect(item('check').textContent).toContain('Uncheck');
    await click(item('pin'));
    expect(rowFor('101').querySelector('button[aria-label="Unpin truck 101"]')).not.toBeNull();

    await rightClick(cellOf('101'));
    await click(item('timeline'));
    expect(opened.timelines).toEqual([A.id]);
  });

  it('Edit load opens the window as Enter does, selecting what it opens', async () => {
    await render();
    await rightClick(cellOf('101'));
    await click(item('edit'));
    expect(opened.windows.at(-1)).toBe(A.id);
    expect(rowFor('101').getAttribute('aria-selected')).toBe('true');
    expect(menu()).toBeNull();
  });

  it('a viewer: Edit load is there, disabled, with the reason, and does nothing', async () => {
    await render('viewer');
    await rightClick(cellOf('101'));
    expect(item('edit').getAttribute('aria-disabled')).toBe('true');
    expect(item('edit').title).toBe('Your role is viewer. Editing needs dispatcher.');
    await click(item('edit'));
    expect(opened.windows).toEqual([]);
    expect(menu()).not.toBeNull();
  });

  it('the menu key and Shift+F10 open it for the selected row', async () => {
    await render();
    await act(async () => rowFor('101').click());
    await press(document.body, 'F10', { shiftKey: true });
    expect(menu()?.getAttribute('aria-label')).toBe('Truck 101');
    await press(document.activeElement!, 'Escape');
    await press(document.body, 'ContextMenu');
    expect(menu()?.getAttribute('aria-label')).toBe('Truck 101');
  });

  it('a poll leaves it open and its items follow the truck; one that takes the truck off the board closes it', async () => {
    await render();
    await rightClick(cellOf('202'));
    expect(item('address').getAttribute('aria-disabled')).toBe('true');
    await poll([A, { ...B, nextStop: nextStop({ addressLine: '9 New St', city: 'Joliet', state: 'IL', zip: '60433' }) }]);
    expect(menu()).not.toBeNull();
    expect(item('address').getAttribute('aria-disabled')).toBeNull();
    await poll([A, { ...B, active: false }]);
    expect(menu()).toBeNull();
  });

  it('a scroll closes it, and so does a press outside it', async () => {
    await render();
    await rightClick(cellOf('101'));
    await act(async () => {
      container!.querySelector('[data-board-rows]')?.parentElement?.dispatchEvent(new Event('scroll'));
    });
    expect(menu()).toBeNull();
    await rightClick(cellOf('101'));
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('a window opening closes it: its own Timeline here', async () => {
    await render();
    await rightClick(cellOf('101'));
    await click(item('timeline'));
    expect(menu()).toBeNull();
    expect(opened.timelines).toEqual([A.id]);
  });
});
