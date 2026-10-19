// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import { loadReadFor, primeLoadRead } from '@/test/load-read';
import type { FleetRow, NextStop } from '@/server/fleet-query';
import type { BoardDriver } from '@/server/assignments';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.127. A save that lands and keeps the modal open — a warning (§12.24,
 * §12.85), or the active flag refused (§12.14) — puts the modal on the load
 * AS SAVED: nothing unsaved, Save off until something changes, Cancel and Esc
 * close, the warning still shown, and the next save edits the load this one
 * wrote, against the version it returned.
 *
 * Before it, the modal stayed on its pre-save form: a new load's second Save
 * created a second load, and an existing load's was refused as stale by its
 * own first save. Every value here is invented.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-19T15:00:00.000Z');

const LOAD = '33333333-3333-4333-8333-0000000003af';
const STOP = '22222222-2222-4222-8222-0000000003af';
const CREATED = '77777777-7777-4777-8777-0000000003af';
const CREATED_STOP = '88888888-8888-4888-8888-0000000003af';
const OPENED = 'a'.repeat(32);
const RETURNED = 'b'.repeat(32);

const UNLOCATED = 'This address could not be located, so the stop has no ETA.';
const NO_ANCHOR =
  'Arrival saved, but there is no position for this truck, so there is no position to measure leaving from. ' +
  'This arrival will not clear by itself when the truck leaves.';

const truck = { truckNumber: 904, samsaraName: 'Truck #904' };
const NEW_LOAD = fleetRow({ ...truck, nextStop: null, openLoadCount: 0 });
const stop = (over: Partial<NextStop> = {}): Partial<NextStop> => ({
  loadId: LOAD,
  stopId: STOP,
  loadVersion: OPENED,
  loadNumber: 'VT-3AF-7',
  addressLine: '410 Harbor Rd',
  city: 'Duluth',
  state: 'MN',
  zip: '55802',
  ...over,
});
const EXISTING = fleetRow({ ...truck, nextStop: stop() });

/** What `GET /api/loads/:id` answers for a load as a row describes it. */
const readOf = (row: FleetRow, extra?: Parameters<typeof loadReadFor>[1]) => loadReadFor(row, extra)!;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let onClose: ReturnType<typeof vi.fn>;
let calls: { url: string; method: string; body: string }[];
/** One answer per `POST /api/stops`, in order; the last is reused. */
let saves: (() => Response)[];
/** `GET /api/loads/:id`, by id; each a queue like `saves`. */
let reads: Record<string, (() => Response)[]>;
let flip: () => Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const next = <T,>(queue: (() => T)[]) => (queue.length > 1 ? queue.shift()! : queue[0]!)();
const landed = (loadId: string, loadVersion: string, warnings: { field: string; message: string }[] = []) =>
  json(200, { saveId: '44444444-4444-4444-8444-0000000003af', loadId, loadVersion, stops: [], reassignment: null, warnings });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onClose = vi.fn();
  calls = [];
  saves = [() => landed(LOAD, RETURNED)];
  reads = {};
  flip = async () => json(200, { ok: true });
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    if (url === '/api/stops') return next(saves);
    if (url === '/api/trucks') return flip();
    if (url === '/api/assignments/preview') return json(200, PREVIEW);
    const id = url.match(/^\/api\/loads\/(.+)$/)?.[1];
    if (id) return reads[id] ? next(reads[id]) : json(404, { error: 'That load does not exist.' });
    return json(200, { ok: true });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const render = async (row: FleetRow, extra?: Parameters<typeof loadReadFor>[1], drivers: BoardDriver[] = []) => {
  primeLoadRead(client, row, extra);
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [row], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row, drivers, role: 'admin', dispatchTz: TZ, onClose, onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const DRIVER_A = '99999999-9999-4999-8999-00000000000a';
const DRIVER_B = '99999999-9999-4999-8999-00000000000b';
const boardDriver = (id: string, name: string, truckId: string | null): BoardDriver => ({
  id,
  name,
  active: true,
  source: 'app',
  samsaraDriverId: null,
  phone: null,
  truckId,
  truckLabel: truckId ? '904' : null,
});
/** What `POST /api/assignments/preview` answers: truck 904 from driver A to driver B. */
const PREVIEW = {
  gaining: {
    truckId: EXISTING.id,
    truckLabel: '904',
    driverId: DRIVER_A,
    driverName: 'Ana Example',
    driverSource: 'app',
    driverSamsaraId: null,
    nextApptUtc: null,
    nextApptTz: null,
    toDriverId: DRIVER_B,
    toDriverName: 'Bo Example',
  },
  losing: null,
  summary: 'Truck 904: Ana Example → Bo Example.',
  note: '',
  token: 'preview-token-3af',
};

const text = () => container!.textContent ?? '';
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const tabs = () => [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
const field = (label: string, scope: ParentNode = form()): HTMLInputElement => {
  const match = [...scope.querySelectorAll('label')].find((l) => (l.textContent ?? '').trim().startsWith(label));
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input as HTMLInputElement;
};
const button = (label: string) => {
  const found = [...container!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  if (!found) throw new Error(`No button ${label}`);
  return found as HTMLButtonElement;
};
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const esc = async () => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
};
const posted = () =>
  calls.filter((c) => c.url === '/api/stops').map((c) => JSON.parse(c.body) as Record<string, unknown> & { stops: Record<string, unknown>[] });
const readsOf = (id: string) => calls.filter((c) => c.url === `/api/loads/${id}`);

/** On the load as saved: §12.127's three promises and the warning. */
const expectOnSaved = (warning: string) => {
  expect(text()).toContain('Saved · one thing to know');
  expect(text()).toContain(warning);
  expect(text()).not.toContain('Unsaved changes');
  expect(button('Save').disabled).toBe(true);
};

/** A new load typed in: one stop, enough to save. */
const typeNewLoad = async () => {
  await type(field('Load number', container!), 'VT-3AF-1');
  await type(field('Street address'), '18 Quarry Ln');
  await type(field('City'), 'Mandan');
  await type(field('State'), 'ND');
};
const CREATED_READ = () =>
  readOf(
    fleetRow({
      ...truck,
      nextStop: {
        loadId: CREATED,
        stopId: CREATED_STOP,
        loadVersion: RETURNED,
        loadNumber: 'VT-3AF-1',
        loadStatus: 'AVAILABLE',
        addressLine: '18 Quarry Ln',
        city: 'Mandan',
        state: 'ND',
        zip: null,
      },
    }),
  );

describe('a new load, saved with a warning (§12.127)', () => {
  it('is on the load it created: the warning stays, nothing is unsaved, Save is off', async () => {
    saves = [() => landed(CREATED, RETURNED, [{ field: 'stops.0.addressLine', message: UNLOCATED }])];
    reads[CREATED] = [() => json(200, CREATED_READ())];
    await render(NEW_LOAD);
    await typeNewLoad();
    await click(button('Save'));

    expectOnSaved(UNLOCATED);
    expect(text()).toContain('Edit load — truck 904');
    expect(text()).not.toContain('New load — truck 904');
    expect(readsOf(CREATED)).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('edits that load on the next save — its id, its stop’s id, the version returned — and never creates another', async () => {
    saves = [() => landed(CREATED, RETURNED, [{ field: 'stops.0.addressLine', message: UNLOCATED }]), () => landed(CREATED, 'c'.repeat(32))];
    reads[CREATED] = [() => json(200, CREATED_READ())];
    await render(NEW_LOAD);
    await typeNewLoad();
    await click(button('Save'));
    await type(field('City'), 'Bismarck');
    expect(text()).toContain('Unsaved changes');
    expect(button('Save').disabled).toBe(false);
    await click(button('Save'));

    const [first, second] = posted();
    expect(posted()).toHaveLength(2);
    expect(first!.loadId).toBeNull();
    expect(second).toMatchObject({ loadId: CREATED, version: RETURNED });
    expect(second!.stops).toHaveLength(1);
    expect(second!.stops[0]).toMatchObject({ stopId: CREATED_STOP, city: 'Bismarck' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be saved again from its old form when the load cannot be read back — and Retry opens it', async () => {
    saves = [() => landed(CREATED, RETURNED, [{ field: 'stops.0.addressLine', message: UNLOCATED }])];
    reads[CREATED] = [() => json(500, { error: 'The read failed.' }), () => json(200, CREATED_READ())];
    await render(NEW_LOAD);
    await typeNewLoad();
    await click(button('Save'));

    expect(text()).toContain('The save landed, but the load could not be read again (The read failed)');
    expectOnSaved(UNLOCATED);
    // No fill either: a fill replaces the stops of a load that now exists.
    expect(container!.querySelector('[data-ratecon-strip]')).toBeNull();
    // The spent form takes no second save, typed into or not.
    await type(field('City'), 'Bismarck');
    expect(button('Save').disabled).toBe(true);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    });
    await settle();
    expect(posted()).toHaveLength(1);
    // It holds nothing to lose: Cancel closes without asking.
    await click(button('Cancel'));
    expect(text()).not.toContain('Discard changes?');
    expect(onClose).toHaveBeenCalledTimes(1);

    await click(button('Retry'));
    expect(readsOf(CREATED)).toHaveLength(2);
    expect(text()).not.toContain('could not be read again');
    expect(text()).toContain('Edit load — truck 904');
    expectOnSaved(UNLOCATED);
    expect(field('City').value).toBe('Mandan');
  });
});

describe('an existing load, saved with a warning (§12.127)', () => {
  const warned = () => landed(LOAD, RETURNED, [{ field: 'stops.0.arrivedAt', message: NO_ANCHOR }]);
  const savedRead = (over: Partial<NextStop> = {}, extra?: Parameters<typeof loadReadFor>[1]) =>
    readOf(fleetRow({ ...truck, nextStop: stop({ loadVersion: RETURNED, zip: '55803', ...over }) }), extra);

  it('takes a second edit and save against the version the first returned, not its own opened one', async () => {
    saves = [warned, () => landed(LOAD, 'c'.repeat(32))];
    reads[LOAD] = [() => json(200, savedRead())];
    await render(EXISTING);
    await type(field('ZIP'), '55803');
    await click(button('Save'));
    expectOnSaved(NO_ANCHOR);
    expect(field('ZIP').value).toBe('55803');

    await type(form().querySelector('textarea')!, 'Call the dock first');
    await click(button('Save'));
    const [first, second] = posted();
    expect(first).toMatchObject({ loadId: LOAD, version: OPENED });
    expect(second).toMatchObject({ loadId: LOAD, version: RETURNED });
    expect(second!.stops[0]).toMatchObject({ stopId: STOP, dispatcherNote: 'Call the dock first' });
    // Accepted: no warning this time, so the modal closes.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain('This load was changed since you opened it');
  });

  it('holds the version the save returned even when the read of it says another', async () => {
    // The two differ only if someone else changed the load between the save
    // and the read. The modal then sends the version IT saved, so that change
    // is refused as stale (§12.117) rather than saved over unseen.
    saves = [warned];
    reads[LOAD] = [() => json(200, savedRead({ loadVersion: 'd'.repeat(32) }))];
    await render(EXISTING);
    await type(field('ZIP'), '55803');
    await click(button('Save'));
    await type(field('ZIP'), '55804');
    await click(button('Save'));
    expect(posted()[1]).toMatchObject({ version: RETURNED });
  });

  it('closes on Cancel and on Esc, with no discard question about what it saved', async () => {
    saves = [warned];
    reads[LOAD] = [() => json(200, savedRead())];
    await render(EXISTING);
    await type(field('ZIP'), '55803');
    await click(button('Save'));

    await click(button('Cancel'));
    expect(text()).not.toContain('Discard changes?');
    expect(onClose).toHaveBeenCalledTimes(1);
    await esc();
    expect(text()).not.toContain('Discard changes?');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a spent form keeps Save off with an override in its draft, so its stale save is never sent', async () => {
    saves = [warned];
    reads[LOAD] = [() => json(500, { error: 'The read failed.' })];
    await render(EXISTING);
    await click(button('Force late'));
    const reason = form().querySelector('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(reason, 'DRIVER_REPORTED_DELAY');
      reason.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    await click(button('Save'));

    expect(posted()[0]!.stops[0]).toMatchObject({ override: { action: 'set', forcedStatus: 'LATE' } });
    expect(text()).toContain('could not be read again');
    expect(button('Save').disabled).toBe(true);
  });

  it('a reassign confirmed and warned: the confirm closes with its save, and nothing is sent again', async () => {
    saves = [warned];
    reads[LOAD] = [() => json(500, { error: 'The read failed.' })];
    await render(EXISTING, undefined, [boardDriver(DRIVER_A, 'Ana Example', EXISTING.id), boardDriver(DRIVER_B, 'Bo Example', null)]);
    const picker = field('Assigned driver', container!);
    await act(async () => picker.click());
    await type(picker, 'Bo');
    const option = [...container!.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
      (o.textContent ?? '').includes('Bo Example'),
    )!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      option.click();
    });
    await settle();
    await click(button('Confirm reassign & save'));
    await click(button('Assign driver'));

    expect(posted()).toHaveLength(1);
    expect(posted()[0]).toMatchObject({ driverId: DRIVER_B, previewToken: 'preview-token-3af' });
    expect(text()).toContain('could not be read again');
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Assign driver')).toBe(false);
    // Spent: no reassign is pending in it any more, and Save stays off.
    expect(text()).not.toContain('Reassigns truck 904');
    expect(button('Save').disabled).toBe(true);
  });

  it('keeps the stop that was selected', async () => {
    const extra = { after: [{ type: 'DEL' as const, city: 'Superior', state: 'WI', zip: '54880' }] };
    saves = [() => landed(LOAD, RETURNED, [{ field: 'stops.0.addressLine', message: UNLOCATED }])];
    reads[LOAD] = [() => json(200, savedRead({}, { after: [{ ...extra.after[0]!, zip: '54881' }] }))];
    await render(EXISTING, extra);
    await click(tabs()[1]!);
    await type(field('ZIP'), '54881');
    await click(button('Save'));

    expectOnSaved('Stop 2 (Superior, WI): ');
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(field('ZIP').value).toBe('54881');
  });
});

describe('the stop saved, the active flag did not (§12.14, §12.127)', () => {
  const untickActive = async () => {
    const box = container!.querySelector<HTMLInputElement>('input[aria-label="Active — on the console"]')!;
    await act(async () => box.click());
    await settle();
  };
  const savedRead = () => readOf(fleetRow({ ...truck, nextStop: stop({ loadVersion: RETURNED }) }));

  it('refused: on the saved load, nothing unsaved, Cancel closes, the next save carries the version returned', async () => {
    saves = [() => landed(LOAD, RETURNED), () => landed(LOAD, 'c'.repeat(32))];
    reads[LOAD] = [() => json(200, savedRead())];
    flip = async () => json(403, { error: 'Only an admin may change this.' });
    await render(EXISTING);
    await untickActive();
    expect(text()).toContain('Unsaved changes — active flag');
    await click(button('Save'));

    expectOnSaved('The stop saved. The active flag did not: Only an admin may change this.');
    expect(container!.querySelector<HTMLInputElement>('input[aria-label="Active — on the console"]')!.checked).toBe(true);
    await click(button('Cancel'));
    expect(text()).not.toContain('Discard changes?');
    expect(onClose).toHaveBeenCalledTimes(1);

    await type(field('ZIP'), '55804');
    await click(button('Save'));
    expect(posted()[1]).toMatchObject({ loadId: LOAD, version: RETURNED });
  });

  it('unanswered: the same, never "Save failed" over a save that landed', async () => {
    saves = [() => landed(LOAD, RETURNED)];
    reads[LOAD] = [() => json(200, savedRead())];
    flip = async () => {
      throw new TypeError('Failed to fetch');
    };
    await render(EXISTING);
    await untickActive();
    await click(button('Save'));

    expectOnSaved('The stop saved. The active flag did not: Failed to fetch');
    expect(text()).not.toContain('Save failed');
    expect(readsOf(LOAD)).toHaveLength(1);
  });

  it('a warning and a refused flag are both shown', async () => {
    saves = [() => landed(LOAD, RETURNED, [{ field: 'stops.0.arrivedAt', message: NO_ANCHOR }])];
    reads[LOAD] = [() => json(200, savedRead())];
    flip = async () => json(403, { error: 'Only an admin may change this.' });
    await render(EXISTING);
    await untickActive();
    await click(button('Save'));

    expectOnSaved(NO_ANCHOR);
    expect(text()).toContain('The stop saved. The active flag did not: Only an admin may change this.');
  });
});

describe('a save with nothing to say still closes (§12.127)', () => {
  it('reads nothing again and closes', async () => {
    saves = [() => landed(LOAD, RETURNED)];
    await render(EXISTING);
    await type(field('ZIP'), '55803');
    await click(button('Save'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readsOf(LOAD)).toHaveLength(0);
  });
});

describe('Clear now (§9.5, §12.117, §12.127)', () => {
  const FORCED = () =>
    fleetRow({
      ...truck,
      nextStop: stop(),
      override: {
        forcedStatus: 'LATE',
        reason: 'DRIVER_REPORTED_DELAY',
        reasonNote: null,
        setByName: 'Dee',
        setAtUtc: new Date(NOW.getTime() - 3_600_000).toISOString(),
        expiresAtUtc: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(),
      },
    });
  /** `DELETE /api/overrides` answered by `answer`; every other request as before. */
  const clearAnswers = (answer: () => Promise<Response>) => {
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) =>
      url === '/api/overrides' ? answer() : base(url, init),
    ) as unknown as typeof fetch;
  };
  const pressed = (label: string) => button(label).getAttribute('aria-pressed') === 'true';

  /** The override is still live and the form still says so: nothing to save, nothing cleared by a save. */
  const expectStillForced = async () => {
    expect(pressed('Force late')).toBe(true);
    expect(pressed('Auto')).toBe(false);
    expect(button('Save').disabled).toBe(true);
    await type(field('ZIP'), '55803');
    await click(button('Save'));
    expect(posted()[0]).toMatchObject({ version: OPENED });
    expect(posted()[0]!.stops[0]).not.toHaveProperty('override');
  };

  it('that lands ends the override in the form, leaves nothing to save, and is not sent again', async () => {
    clearAnswers(async () => json(200, { cleared: true, loadVersion: RETURNED }));
    await render(FORCED());
    await click(button('Clear now'));
    expect(pressed('Auto')).toBe(true);
    expect(text()).not.toContain('Nothing was cleared');
    expect(button('Save').disabled).toBe(true);

    await type(field('ZIP'), '55803');
    await click(button('Save'));
    expect(posted()[0]).toMatchObject({ version: RETURNED });
    expect(posted()[0]!.stops[0]).not.toHaveProperty('override');
  });

  it('that is refused leaves the draft as it was, and says nothing was cleared and why', async () => {
    clearAnswers(async () => json(500, { error: 'The override failed.', reference: 'OVR-500-3AG' }));
    await render(FORCED());
    await click(button('Clear now'));
    expect(text()).toContain('Nothing was cleared. The override failed. (OVR-500-3AG)');
    await expectStillForced();
  });

  it('that is refused with no readable answer says so with the status', async () => {
    clearAnswers(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await render(FORCED());
    await click(button('Clear now'));
    expect(text()).toContain('Nothing was cleared. The server answered 502.');
    await expectStillForced();
  });

  it('that never answers leaves the draft as it was, says why, and rejects nothing unhandled', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      clearAnswers(async () => {
        throw new TypeError('Failed to fetch');
      });
      await render(FORCED());
      await click(button('Clear now'));
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(text()).toContain('Nothing was cleared. The request failed: Failed to fetch.');
      await expectStillForced();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
