// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentBoard } from './AssignmentBoard';
import type { AssignmentBoard as Board } from '@/server/assignments';

/**
 * §12.38. The WHOLE flow, clicked through.
 *
 * The previous test asserted that the tag renders. It did not click anything,
 * so "the picker is left with Ada selected on that truck" went unverified —
 * and was false. This asserts the truck ends up with the driver ON it, which
 * is the only thing the dispatcher cares about.
 */

/**
 * A fake server that behaves like the real one: `POST` mutates its board and
 * `router.refresh()` re-renders from it.
 *
 * The first version of this test mocked `refresh` as a no-op, which hid the
 * actual mechanism — the board never got new props, so the effect that resets
 * the draft never fired. A mock that cannot reproduce the bug is a mock that
 * will pass the fix and the bug alike.
 */
const server = { board: null as Board | null };
const refresh = vi.fn(() => {
  act(() => {
    /**
     * A CLONE, because a server render delivers new objects.
     *
     * The first version re-rendered with the same `server.board` reference,
     * so `board.trucks` kept its identity, the `initial` memo never
     * recomputed and the reset effect never fired — the test passed against
     * the very code it was written to catch. A mock that cannot express the
     * bug cannot verify the fix (§12.38).
     */
    root!.render(
      createElement(AssignmentBoard, {
        board: structuredClone(server.board!),
        role: 'admin' as const,
      }),
    );
  });
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let posted: { url: string; body: Record<string, unknown> }[] = [];

const EMPTY_TRUCK: Board = {
  trucks: [
    {
      id: 't-1',
      truckNumber: 137,
      samsaraName: 'Truck 137',
      driverId: null,
      driverName: null,
      driverSource: null,
      driverSamsaraId: null,
      since: null,
    },
  ],
  drivers: [],
};

beforeEach(() => {
  posted = [];
  refresh.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  server.board = structuredClone(EMPTY_TRUCK);

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url, body });
      if (body.action === 'create') {
        const driver = body.driver as { name: string };
        // The roster gains the driver.
        server.board!.drivers.push({
          id: 'd-new',
          name: driver.name,
          active: true,
          source: 'app',
          samsaraDriverId: null,
          phone: null,
          truckId: null,
          truckLabel: null,
        });
        /**
         * And, IF the request carried a truck, the assignment lands in the
         * same call — which is what "Add and assign" claims and what §12.28
         * requires of one dispatcher action.
         */
        if (typeof body.truckId === 'string') {
          const truck = server.board!.trucks.find((t) => t.id === body.truckId);
          if (truck) {
            truck.driverId = 'd-new';
            truck.driverName = driver.name;
            truck.driverSource = 'app';
            truck.driverSamsaraId = null;
          }
          const created = server.board!.drivers.at(-1)!;
          created.truckId = body.truckId as string;
          created.truckLabel = '137';
        }
      }
      return new Response(JSON.stringify({ driverId: 'd-new' }), { status: 200 });
    }
    return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const OCCUPIED_TRUCK: Board = {
  trucks: [
    {
      id: 't-1',
      truckNumber: 137,
      samsaraName: 'Truck 137',
      driverId: 'd-old',
      driverName: 'Existing Ed',
      driverSource: 'samsara',
      driverSamsaraId: 'sam-old',
      since: null,
    },
  ],
  drivers: [
    {
      id: 'd-old',
      name: 'Existing Ed',
      active: true,
      source: 'samsara',
      samsaraDriverId: 'sam-old',
      phone: null,
      truckId: 't-1',
      truckLabel: '137',
    },
  ],
};

/**
 * ASYNC: the board mounts MergePrompt, which fetches on mount. A synchronous
 * act returns before that settles, so its setState lands outside any act
 * scope and the assertions run against a tree mid-update.
 */
const render = async (board: Board = server.board!) => {
  await act(async () => {
    root!.render(createElement(AssignmentBoard, { board, role: 'admin' as const }));
  });
  return container!;
};

const setValue = (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const byText = (needle: string) =>
  [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(needle));

/** Types a name, opens the inline form and submits it. */
async function addDriverNamed(name: string) {
  const picker = container!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  act(() => picker.focus());
  act(() => setValue(picker, name));

  const offer = byText('as a new driver');
  expect(offer, 'the "+ Add driver" affordance should be offered').toBeDefined();
  act(() => offer!.click());

  const nameField = container!.querySelector<HTMLInputElement>(
    'input[aria-label="New driver name"]',
  )!;
  expect(nameField.value).toBe(name);

  await act(async () => {
    byText('Add and assign')!.click();
    // Let the create POST and everything chained off it settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('adding a driver from the board assigns them to the truck', () => {
  it('puts the new driver on the truck, not merely into the roster', async () => {
    await render();
    await addDriverNamed('Ada Lovelace');

    // The driver was created.
    expect(posted.some((p) => p.body.action === 'create')).toBe(true);

    // THE ASSERTION THAT MATTERS: truck 137 now holds the new driver.
    const picker = container!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(picker.value).toBe('Ada Lovelace');
  });

  it('sends the assignment, rather than leaving it in an unsaved draft', async () => {
    await render();
    await addDriverNamed('Ada Lovelace');

    // One action from the dispatcher's side is one write from ours (§12.28).
    const assigned = posted.find(
      (p) => p.body.action === 'create' && p.body.truckId === 't-1',
    );
    expect(assigned, 'the create call should carry the truck it is for').toBeDefined();
  });
});

describe('an occupied truck is a reassignment, not a create-and-assign', () => {
  it('says "Add driver", because that is all the button can do there', async () => {
    server.board = structuredClone(OCCUPIED_TRUCK);
    await render();
    const picker = container!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    act(() => picker.focus());
    act(() => setValue(picker, 'Ada Lovelace'));
    act(() => byText('as a new driver')!.click());

    // The label matches the capability. Promising an assignment it will not
    // make is how the first version of this shipped.
    expect(byText('Add and assign')).toBeUndefined();
    expect(byText('Add driver')).toBeDefined();
    expect(container!.innerHTML).toContain('confirmed when you save');
  });

  it('does not send a truckId, so nothing bypasses the confirm', async () => {
    server.board = structuredClone(OCCUPIED_TRUCK);
    await render();
    const picker = container!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    act(() => picker.focus());
    act(() => setValue(picker, 'Ada Lovelace'));
    act(() => byText('as a new driver')!.click());
    await act(async () => {
      byText('Add driver')!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const create = posted.find((p) => p.body.action === 'create')!;
    expect(create.body.truckId).toBeUndefined();
    // Still selected in the picker, so Save runs the existing confirm path.
    expect(
      container!.querySelector<HTMLInputElement>('input[role="combobox"]')!.value,
    ).toBe('Ada Lovelace');
  });
});

describe('a refresh no longer eats a pending edit', () => {
  /**
   * The defect behind the bug, not just its symptom (§12.38). `retire()` and
   * `save()` both call router.refresh(), and the reset effect threw away any
   * edit made before the new props landed.
   */
  it('keeps an edit made on another truck while the board refreshes', async () => {
    server.board = {
      trucks: [
        { ...EMPTY_TRUCK.trucks[0]! },
        {
          id: 't-2',
          truckNumber: 143,
          samsaraName: 'Truck 143',
          driverId: null,
          driverName: null,
          driverSource: null,
          driverSamsaraId: null,
          since: null,
        },
      ],
      drivers: [
        {
          id: 'd-x',
          name: 'Picked Pat',
          active: true,
          source: 'samsara',
          samsaraDriverId: 'sam-x',
          phone: null,
          truckId: null,
          truckLabel: null,
        },
      ],
    };
    await render();

    // Stage a driver on truck 143.
    const pickers = container!.querySelectorAll<HTMLInputElement>('input[role="combobox"]');
    act(() => pickers[1]!.focus());
    act(() => setValue(pickers[1]!, 'Picked'));
    act(() => {
      [...container!.querySelectorAll('[role="option"]')]
        .find((o) => o.textContent?.includes('Picked Pat'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(
      container!.querySelectorAll<HTMLInputElement>('input[role="combobox"]')[1]!.value,
    ).toBe('Picked Pat');

    // Something else refreshes the board — retiring a driver does exactly this.
    act(() => refresh());

    // The pending edit survives. It used to be wiped, silently.
    expect(
      container!.querySelectorAll<HTMLInputElement>('input[role="combobox"]')[1]!.value,
    ).toBe('Picked Pat');
  });
});
