// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentBoard } from './AssignmentBoard';
import type { AssignmentBoard as Board, BoardDriver } from '@/server/assignments';

/**
 * §12.37. The smoke test that would have caught it.
 *
 * The driver feature shipped with a migration, a schema, a server module, an
 * API route and 28 passing tests — and no way to add a driver, and the tag on
 * exactly one of nine surfaces. Everything passed, because every test tested
 * the server and **nothing rendered a screen**. The tell was writing "the tag
 * will appear" without opening the board.
 *
 * This is deliberately shallow. It does not test layout, styling or
 * interaction depth; it asserts that the things claimed to be on screen are
 * on screen. That is the entire class of bug it exists for.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The prompt fetches open merge candidates on mount.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const driver = (over: Partial<BoardDriver> = {}): BoardDriver => ({
  id: 'd-samsara',
  name: 'Samsara Sam',
  active: true,
  source: 'samsara',
  samsaraDriverId: 'sam-1',
  phone: null,
  truckId: null,
  truckLabel: null,
  ...over,
});

const APP_DRIVER = driver({
  id: 'd-app',
  name: 'Hand Entered Hal',
  source: 'app',
  samsaraDriverId: null,
});

function board(over: Partial<Board> = {}): Board {
  return {
    trucks: [
      {
        id: 't-1',
        truckNumber: 137,
        samsaraName: 'Truck 137',
        driverId: 'd-app',
        driverName: 'Hand Entered Hal',
        driverSource: 'app',
        driverSamsaraId: null,
        since: null,
      },
      {
        id: 't-2',
        truckNumber: 143,
        samsaraName: 'Truck 143',
        driverId: 'd-samsara',
        driverName: 'Samsara Sam',
        driverSource: 'samsara',
        driverSamsaraId: 'sam-1',
        since: null,
      },
    ],
    /**
     * Two app-created drivers deliberately: one ON a truck and one without.
     * `driversWithoutTruck` filters out anyone assigned, so a fixture with
     * only the assigned one never renders the panel path — which is how the
     * first version of this test asserted 2 and found 1.
     */
    drivers: [
      APP_DRIVER,
      driver({ id: 'd-app-free', name: 'Unassigned Hal', source: 'app', samsaraDriverId: null }),
      driver(),
      driver({ id: 'd-free', name: 'Free Agent' }),
    ],
    ...over,
  };
}

/**
 * ASYNC, because the board mounts MergePrompt and MergePrompt fetches on
 * mount. A synchronous `act` returns before that promise settles, so the
 * `setCandidates` it causes lands outside anyone's act scope — React says so,
 * and with IS_REACT_ACT_ENVIRONMENT now set we can hear it. The await inside
 * `act` flushes the microtask, so the assertions run against a settled tree
 * rather than one mid-update.
 */
async function render(role: 'admin' | 'dispatcher' | 'viewer' = 'dispatcher') {
  await act(async () => {
    root!.render(createElement(AssignmentBoard, { board: board(), role }));
  });
  return container!;
}

describe('the No ELD tag is on the board, not just in a dropdown', () => {
  it('tags the hand-entered driver on the truck row', async () => {
    const html = (await render()).innerHTML;
    // Both names render; only one carries the tag.
    expect(html).toContain('Hand Entered Hal');
    expect(html).toContain('Samsara Sam');
    expect(html).toContain('No ELD');
  });

  it('renders exactly as many tags as there are ELD-less drivers on screen', async () => {
    const tags = (await render()).querySelectorAll('[title*="not in Samsara"]');
    // One truck row (Hand Entered Hal) + one panel entry (Unassigned Hal).
    // The two Samsara drivers must contribute none — a tag on everything
    // would pass a naive "contains No ELD" check and mean nothing.
    expect(tags.length).toBe(2);
  });

  it('says why, so the tag is not a mystery', async () => {
    const tag = (await render()).querySelector('[title*="not in Samsara"]');
    expect(tag?.getAttribute('title')).toMatch(/position comes from the vehicle/);
  });
});

describe('the retire control is admin-only', () => {
  it('is absent for a dispatcher', async () => {
    expect((await render('dispatcher')).innerHTML).not.toContain('Retire');
  });

  it('is present for an admin', async () => {
    expect((await render('admin')).innerHTML).toContain('Retire');
  });
});
