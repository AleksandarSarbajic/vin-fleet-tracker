// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { boardElement, testQueryClient } from '@/test/assignment-board';
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

let client: QueryClient;

beforeEach(() => {
  client = testQueryClient();
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
  client.clear();
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
    root!.render(boardElement(client, { board: board(), role }));
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

/** Opens truck `n`'s picker and picks the option whose text includes `name`. */
async function pickFor(n: number, name: string) {
  const input = container!.querySelector<HTMLInputElement>(`input[aria-label="Driver for truck ${n}"]`)!;
  await act(async () => input.click());
  const option = [...container!.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((o) =>
    o.textContent?.includes(name),
  )!;
  await act(async () => option.click());
}

const footerText = () => container!.querySelector('footer')!.textContent ?? '';

describe('a driver on two trucks (§12.131)', () => {
  it('names the trucks, and Save stays refused', async () => {
    await render();
    // Hal is on 137; putting him on 143 too is the clash the server refuses.
    await pickFor(143, 'Hand Entered Hal');
    expect(footerText()).toContain('a driver is on trucks 137 and 143');
    const save = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save assignments'),
    );
    expect(save?.disabled).toBe(true);
  });
});

async function renderBoard(b: Board) {
  await act(async () => {
    root!.render(boardElement(client, { board: b, role: 'dispatcher' }));
  });
  return container!;
}

const EMPTY_TRUCK: Board['trucks'][number] = {
  id: 't-3',
  truckNumber: 150,
  samsaraName: 'Truck 150',
  driverId: null,
  driverName: null,
  driverSource: null,
  driverSamsaraId: null,
  since: null,
};

const was = () => [...container!.querySelectorAll('[data-was]')];

describe('Currently shows only on a changed row (§12.130)', () => {
  it('is empty on every unchanged row', async () => {
    const html = (await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }))).innerHTML;
    expect(was()).toHaveLength(0);
    // §12.18: the empty truck says "Unassigned" once, in its picker, and nowhere as text.
    // (The fixture's "Unassigned Hal" is a name, not the word.)
    expect(container!.textContent!.replaceAll('Unassigned Hal', '')).not.toContain('Unassigned');
    expect(html).toContain('placeholder="Unassigned"');
  });

  it('says "was" and the saved driver, struck through, once the row changes', async () => {
    await render();
    await pickFor(143, 'Unassigned Hal');
    expect(was()).toHaveLength(1);
    expect(was()[0]!.textContent).toMatch(/^was\s*Samsara Sam$/);
    expect(was()[0]!.querySelector('.line-through')?.textContent).toContain('Samsara Sam');
  });

  it('writes a truck that had nobody as "was —", as the confirm does', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    await pickFor(150, 'Unassigned Hal');
    expect(was()).toHaveLength(1);
    expect(was()[0]!.textContent).toMatch(/^was\s*—$/);
  });

  it('strikes the saved driver’s name, and not their No ELD tag (§12.133)', async () => {
    await render();
    // 137's saved driver is the hand-entered one, so the "was" carries a tag.
    await pickFor(137, 'Samsara Sam');
    const row = was()[0]!;
    expect(row.querySelector('.line-through')?.textContent).toBe('Hand Entered Hal');
    const tag = row.querySelector('[title*="not in Samsara"]');
    expect(tag).not.toBeNull();
    expect(tag!.closest('.line-through')).toBeNull();
  });

  it('goes again when the change is undone', async () => {
    await render();
    await pickFor(143, 'Unassigned Hal');
    await pickFor(143, 'Samsara Sam');
    expect(was()).toHaveLength(0);
  });
});

describe('the row’s No ELD tag is in its own column, not the field (§12.140)', () => {
  const rowOf = (n: number) =>
    container!.querySelector(`input[aria-label="Driver for truck ${n}"]`)!.closest('[class*="grid-cols"]')!;
  const pickerBox = (n: number) =>
    container!.querySelector(`input[aria-label="Driver for truck ${n}"]`)!.parentElement!;

  it('tags the hand-entered driver in the ELD column and not the Samsara one', async () => {
    await render();
    expect(rowOf(137).querySelector('[data-eld] [title*="not in Samsara"]')).not.toBeNull();
    expect(rowOf(143).querySelector('[data-eld] [title*="not in Samsara"]')).toBeNull();
  });

  it('no longer puts the tag inside the picker’s field', async () => {
    await render();
    expect(pickerBox(137).querySelector('[title*="not in Samsara"]')).toBeNull();
  });

  it('follows the draft: the tag moves with the driver', async () => {
    await render();
    await pickFor(143, 'Unassigned Hal');
    expect(rowOf(143).querySelector('[data-eld] [title*="not in Samsara"]')).not.toBeNull();
  });
});

describe('empty trucks and the two panels', () => {
  const row = (n: number) =>
    container!.querySelector(`input[aria-label="Driver for truck ${n}"]`)!.closest('[class*="grid-cols"]')!;

  it('puts a truck with nobody on the unassigned ground, and only that truck', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    expect(row(150).className).toContain('bg-row-unassigned');
    expect(row(137).className).not.toContain('bg-row-unassigned');
  });

  it('lets a changed row’s ground win over the empty one', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    await act(async () =>
      container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 137"]')!.click(),
    );
    const clear = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Unassigned — clear this truck'),
    )!;
    await act(async () => clear.click());
    expect(row(137).className).toContain('bg-row-selected');
    expect(row(137).className).not.toContain('bg-row-unassigned');
  });

  it('sets the no-driver trucks on one wrapping line, and truncates nothing whole', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    const lists = [...container!.querySelectorAll('aside ul')];
    expect(lists).toHaveLength(2);
    expect(lists[1]!.className).toContain('flex-wrap');
    expect(lists[1]!.textContent).toBe('150');
    // `truncate` on an item cut the phone editor's help text in the drivers panel.
    for (const li of container!.querySelectorAll('aside li')) expect(li.className).not.toContain('truncate');
  });
});

describe('the column order (§12.135, §12.140, §12.145)', () => {
  it('heads the columns Truck, Driver, ELD, Driver’s phone, Currently', async () => {
    await render();
    const header = container!.querySelector('[class*="sticky"][class*="grid-cols"]')!;
    expect([...header.children].map((c) => c.textContent)).toEqual([
      'Truck',
      'Driver',
      'ELD',
      'Driver’s phone',
      'Currently',
    ]);
  });

  it('puts a row’s "was" under its driver’s name, and the phone after the ELD column', async () => {
    await render();
    await pickFor(143, 'Unassigned Hal');
    const row = container!
      .querySelector('input[aria-label="Driver for truck 143"]')!
      .closest('[class*="grid-cols"]')!;
    const cells = [...row.children];
    const driverCell = cells[1]!;
    expect(driverCell.querySelector('input[role="combobox"]')).not.toBeNull();
    // Under the field, not beside it: the field's own line comes first.
    expect(driverCell.lastElementChild!.matches('[data-was]')).toBe(true);
    expect(cells[2]!.matches('[data-eld]')).toBe(true);
    expect(cells[3]!.matches('[data-driver-phone]')).toBe(true);
    expect(cells[4]!.matches('[data-currently]')).toBe(true);
    expect(cells).toHaveLength(5);
  });
});

describe('the board’s rows and fields (§12.134)', () => {
  it('sits each row on the console’s 44px row, with quiet 32px pickers', async () => {
    await render();
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 137"]')!;
    expect(input.closest('[class*="grid-cols"]')!.className).toContain('min-h-row-comfortable');
    expect(input.className).toContain('h-8');
    expect(input.className).toContain('border-transparent');
  });

  it('keeps every picker boxed for a viewer', async () => {
    await act(async () => {
      root!.render(boardElement(client, { board: board(), role: 'viewer' }));
    });
    for (const input of container!.querySelectorAll('input[role="combobox"]')) {
      expect(input.className).not.toContain('border-transparent');
    }
  });
});

describe('the footer’s count, and a free driver’s entry', () => {
  const status = () => container!.querySelector('footer span')!;

  it('puts the count in primary ink while rows are changed, secondary at rest', async () => {
    await render();
    expect(status().className).toContain('text-text-secondary');
    await pickFor(143, 'Unassigned Hal');
    expect(status().textContent).toContain('1 row changed');
    expect(status().className).toContain('text-text');
    expect(status().className).not.toContain('text-text-secondary');
  });

  it('lays a free driver out as name and Retire, then the phone on its own line, at every width (3ao polish)', async () => {
    await act(async () => {
      root!.render(boardElement(client, { board: board(), role: 'admin' }));
    });
    const entry = container!.querySelector('[data-free-driver]')!;
    expect(entry.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
    // No one-line layout below 1100 any more: no third column, no breakpoint switch.
    expect(entry.className).not.toContain('_auto_auto]');
    expect(entry.className).not.toContain('min-[1100px]');
    const [name, phone, retire] = [...entry.children];
    expect(name!.textContent).toContain('Unassigned Hal');
    // A truly long name truncates; the whole of it is the title.
    expect(name!.getAttribute('title')).toBe('Unassigned Hal');
    expect(name!.className).toContain('row-start-1');
    expect(phone!.querySelector('[data-driver-phone]')).not.toBeNull();
    expect(phone!.className).toContain('row-start-2');
    expect(phone!.className).toContain('col-span-2');
    expect(retire!.textContent).toBe('Retire');
    expect(retire!.className).toContain('row-start-1');
  });
});

/** Types into a React-controlled input the way a keyboard would. */
async function typeInto(input: HTMLInputElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const searchBox = () =>
  container!.querySelector<HTMLInputElement>('input[aria-label="Search trucks, drivers or phones"]')!;
const tab = (name: string) =>
  [...container!.querySelectorAll<HTMLButtonElement>('[aria-label="Filter the trucks"] button')].find((b) =>
    b.textContent?.startsWith(name),
  )!;
const tabCount = (name: string) => Number(tab(name).textContent!.slice(name.length));
const shownTrucks = () =>
  [...container!.querySelectorAll<HTMLInputElement>('input[role="combobox"]')].map((i) =>
    i.getAttribute('aria-label')!.replace('Driver for truck ', ''),
  );
const saveButton = () =>
  [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes('Save assignments'),
  )!;

/** Answers the board's save with a success, and keeps every request body it was sent. */
function captureSaves(): unknown[] {
  const bodies: unknown[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/assignments') {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ assigned: 1, cleared: 0, unchanged: 0 }), { status: 200 });
    }
    return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

describe('the search (§12.137)', () => {
  const withEmpty = () => board({ trucks: [...board().trucks, EMPTY_TRUCK] });

  it('narrows the rows by truck number, driver name or phone digits', async () => {
    await renderBoard(
      board({
        drivers: [
          { ...APP_DRIVER, phone: '7085550101' },
          ...board().drivers.slice(1),
        ],
      }),
    );
    await typeInto(searchBox(), '143');
    expect(shownTrucks()).toEqual(['143']);
    await typeInto(searchBox(), 'samsara s');
    expect(shownTrucks()).toEqual(['143']);
    await typeInto(searchBox(), '(708) 555-0101');
    expect(shownTrucks()).toEqual(['137']);
    expect(container!.querySelector('[data-shown-count]')!.textContent).toBe('1 of 2 trucks');
  });

  it('says so when nothing matches, and Escape brings every row back', async () => {
    await renderBoard(withEmpty());
    await typeInto(searchBox(), 'nobody by this name');
    expect(shownTrucks()).toEqual([]);
    expect(container!.textContent).toContain('No trucks match.');
    await act(async () => {
      searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(shownTrucks()).toEqual(['137', '143', '150']);
  });

  it('is focused by "/", unless the dispatcher is typing in another field', async () => {
    await render();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    expect(document.activeElement).toBe(searchBox());

    const picker = container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 137"]')!;
    await act(async () => picker.focus());
    await act(async () => {
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    expect(document.activeElement).toBe(picker);
  });
});

describe('the filter tabs (§12.137)', () => {
  const withEmpty = () => board({ trucks: [...board().trucks, EMPTY_TRUCK] });

  it('counts each tab from the draft, and follows an edit', async () => {
    await renderBoard(withEmpty());
    expect(['All', 'No driver', 'No phone', 'No ELD', 'Shared phone'].map(tabCount)).toEqual([3, 1, 2, 1, 0]);
    await pickFor(150, 'Unassigned Hal');
    // 150 now has a driver with no phone and no ELD.
    expect(['All', 'No driver', 'No phone', 'No ELD', 'Shared phone'].map(tabCount)).toEqual([3, 0, 3, 2, 0]);
  });

  it('shows only its rows, one tab at a time', async () => {
    await renderBoard(withEmpty());
    await act(async () => tab('No driver').click());
    expect(tab('No driver').getAttribute('aria-pressed')).toBe('true');
    expect(tab('All').getAttribute('aria-pressed')).toBe('false');
    expect(shownTrucks()).toEqual(['150']);
    await act(async () => tab('No ELD').click());
    expect(shownTrucks()).toEqual(['137']);
    await act(async () => tab('All').click());
    expect(shownTrucks()).toEqual(['137', '143', '150']);
  });

  it('combines with the search', async () => {
    await renderBoard(withEmpty());
    await act(async () => tab('No phone').click());
    expect(shownTrucks()).toEqual(['137', '143']);
    await typeInto(searchBox(), 'hal');
    expect(shownTrucks()).toEqual(['137']);
    await typeInto(searchBox(), '150');
    expect(shownTrucks()).toEqual([]);
  });

  it('still counts and saves a changed row it hides, and sends what it would have sent anyway', async () => {
    const bodies = captureSaves();
    await renderBoard(withEmpty());
    await pickFor(143, 'Unassigned Hal');
    await act(async () => saveButton().click());

    await renderBoard({ ...withEmpty(), drivers: [...withEmpty().drivers] });
    await pickFor(143, 'Unassigned Hal');
    // 143 is hidden by both the tab and the search; the footer still has it.
    await act(async () => tab('No driver').click());
    await typeInto(searchBox(), '150');
    expect(shownTrucks()).toEqual(['150']);
    expect(footerText()).toContain('1 row changed');
    await act(async () => saveButton().click());

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1]).toEqual({ changes: [{ truckId: 't-2', driverId: 'd-app-free' }] });
  });
});

describe('a row’s state on its left edge (§12.140)', () => {
  const rowOf = (n: number) =>
    container!.querySelector(`input[aria-label="Driver for truck ${n}"]`)!.closest('[class*="grid-cols"]')!;

  it('marks an empty truck muted, a changed row in the accent, a conflict in the late ink', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    expect(rowOf(150).className).toContain('border-l-text-muted');
    expect(rowOf(137).className).toContain('border-l-transparent');
    await pickFor(150, 'Unassigned Hal');
    expect(rowOf(150).className).toContain('border-l-accent');
    // Hal onto 143 too: 137 and 143 are double-booked, and the conflict wins over the change.
    await pickFor(143, 'Hand Entered Hal');
    expect(rowOf(143).className).toContain('border-l-status-late-fg');
    expect(rowOf(143).className).not.toContain('border-l-accent');
    expect(rowOf(137).className).toContain('border-l-status-late-fg');
  });
});

describe('"+ Assign driver" on an empty truck (§12.139)', () => {
  const assignButtons = () =>
    [...container!.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent === '+ Assign driver',
    );
  const optionNames = () =>
    [...container!.querySelectorAll('[role="option"]')].map((o) => o.textContent);

  it('is offered on the empty truck only, beside "Unassigned"', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    expect(assignButtons()).toHaveLength(1);
    const row = assignButtons()[0]!.closest('[class*="grid-cols"]')!;
    expect(row.querySelector('input[aria-label="Driver for truck 150"]')!.getAttribute('placeholder')).toBe(
      'Unassigned',
    );
  });

  it('opens that row’s picker, focused, with the list a click on the field shows', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    const field = container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 150"]')!;
    await act(async () => field.click());
    const byClick = optionNames();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => assignButtons()[0]!.click());
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(container!.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(optionNames()).toEqual(byClick);
    expect(optionNames()[0]).toContain('no truck');
  });

  it('puts the picked driver in the draft only, as a pick in the field does', async () => {
    const bodies = captureSaves();
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    await act(async () => assignButtons()[0]!.click());
    const option = [...container!.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((o) =>
      o.textContent?.includes('Unassigned Hal'),
    )!;
    await act(async () => option.click());
    expect(bodies).toHaveLength(0);
    expect(footerText()).toContain('1 row changed');
    await act(async () => saveButton().click());
    expect(bodies).toEqual([{ changes: [{ truckId: 't-3', driverId: 'd-app-free' }] }]);
  });
});

describe('a shared phone, by driver (§12.138)', () => {
  const phoneOf = (n: number) =>
    container!
      .querySelector(`input[aria-label="Driver for truck ${n}"]`)!
      .closest('[class*="grid-cols"]')!
      .querySelector('[data-driver-phone]')!;
  const warning = (n: number) => phoneOf(n).querySelector('[data-shared-phone]');
  const sharedPanel = () => container!.querySelector('aside [data-shared-group]');

  /** Hal on 137 and Sam on 143, one number typed two ways. */
  const sharing = () =>
    board({
      drivers: board().drivers.map((d) =>
        d.id === 'd-app' ? { ...d, phone: '7085550101' } : d.id === 'd-samsara' ? { ...d, phone: '708-555-0101' } : d,
      ),
    });

  it('warns on both drivers’ rows, each naming the other’s truck', async () => {
    await renderBoard(sharing());
    expect(warning(137)!.textContent).toBe('also 143');
    expect(warning(137)!.getAttribute('title')).toBe('The same number as Samsara Sam (truck 143)');
    expect(warning(143)!.textContent).toBe('also 137');
    expect(warning(137)!.querySelector('svg')).not.toBeNull();
    expect(tabCount('Shared phone')).toBe(2);
  });

  it('lists the number and each driver with their truck in its own panel', async () => {
    await renderBoard(sharing());
    const lines = [...sharedPanel()!.children].map((c) => c.textContent);
    expect(lines).toEqual(['708-555-0101', '137Hand Entered Hal', '143Samsara Sam']);
  });

  it('does not call one driver on two trucks a shared phone', async () => {
    await renderBoard(
      board({ drivers: board().drivers.map((d) => (d.id === 'd-app' ? { ...d, phone: '7085550101' } : d)) }),
    );
    // Hal onto 143 as well: a double-booking, one driver, one phone.
    await pickFor(143, 'Hand Entered Hal');
    expect(footerText()).toContain('a driver is on trucks 137 and 143');
    expect(warning(137)).toBeNull();
    expect(warning(143)).toBeNull();
    expect(sharedPanel()).toBeNull();
    expect(tabCount('Shared phone')).toBe(0);
  });

  it('names a driver with no truck, who still shares the number', async () => {
    await renderBoard(
      board({
        drivers: board().drivers.map((d) =>
          d.id === 'd-app' ? { ...d, phone: '7085550101' } : d.id === 'd-free' ? { ...d, phone: '7085550101' } : d,
        ),
      }),
    );
    expect(warning(137)!.textContent).toBe('also Free Agent');
    expect(warning(137)!.getAttribute('title')).toBe('The same number as Free Agent (no truck)');
    // Free Agent's own entry in the drivers panel names Hal's truck.
    const free = container!.querySelector('aside [data-driver-phone="d-free"] [data-shared-phone]')!;
    expect(free.textContent).toBe('also 137');
    expect([...sharedPanel()!.children].map((c) => c.textContent)).toEqual([
      '708-555-0101',
      '137Hand Entered Hal',
      'no truckFree Agent',
    ]);
  });

  it('follows the draft: the warning names the truck the other driver is moving to', async () => {
    await renderBoard(
      board({
        trucks: [...board().trucks, EMPTY_TRUCK],
        drivers: board().drivers.map((d) =>
          d.id === 'd-app' ? { ...d, phone: '7085550101' } : d.id === 'd-free' ? { ...d, phone: '7085550101' } : d,
        ),
      }),
    );
    await pickFor(150, 'Free Agent');
    expect(warning(137)!.textContent).toBe('also 150');
    expect(warning(150)!.textContent).toBe('also 137');
  });
});

describe('the panels, and "Assign to" (§12.139, §12.140)', () => {
  const withEmpty = () => board({ trucks: [...board().trucks, EMPTY_TRUCK] });
  const panels = () => [...container!.querySelectorAll('aside > div')];
  const assignTo = (driverName: string) =>
    [...container!.querySelectorAll<HTMLButtonElement>('[data-assign-to] button')]
      .filter((b) => b.getAttribute('aria-label')!.startsWith(`Assign ${driverName} to`))
      .map((b) => b.textContent);
  const clickAssign = async (driverName: string, truck: string) => {
    const button = container!.querySelector<HTMLButtonElement>(
      `[data-assign-to] button[aria-label="Assign ${driverName} to truck ${truck}"]`,
    )!;
    await act(async () => button.click());
  };

  it('titles each panel, with its count at the right', async () => {
    await renderBoard(withEmpty());
    expect(panels().map((p) => p.querySelector('h2')!.textContent)).toEqual([
      'Drivers without a truck2',
      'Trucks without a driver1',
    ]);
    expect(panels()[0]!.querySelector('[data-panel-count]')!.textContent).toBe('2');
  });

  it('offers each free driver one button per truck empty in the draft', async () => {
    await renderBoard(withEmpty());
    expect(assignTo('Unassigned Hal')).toEqual(['150']);
    expect(assignTo('Free Agent')).toEqual(['150']);
    // Clearing 143 in the draft makes it a truck to assign to, and frees Sam.
    await act(async () =>
      container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 143"]')!.click(),
    );
    const clear = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Unassigned — clear this truck'),
    )!;
    await act(async () => clear.click());
    expect(assignTo('Free Agent')).toEqual(['143', '150']);
    expect(assignTo('Samsara Sam')).toEqual(['143', '150']);
  });

  it('puts the driver on the truck in the draft only: nothing is sent until Save', async () => {
    const bodies = captureSaves();
    await renderBoard(withEmpty());
    await clickAssign('Unassigned Hal', '150');
    expect(bodies).toHaveLength(0);
    const field = container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 150"]')!;
    expect(field.value).toBe('Unassigned Hal');
    expect(footerText()).toContain('1 row changed');
    expect(was()).toHaveLength(1);
    // Hal has a truck now, and 150 is no longer empty: both leave the panels.
    expect(assignTo('Unassigned Hal')).toEqual([]);
    expect(assignTo('Free Agent')).toEqual([]);
    expect(panels()[1]!.textContent).toContain('Every active truck has a driver.');
  });

  it('saves exactly what picking the driver in that row saves', async () => {
    const bodies = captureSaves();
    await renderBoard(withEmpty());
    await pickFor(150, 'Unassigned Hal');
    await act(async () => saveButton().click());

    await renderBoard({ ...withEmpty() });
    await clickAssign('Unassigned Hal', '150');
    await act(async () => saveButton().click());

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({ changes: [{ truckId: 't-3', driverId: 'd-app-free' }] });
  });

  it('lists the trucks without a driver as chips on the empty rows’ ground', async () => {
    await renderBoard(withEmpty());
    const chip = panels()[1]!.querySelector('li > *')!;
    expect(chip.className).toContain('bg-row-unassigned');
    expect(chip.textContent).toBe('150');
  });
});

describe('a viewer’s board (§12.141)', () => {
  const asViewer = async () => {
    await act(async () => {
      root!.render(
        boardElement(client, {
          board: board({
            trucks: [...board().trucks, EMPTY_TRUCK],
            drivers: board().drivers.map((d) => (d.id === 'd-app' ? { ...d, phone: '7085550101' } : d)),
          }),
          role: 'viewer',
        }),
      );
    });
  };
  const buttonsNamed = (pattern: RegExp) =>
    [...container!.querySelectorAll('button')].filter((b) =>
      pattern.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    );

  it('says VIEW ONLY beside the counts, with the reason', async () => {
    await asViewer();
    const badge = container!.querySelector('header [data-view-only]')!;
    expect(badge.textContent).toBe('View only');
    expect(badge.getAttribute('title')).toBe('Your role is viewer. Assignments need dispatcher.');
    await render('dispatcher');
    expect(container!.querySelector('[data-view-only]')).toBeNull();
  });

  it('offers no Assign driver, Assign to, pencil, Add or Retire, and keeps the pickers locked', async () => {
    await asViewer();
    expect(buttonsNamed(/^\+ Assign driver$/)).toHaveLength(0);
    expect(container!.querySelector('[data-assign-to]')).toBeNull();
    expect(buttonsNamed(/^Edit phone for/)).toHaveLength(0);
    expect(buttonsNamed(/^Add the phone for/)).toHaveLength(0);
    expect(buttonsNamed(/^Retire$/)).toHaveLength(0);
    for (const input of container!.querySelectorAll<HTMLInputElement>('input[role="combobox"]')) {
      expect(input.disabled).toBe(true);
      expect(input.title).toBe('Your role is viewer. Assignments need dispatcher.');
    }
    // The number is still read.
    expect(container!.textContent).toContain('708-555-0101');
  });

  it('still searches and filters', async () => {
    await asViewer();
    await act(async () => tab('No driver').click());
    expect(shownTrucks()).toEqual(['150']);
    await act(async () => tab('All').click());
    await typeInto(searchBox(), 'sam');
    expect(shownTrucks()).toEqual(['143']);
  });
});

describe('Save is the primary action only when there is something valid to save (§12.140)', () => {
  const solid = () => saveButton().className.includes('bg-accent');

  it('is disabled at rest, solid once a row changes, disabled again on a double-booking', async () => {
    await render();
    expect(saveButton().disabled).toBe(true);
    expect(solid()).toBe(false);
    // Drawn as a disabled Discard (3ao polish).
    expect(saveButton().className).toContain('disabled:opacity-45');

    await pickFor(143, 'Unassigned Hal');
    expect(saveButton().disabled).toBe(false);
    expect(solid()).toBe(true);

    await pickFor(143, 'Hand Entered Hal');
    expect(saveButton().disabled).toBe(true);
    expect(solid()).toBe(false);
  });

  it('is never solid for a viewer', async () => {
    await act(async () => {
      root!.render(boardElement(client, { board: board(), role: 'viewer' }));
    });
    expect(saveButton().disabled).toBe(true);
    expect(solid()).toBe(false);
  });
});

describe('the header at narrow widths', () => {
  it('narrows the search below 1100px and lets the counts truncate rather than wrap', async () => {
    await act(async () => {
      root!.render(boardElement(client, { board: board(), role: 'viewer' }));
    });
    const field = searchBox().closest('label')!;
    expect(field.className).toContain('w-[160px]');
    expect(field.className).toContain('min-[1100px]:w-[260px]');
    const counts = [...container!.querySelectorAll('header span')].find((s) =>
      s.textContent?.includes('active trucks'),
    )!;
    expect(counts.className).toContain('truncate');
    expect(container!.querySelector('[data-view-only]')!.className).toContain('shrink-0');
  });
});

describe('a truck chip opens that truck’s picker (§12.139, Alex 2026-10-22)', () => {
  const withEmpty = () => board({ trucks: [...board().trucks, EMPTY_TRUCK] });
  const chip = () =>
    container!.querySelector<HTMLElement>('aside button[aria-label="Assign a driver to truck 150"]');
  const field150 = () =>
    container!.querySelector<HTMLInputElement>('input[aria-label="Driver for truck 150"]');
  const scrolled = vi.fn();
  const realScroll = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    scrolled.mockReset();
    HTMLElement.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = realScroll;
  });

  it('scrolls the row into view, focuses its field and opens its list, as "+ Assign driver" does', async () => {
    await renderBoard(withEmpty());
    await act(async () => chip()!.click());
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(field150());
    expect(document.activeElement).toBe(field150());
    expect(field150()!.getAttribute('aria-expanded')).toBe('true');
    const byChip = [...container!.querySelectorAll('[role="option"]')].map((o) => o.textContent);

    // The row's own button reaches the same open(): the same scroll, the same list.
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const assign = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '+ Assign driver',
    )!;
    await act(async () => assign.click());
    expect(scrolled).toHaveBeenCalledTimes(2);
    expect([...container!.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(byChip);
  });

  it('brings a hidden row back first: the tab to All, the search cleared', async () => {
    await renderBoard(withEmpty());
    await act(async () => tab('No phone').click());
    await typeInto(searchBox(), 'hal');
    expect(field150()).toBeNull();

    await act(async () => chip()!.click());
    expect(tab('All').getAttribute('aria-pressed')).toBe('true');
    expect(searchBox().value).toBe('');
    expect(shownTrucks()).toEqual(['137', '143', '150']);
    expect(document.activeElement).toBe(field150());
    expect(field150()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves a visible row’s view alone', async () => {
    await renderBoard(withEmpty());
    await act(async () => tab('No driver').click());
    await act(async () => chip()!.click());
    expect(tab('No driver').getAttribute('aria-pressed')).toBe('true');
    expect(field150()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('stays inert for a viewer: no button, and a click opens nothing', async () => {
    await act(async () => {
      root!.render(boardElement(client, { board: withEmpty(), role: 'viewer' }));
    });
    const trucks = container!.querySelectorAll('aside > div')[1]!;
    expect(trucks.querySelectorAll('button, [role="button"]')).toHaveLength(0);
    const inert = trucks.querySelector<HTMLElement>('li > span')!;
    expect(inert.textContent).toBe('150');
    await act(async () => inert.click());
    expect(container!.querySelector('[role="listbox"]')).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });
});

describe('the Shared phone tab always shows (Alex 2026-10-22)', () => {
  it('renders with 0 when no number is shared', async () => {
    await render();
    expect(container!.querySelector('[data-shared-group]')).toBeNull();
    expect(tab('Shared phone').textContent).toBe('Shared phone0');
    expect(tabCount('Shared phone')).toBe(0);
  });
});

describe('3ao polish', () => {
  const discardButton = () =>
    [...container!.querySelectorAll<HTMLButtonElement>('footer button')].find((b) => b.textContent === 'Discard')!;

  it('draws a disabled Save as a disabled Discard, with the real disabled attribute, at rest and when refused', async () => {
    await render();
    const disabledLook = (b: HTMLButtonElement) => {
      expect(b.disabled).toBe(true);
      expect(b.hasAttribute('disabled')).toBe(true);
      for (const c of ['border-line-hair', 'text-text-secondary', 'disabled:opacity-45']) {
        expect(b.className.split(/\s+/)).toContain(c);
      }
      expect(b.className).not.toContain('bg-accent');
    };
    // At rest: "No changes."
    expect(footerText()).toContain('No changes.');
    disabledLook(saveButton());
    disabledLook(discardButton());

    // Refused: a double-booking. Discard is live; Save is not.
    await pickFor(143, 'Hand Entered Hal');
    expect(footerText()).toContain('a driver is on trucks 137 and 143');
    disabledLook(saveButton());
    expect(discardButton().disabled).toBe(false);

    // Something valid: the solid primary, enabled.
    await pickFor(143, 'Unassigned Hal');
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().className).toContain('bg-accent');
  });

  it('says "Search" below 1100px and the full hint from 1100 up, never as a cut placeholder', async () => {
    await render();
    expect(searchBox().getAttribute('aria-label')).toBe('Search trucks, drivers or phones');
    // The real placeholder is a space, so `:placeholder-shown` holds while the field is empty.
    expect(searchBox().getAttribute('placeholder')).toBe(' ');
    const short = container!.querySelector('[data-search-hint="short"]')!;
    const long = container!.querySelector('[data-search-hint="long"]')!;
    expect(short.textContent).toBe('Search');
    expect(short.className).toContain('peer-placeholder-shown:inline');
    expect(short.className).toContain('min-[1100px]:peer-placeholder-shown:hidden');
    expect(long.textContent).toBe('Truck, driver or phone');
    expect(long.className).toContain('min-[1100px]:peer-placeholder-shown:inline');
    for (const hint of [short, long]) {
      expect(hint.getAttribute('aria-hidden')).toBe('true');
      expect(hint.className.split(/\s+/)).toContain('hidden');
      expect(hint.className).toContain('whitespace-nowrap');
    }
    expect(searchBox().className).toContain('peer');
  });

  it('keeps every truck number 8px clear of the left edge, marked or not, and the header over them', async () => {
    await renderBoard(board({ trucks: [...board().trucks, EMPTY_TRUCK] }));
    await pickFor(143, 'Unassigned Hal');
    for (const n of [137, 143, 150]) {
      const row = container!
        .querySelector(`input[aria-label="Driver for truck ${n}"]`)!
        .closest('[class*="grid-cols"]')!;
      expect(row.children[0]!.className).toContain('pl-2');
    }
    const header = container!.querySelector('[class*="sticky"][class*="grid-cols"]')!;
    expect(header.children[0]!.textContent).toBe('Truck');
    expect(header.children[0]!.className).toContain('pl-2');
  });
});
