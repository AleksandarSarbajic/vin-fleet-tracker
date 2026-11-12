// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardElement, testQueryClient } from '@/test/assignment-board';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { AssignmentBoard as Board, BoardDriver } from '@/server/assignments';

/**
 * §12.153, the Assignments board's four small motions: the rows in view drawing in when a
 * change of page opens it, a picked driver dropping into its row, the picker's "Add a driver"
 * form, and "Saved — …" in the footer. Each starts on its cause, at its own length written
 * out, and on nothing else: not the page a load lands on, not a refresh and the rebase it
 * brings, not Discard, a tab, the search or a re-render. Every name and number is invented.
 */

const arrival = vi.hoisted(() => ({ byChange: true }));
vi.mock('@/lib/page-arrival', () => ({ cameByPageChange: () => arrival.byChange, arrive: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const driver = (id: string, name: string, truckId: string | null): BoardDriver => ({
  id,
  name,
  active: true,
  source: 'samsara',
  samsaraDriverId: `sam-${id}`,
  phone: null,
  truckId,
  truckLabel: truckId === 't-1' ? '137' : truckId === 't-2' ? '143' : null,
});
const truck = (id: string, number: number, driverId: string | null, driverName: string | null) => ({
  id,
  truckNumber: number,
  samsaraName: `Truck ${number}`,
  driverId,
  driverName,
  driverSource: driverId === null ? null : ('samsara' as const),
  driverSamsaraId: driverId === null ? null : `sam-${driverId}`,
  since: null,
});
const BOARD: Board = {
  trucks: [truck('t-1', 137, 'd-a', 'Ada Quill'), truck('t-2', 143, 'd-b', 'Bo Reyes'), truck('t-3', 150, null, null)],
  drivers: [driver('d-a', 'Ada Quill', 't-1'), driver('d-b', 'Bo Reyes', 't-2'), driver('d-c', 'Cy Tamm', null)],
};

const FADE_ROW = { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 180, easing: 'linear', fill: 'backwards' };
const DROP_14 = {
  keyframes: [
    { opacity: 0, translate: '0 -14px' },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
};
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
const realRect = HTMLElement.prototype.getBoundingClientRect;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  arrival.byChange = true;
  recorder = recordAnimations();
  /** happy-dom lays nothing out: the board scrolls 800px, and its rows are 44px, one under the other. */
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.hasAttribute('data-asg-row')) {
      const rows = [...(this.parentElement?.querySelectorAll(':scope > [data-asg-row]') ?? [])];
      return new DOMRect(0, 60 + rows.indexOf(this) * 44, 1000, 44);
    }
    return new DOMRect(0, 0, 1000, 800);
  };
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === '/api/assignments') return json({ assigned: 1, cleared: 0, unchanged: 0 });
    return json({ candidates: [] });
  }) as unknown as typeof fetch;
  client = testQueryClient();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  client.clear();
  container?.remove();
  root = null;
  container = null;
  recorder.restore();
  unreduce?.();
  unreduce = null;
  HTMLElement.prototype.getBoundingClientRect = realRect;
  vi.restoreAllMocks();
});

const render = async (board: Board = BOARD) => {
  await act(async () => {
    root!.render(boardElement(client, { board, role: 'dispatcher' }));
  });
};
const rowOf = (truckId: string) => container!.querySelector(`[data-asg-row="${truckId}"]`)!;
const fieldOf = (truckId: string) => rowOf(truckId).querySelector<HTMLInputElement>('[role="combobox"]')!;
const button = (name: string | RegExp) =>
  [...container!.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? (b.textContent ?? '').trim() === name || b.getAttribute('aria-label') === name : name.test(b.textContent ?? ''),
  )!;
/** Opens a row's picker and picks a name in it, as a person does. */
const pick = async (truckId: string, name: string) => {
  await act(async () => fieldOf(truckId).click());
  const option = [...rowOf(truckId).querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    (b.textContent ?? '').startsWith(name),
  )!;
  await act(async () => option.click());
};
const typeInto = async (input: HTMLInputElement, text: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const on = (el: Element | null) => recorder.played.filter((p) => p.el === el);

describe('asgRows: the rows in view draw in when a change of page opens the board', () => {
  it('each row fades in for 180ms, 30ms after the one before, opacity only, linear', async () => {
    await render();
    const rows = [...container!.querySelectorAll('[data-asg-row]')];
    expect(recorder.played.map((p) => p.el)).toEqual(rows);
    expect(recorder.played.map(shape)).toEqual([
      { ...FADE_ROW, delay: 0 },
      { ...FADE_ROW, delay: 30 },
      { ...FADE_ROW, delay: 60 },
    ]);
  });

  it('the page a load lands on draws nothing: its rows are the server’s first paint', async () => {
    arrival.byChange = false;
    await render();
    expect(container!.querySelectorAll('[data-asg-row]')).toHaveLength(3);
    expect(recorder.played).toEqual([]);
  });

  it('a refresh, a tab and the search play nothing more', async () => {
    await render();
    const before = recorder.played.length;
    await render({ ...BOARD, trucks: BOARD.trucks.map((t) => ({ ...t })) });
    await act(async () => button(/^No driver/).click());
    await act(async () => button(/^All/).click());
    await typeInto(container!.querySelector<HTMLInputElement>('input[aria-label="Search trucks, drivers or phones"]')!, '14');
    expect(container!.querySelectorAll('[data-asg-row]')).toHaveLength(1);
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('under reduced motion nothing plays, and the rows are there', async () => {
    unreduce = reduceMotion();
    await render();
    expect(container!.querySelectorAll('[data-asg-row]')).toHaveLength(3);
    expect(recorder.played).toEqual([]);
  });
});

describe('asgDriver: a picked driver drops into its row', () => {
  const opened = async () => {
    arrival.byChange = false;
    await render();
  };

  it('a pick in the row’s picker: the name drops 14px in 270ms, and the “was” line that arrives with it too', async () => {
    await opened();
    await pick('t-1', 'Cy Tamm');
    expect(fieldOf('t-1').value).toBe('Cy Tamm');
    const was = rowOf('t-1').querySelector('[data-was]');
    expect(was?.textContent).toContain('Ada Quill');
    expect(on(fieldOf('t-1')).map(shape)).toEqual([DROP_14]);
    expect(on(was).map(shape)).toEqual([DROP_14]);
    expect(recorder.played).toHaveLength(2);
  });

  it('a second pick on the same row: the name drops again, and the “was” line, there already, stays', async () => {
    await opened();
    await pick('t-1', 'Cy Tamm');
    const before = recorder.played.length;
    await pick('t-1', 'Bo Reyes');
    expect(fieldOf('t-1').value).toBe('Bo Reyes');
    expect(recorder.played.slice(before).map((p) => p.el)).toEqual([fieldOf('t-1')]);
  });

  it('the driver it already had: nothing changed, so nothing plays', async () => {
    await opened();
    await pick('t-1', 'Ada Quill');
    expect(fieldOf('t-1').value).toBe('Ada Quill');
    expect(recorder.played).toEqual([]);
  });

  it('“Assign to” in the panel is a pick too: the empty truck’s name drops in', async () => {
    await opened();
    await act(async () => button('Assign Cy Tamm to truck 150').click());
    expect(fieldOf('t-3').value).toBe('Cy Tamm');
    expect(on(fieldOf('t-3')).map(shape)).toEqual([DROP_14]);
  });

  it('a refresh’s rebase plays nothing: another dispatcher’s change lands at once', async () => {
    await opened();
    const moved: Board = {
      trucks: [truck('t-1', 137, 'd-c', 'Cy Tamm'), BOARD.trucks[1]!, BOARD.trucks[2]!],
      drivers: [driver('d-a', 'Ada Quill', null), BOARD.drivers[1]!, driver('d-c', 'Cy Tamm', 't-1')],
    };
    await render(moved);
    expect(fieldOf('t-1').value).toBe('Cy Tamm');
    expect(recorder.played).toEqual([]);
  });

  it('the rebase keeps a pick and plays nothing for it: the pick played once, when it was made', async () => {
    await opened();
    await pick('t-2', 'Cy Tamm');
    const before = recorder.played.length;
    await render({ ...BOARD, trucks: BOARD.trucks.map((t) => ({ ...t })) });
    expect(fieldOf('t-2').value).toBe('Cy Tamm');
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('Discard puts every row back at once, with nothing played', async () => {
    await opened();
    await pick('t-1', 'Cy Tamm');
    const before = recorder.played.length;
    await act(async () => button('Discard').click());
    expect(fieldOf('t-1').value).toBe('Ada Quill');
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('under reduced motion nothing plays, and the new name is there', async () => {
    unreduce = reduceMotion();
    await opened();
    await pick('t-1', 'Cy Tamm');
    expect(fieldOf('t-1').value).toBe('Cy Tamm');
    expect(recorder.played).toEqual([]);
  });
});

describe('asgAdd: “Add a driver” drops in on “+ Add”', () => {
  const offer = async () => {
    arrival.byChange = false;
    await render();
    await act(async () => fieldOf('t-3').click());
    await typeInto(fieldOf('t-3'), 'Zed Nobody');
  };
  const form = () => container!.querySelector('input[aria-label="New driver name"]')?.closest('li') ?? null;

  it('the form drops 14px in 270ms, inside the open list', async () => {
    await offer();
    expect(form()).toBeNull();
    await act(async () => button(/^\+ Add “Zed Nobody”/).click());
    expect(form()).not.toBeNull();
    expect(on(form()).map(shape)).toEqual([DROP_14]);
    expect(recorder.played).toHaveLength(1);
  });

  it('the list closed and opened again, with the form still open: nothing more', async () => {
    await offer();
    await act(async () => button(/^\+ Add “Zed Nobody”/).click());
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(form()).toBeNull();
    await act(async () => fieldOf('t-3').click());
    expect(form()).not.toBeNull();
    expect(recorder.played).toHaveLength(1);
  });

  it('under reduced motion nothing plays, and the form is there', async () => {
    unreduce = reduceMotion();
    await offer();
    await act(async () => button(/^\+ Add “Zed Nobody”/).click());
    expect(form()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('asgSaved: “Saved — …” drops in as its words land', () => {
  const words = () => container!.querySelector('footer span.text-body')!;
  const SAVED: Board = {
    trucks: [truck('t-1', 137, 'd-c', 'Cy Tamm'), BOARD.trucks[1]!, BOARD.trucks[2]!],
    drivers: [driver('d-a', 'Ada Quill', null), BOARD.drivers[1]!, driver('d-c', 'Cy Tamm', 't-1')],
  };
  const saveOne = async () => {
    arrival.byChange = false;
    await render();
    await pick('t-1', 'Cy Tamm');
    await act(async () => button('Save assignments').click());
  };

  it('Save, then the saved board: the words drop 14px in 270ms, once', async () => {
    await saveOne();
    // The save landed, and the board has not caught up: the footer still counts the change.
    expect(words().textContent).toBe('1 row changed');
    const before = recorder.played.length;
    await render(SAVED);
    expect(words().textContent).toBe('Saved — 1 assigned, 0 cleared.');
    expect(recorder.played.slice(before).map((p) => p.el)).toEqual([words()]);
    expect(on(words()).map(shape)).toEqual([DROP_14]);
  });

  it('a re-render with the same words plays nothing more', async () => {
    await saveOne();
    await render(SAVED);
    const played = recorder.played.length;
    await render({ ...SAVED, trucks: SAVED.trucks.map((t) => ({ ...t })) });
    expect(words().textContent).toBe('Saved — 1 assigned, 0 cleared.');
    expect(recorder.played).toHaveLength(played);
  });

  it('under reduced motion nothing plays, and the words are there', async () => {
    unreduce = reduceMotion();
    await saveOne();
    await render(SAVED);
    expect(words().textContent).toBe('Saved — 1 assigned, 0 cleared.');
    expect(recorder.played).toEqual([]);
  });
});
