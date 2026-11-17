// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import type { FleetResponse } from '@/hooks/useFleet';
import type { Role } from '@/lib/roles';
import { NO_FILE_HANDED } from '@/components/edit/window-drop';
import { BEHIND_A_WINDOW, OFF_THE_ROWS, boardDrop, dropMarkOf } from './useBoardDrop';

/**
 * Phase 3bx, QoL feature 1 (§12.164). A PDF dropped on a truck's row. The board's half: the row
 * under the file says whose window it opens or why it takes nothing; every file drag on the board
 * is taken; let go on a row that takes it, that truck's window opens holding the `File`; anywhere
 * else the board says nothing was read and why.
 *
 * The edit window is a stand-in that records the file it was opened with: `edit/start-file.test`
 * holds the real window to reading it through the strip's own way in.
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
const opened = vi.hoisted(() => ({ windows: [] as { id: string; file: File | null }[] }));
vi.mock('@/components/edit/EditStopModal', () => ({
  EditStopModal: (props: { row: { id: string }; startFile?: File | null; onClose: () => void }) => {
    opened.windows.push({ id: props.row.id, file: props.startFile ?? null });
    return createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'data-stub-window': props.row.id },
      createElement('button', { 'data-stub-close': '', onClick: () => props.onClose() }, 'Close'),
    );
  },
}));

const { Console } = await import('./Console');

const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
/** No next stop: its window opens on a new load, and it takes a file. */
const FREE = fleetRow({ id: id(408), truckNumber: 408, samsaraName: 'Truck #408', driverName: 'Ana Petrovic', status: 'NO_APPT', computed: 'NO_APPT', nextStop: null, openLoadCount: 0 });
/** A next stop: saved stops, and a read never replaces them. */
const BUSY = fleetRow({ id: id(101), truckNumber: 101, samsaraName: 'Truck #101', status: 'ON_TIME', computed: 'ON_TIME', nextStop: nextStop({ stopId: `${id(101).slice(0, 8)}-0000-4000-8000-000000000001` }) });

const answer = (fleet: FleetResponse['fleet']): FleetResponse => ({
  fleet,
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreLayout: () => void = () => {};

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  opened.windows.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
});

const render = async (role: Role = 'dispatcher', fleet = [FREE, BUSY]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: answer(fleet),
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

const PDF = new File(['%PDF-1.4 invented'], 'rate-con.pdf', { type: 'application/pdf' });

/**
 * A drag as the browser sends one. As a real browser does, the transfer hands over nothing once
 * the event has been dispatched, so a file read later than the event is gone.
 */
async function drag(
  target: Element,
  type: 'dragenter' | 'dragover' | 'drop' | 'dragleave',
  carrying: 'files' | 'text' | 'empty' = 'files',
): Promise<Event> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  let open = true;
  const files = carrying === 'files' ? [PDF] : [];
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: carrying === 'text' ? ['text/plain'] : ['Files'],
      get files() {
        return open ? files : [];
      },
      dropEffect: 'none',
    },
  });
  await act(async () => {
    target.dispatchEvent(event);
    open = false;
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return event;
}

const rowEl = (n: number) =>
  [...container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find((el) => (el.textContent ?? '').includes(String(n)))!;
const cellOf = (n: number) => rowEl(n).querySelector('[title]') ?? rowEl(n);
const mark = (n: number) => rowEl(n).querySelector('[data-drop-mark]')?.textContent ?? null;
const notice = () => container!.querySelector('[data-drop-notice] span')?.textContent ?? null;

describe('what a row says, and what a drop does (QoL 1)', () => {
  it('a row that takes it names its truck and driver; one that cannot says why, by the one rule', () => {
    expect(dropMarkOf(FREE, 'dispatcher')).toEqual({ id: FREE.id, takes: true, text: 'Read this for truck 408 · Ana Petrovic' });
    expect(dropMarkOf(BUSY, 'dispatcher')).toEqual({
      id: BUSY.id,
      takes: false,
      text: 'Truck 101: this load has saved stops, and a read only fills a new load',
    });
    expect(dropMarkOf(FREE, 'viewer')).toEqual({ id: FREE.id, takes: false, text: 'Truck 408: a viewer cannot fill a load' });
  });

  it("let go: a window that takes it, or the reason, in the rule's words", () => {
    expect(boardDrop({ row: FREE, role: 'dispatcher', file: PDF, windowOpen: false })).toEqual({ take: { id: FREE.id, file: PDF } });
    expect(boardDrop({ row: BUSY, role: 'dispatcher', file: PDF, windowOpen: false })).toEqual({
      said: 'Nothing was read for truck 101: this load has saved stops, and a read only fills a new load.',
    });
    expect(boardDrop({ row: FREE, role: 'viewer', file: PDF, windowOpen: false })).toEqual({
      said: 'Nothing was read for truck 408: a viewer cannot fill a load.',
    });
    expect(boardDrop({ row: null, role: 'dispatcher', file: PDF, windowOpen: false })).toEqual({ said: OFF_THE_ROWS });
    expect(boardDrop({ row: FREE, role: 'dispatcher', file: undefined, windowOpen: false })).toEqual({ said: NO_FILE_HANDED });
    expect(boardDrop({ row: FREE, role: 'dispatcher', file: PDF, windowOpen: true })).toEqual({ said: BEHIND_A_WINDOW });
  });
});

describe('a PDF dragged over the board (QoL 1)', () => {
  it('the row under it is marked and names its truck; moving to another row moves the mark; leaving the page clears it', async () => {
    await render();
    await drag(cellOf(408), 'dragenter');
    const over = await drag(cellOf(408), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(mark(408)).toBe('Read this for truck 408 · Ana Petrovic');
    expect(rowEl(408).getAttribute('data-drop-row')).toBe('yes');

    await drag(cellOf(101), 'dragenter');
    await drag(cellOf(408), 'dragleave');
    await drag(cellOf(101), 'dragover');
    expect(mark(408)).toBeNull();
    expect(mark(101)).toBe('Truck 101: this load has saved stops, and a read only fills a new load');
    expect(rowEl(101).getAttribute('data-drop-row')).toBe('no');

    await drag(cellOf(101), 'dragleave');
    expect(mark(101)).toBeNull();
    expect(container!.querySelectorAll('[data-drop-row]')).toHaveLength(0);
  });

  it("let go on a row that takes it: that truck's window opens holding the very file, selected; nothing is said", async () => {
    await render();
    await drag(cellOf(408), 'dragenter');
    await drag(cellOf(408), 'dragover');
    const drop = await drag(cellOf(408), 'drop');
    expect(drop.defaultPrevented).toBe(true);
    expect(opened.windows.at(-1)).toEqual({ id: FREE.id, file: PDF });
    expect(rowEl(408).getAttribute('aria-selected')).toBe('true');
    expect(notice()).toBeNull();
    expect(mark(408)).toBeNull();
  });

  it('the file is read out of the event: the window still has it after the browser stops handing it over', async () => {
    await render();
    await drag(cellOf(408), 'drop');
    // The transfer is closed by now (see `drag`); what the window holds is the File itself.
    expect(opened.windows.at(-1)?.file).toBe(PDF);
  });

  it('a window closed and opened again is not given the file again', async () => {
    await render();
    await drag(cellOf(408), 'drop');
    await act(async () => document.querySelector<HTMLButtonElement>('[data-stub-close]')!.click());
    await act(async () => rowEl(408).click());
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(opened.windows.at(-1)).toEqual({ id: FREE.id, file: null });
  });

  it('let go on a row that cannot take it: no window, and the board says why, naming the truck', async () => {
    await render();
    const drop = await drag(cellOf(101), 'drop');
    expect(drop.defaultPrevented, 'the browser would open the file').toBe(true);
    expect(opened.windows).toHaveLength(0);
    expect(notice()).toBe('Nothing was read for truck 101: this load has saved stops, and a read only fills a new load.');
  });

  it('let go off the rows: taken, no window, and the board says why', async () => {
    await render();
    const header = container!.querySelector('header') ?? container!.firstElementChild!;
    const over = await drag(header, 'dragover');
    expect(over.defaultPrevented).toBe(true);
    const drop = await drag(header, 'drop');
    expect(drop.defaultPrevented, 'the browser would open the file').toBe(true);
    expect(opened.windows).toHaveLength(0);
    expect(notice()).toBe(OFF_THE_ROWS);
  });

  it('a drag that says Files and hands none over: no window, and the board says why', async () => {
    await render();
    await drag(cellOf(408), 'drop', 'empty');
    expect(opened.windows).toHaveLength(0);
    expect(notice()).toBe(NO_FILE_HANDED);
  });

  it('the next file drag takes the last answer away, and Dismiss does too', async () => {
    await render();
    await drag(cellOf(101), 'drop');
    expect(notice()).not.toBeNull();
    await drag(cellOf(408), 'dragenter');
    expect(notice()).toBeNull();
    await drag(cellOf(101), 'drop');
    await act(async () => container!.querySelector<HTMLButtonElement>('[data-drop-notice] button')!.click());
    expect(notice()).toBeNull();
  });

  it("text and links stay the browser's: not taken, no mark, nothing said", async () => {
    await render();
    const over = await drag(cellOf(408), 'dragover', 'text');
    expect(over.defaultPrevented).toBe(false);
    expect(mark(408)).toBeNull();
    const drop = await drag(cellOf(408), 'drop', 'text');
    expect(drop.defaultPrevented).toBe(false);
    expect(opened.windows).toHaveLength(0);
    expect(notice()).toBeNull();
  });

  it('a viewer: the row says why, the drop is taken, and nothing opens, never hidden', async () => {
    await render('viewer');
    await drag(cellOf(408), 'dragover');
    expect(mark(408)).toBe('Truck 408: a viewer cannot fill a load');
    const drop = await drag(cellOf(408), 'drop');
    expect(drop.defaultPrevented).toBe(true);
    expect(opened.windows).toHaveLength(0);
    expect(notice()).toBe('Nothing was read for truck 408: a viewer cannot fill a load.');
  });

  it('behind a window: no row is marked, the drop is taken, and the board says to close it first', async () => {
    await render();
    const blocker = document.createElement('div');
    blocker.setAttribute('aria-modal', 'true');
    document.body.appendChild(blocker);
    try {
      await drag(cellOf(408), 'dragover');
      expect(mark(408)).toBeNull();
      const drop = await drag(cellOf(408), 'drop');
      expect(drop.defaultPrevented).toBe(true);
      expect(opened.windows).toHaveLength(0);
      expect(notice()).toBe(BEHIND_A_WINDOW);
    } finally {
      blocker.remove();
    }
  });

  it('what the edit window took is its own: a drop it prevented is not read again by the board', async () => {
    await render();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [PDF], dropEffect: 'none' } });
    event.preventDefault();
    await act(async () => {
      cellOf(408).dispatchEvent(event);
    });
    expect(opened.windows).toHaveLength(0);
    expect(notice()).toBeNull();
  });

  it('below the editing width nothing new is offered: the drag is not taken (§12.94)', async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => {
      const list = real.call(window, query);
      Object.defineProperty(list, 'matches', { get: () => false });
      return list;
    }) as typeof window.matchMedia;
    try {
      await render();
      const over = await drag(cellOf(408), 'dragover');
      expect(over.defaultPrevented).toBe(false);
      expect(mark(408)).toBeNull();
    } finally {
      window.matchMedia = real;
    }
  });
});
