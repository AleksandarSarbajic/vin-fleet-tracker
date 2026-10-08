// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { ADD_STOP_FULL, APPOINTMENT_TIME_MISSING, REMOVE_LAST_STOP } from './load-form';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { loadReadFor, primeLoadRead } from '@/test/load-read';
import { timeInZone } from '@/lib/format';
import type { FleetRow } from '@/server/fleet-query';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.119, stage 4b. Add stop and Remove stop in the modal: what each does
 * to the list and the form, why each is off when it is, what the save sends,
 * and that Cancel leaves the load as it was.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const DELIVERY = '22222222-2222-4222-8222-222222222222';
const PICKUP = '66666666-6666-4666-8666-000000000001';
const SECOND_DROP = '66666666-6666-4666-8666-000000000101';

/** A pickup the truck has left; the delivery in Joliet is next on the board; then Moorhead. */
const ROW = fleetRow({
  nextStop: nextStop({
    type: 'DEL',
    city: 'Joliet',
    state: 'IL',
    apptStartUtc: ahead(20),
    apptEndUtc: ahead(20.5),
    apptTz: TZ,
    apptType: 'APPT',
  }),
});
const ARRIVED_PICKUP = {
  type: 'PU' as const,
  city: 'Melrose Park',
  state: 'IL',
  apptStartUtc: ago(2),
  apptEndUtc: ago(1.5),
  apptTz: TZ,
  arrivedAt: ago(1),
  arrivedSource: 'detected' as const,
  departedAt: ago(0.5),
  departedSource: 'detected' as const,
};
const MOORHEAD = { type: 'DEL' as const, city: 'Moorhead', state: 'MN', apptStartUtc: ahead(30), apptEndUtc: ahead(30.5), apptTz: TZ };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const mount = async (row: FleetRow, onClose = vi.fn()) => {
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [row],
    fetchedAt: NOW.toISOString(),
  } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row,
          drivers: [],
          role: 'admin',
          dispatchTz: TZ,
          onClose,
          onReload: vi.fn(),
        }),
      ),
    );
  });
  await settle();
};

const render = async (
  extra: Parameters<typeof loadReadFor>[1] = { before: [ARRIVED_PICKUP], after: [MOORHEAD] },
  row: FleetRow = ROW,
) => {
  primeLoadRead(client, row, extra);
  await mount(row);
};

const rows = () => [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const field = (label: string, scope: ParentNode = form()): HTMLInputElement => {
  const match = [...scope.querySelectorAll('label')].find((l) =>
    (l.textContent ?? '').trim().startsWith(label),
  );
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input as HTMLInputElement;
};
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const button = (label: string, scope: ParentNode = document) => {
  const found = [...scope.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
};
const addStop = () => container!.querySelector<HTMLButtonElement>('[data-add-stop]')!;
const removeStop = () => form().querySelector<HTMLButtonElement>('[data-remove-stop]')!;
const posted = () =>
  (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([url, init]) => url === '/api/stops' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init!.body)) as {
      loadId: string | null;
      stops: { stopId: string | null; stopType: string; city: string | null; appointment: unknown }[];
      removedStopIds?: string[];
    });
const banner = () =>
  [...container!.querySelectorAll('p')].find((p) => (p.textContent ?? '').startsWith('Unsaved changes'))
    ?.textContent;

describe('Add stop (§12.119)', () => {
  it('appends the other type, ticked on the last stop’s date with no time, selects it and puts the cursor in its street address', async () => {
    await render();
    await click(addStop());

    expect(rows()).toHaveLength(4);
    expect(rows()[3]!.getAttribute('aria-selected')).toBe('true');
    expect(rows()[3]!.textContent).toContain('New stop');
    expect(form().textContent).toContain('Stop 4');
    expect(button('Pick up', form()).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(field('Street address'));
    expect(container!.querySelector('[data-stop-count]')?.textContent).toBe('4 stops');

    // Moorhead's date, Chicago's zone, no time: an error until there is one.
    const box = form().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    const moorheadDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(MOORHEAD.apptStartUtc));
    expect(field('Date').value).toBe(moorheadDay);
    expect(field('Time at the stop').value).toBe('');
    expect(form().textContent).toContain(APPOINTMENT_TIME_MISSING);
    expect(button('Save').disabled).toBe(true);
    expect(banner()).toBe('Unsaved changes — stop 4: new.');

    // North Dakota has two zones: the ZIP settles it (§12.120).
    await type(field('ZIP'), '58102');
    await type(field('City'), 'Fargo');
    await type(field('State'), 'ND');
    await type(field('Time at the stop'), '09:00');
    expect(button('Save').disabled).toBe(false);
    await click(button('Save'));

    const [body] = posted();
    expect(body!.stops.map((s) => [s.stopId, s.stopType, s.city])).toEqual([[null, 'PU', 'Fargo']]);
    expect(body!.removedStopIds).toBeUndefined();
  });

  it('is off at ten stops, and says why', async () => {
    await render({
      before: [ARRIVED_PICKUP],
      after: Array.from({ length: 7 }, (_, i) => ({ ...MOORHEAD, city: `Drop ${i + 2}` })),
    });
    expect(rows()).toHaveLength(9);
    expect(addStop().disabled).toBe(false);
    await click(addStop());
    expect(rows()).toHaveLength(10);
    expect(addStop().disabled).toBe(true);
    expect(addStop().title).toBe(ADD_STOP_FULL);
    expect(container!.textContent).toContain('A load holds at most 10 stops.');
  });
});

describe('Remove stop (§12.119)', () => {
  it('is off for a stop the truck reached, with the arrival in the stop’s own clock', async () => {
    await render();
    await click(rows()[0]!);
    expect(removeStop().disabled).toBe(true);
    const said = `Can't remove: the truck arrived here at ${timeInZone(new Date(ARRIVED_PICKUP.arrivedAt), TZ)}.`;
    expect(removeStop().title).toBe(said);
    // Said in words under the header, and read with the button.
    const why = form().querySelector<HTMLElement>('[data-remove-why]')!;
    expect(why.textContent).toBe(said);
    expect(why.classList.contains('sr-only')).toBe(false);
    expect(removeStop().getAttribute('aria-describedby')).toBe(why.id);

    await click(rows()[2]!);
    expect(removeStop().disabled).toBe(false);
    expect(removeStop().getAttribute('aria-describedby')).toBeNull();
    expect(form().querySelector('[data-remove-why]')).toBeNull();
  });

  it('is off on a load’s only stop', async () => {
    await render({});
    expect(rows()).toHaveLength(1);
    expect(removeStop().disabled).toBe(true);
    expect(removeStop().title).toBe(REMOVE_LAST_STOP);
    // A tooltip, and read with the button — not written on the form.
    expect(form().querySelector('[data-remove-why]')).toBeNull();
    const described = document.getElementById(removeStop().getAttribute('aria-describedby')!)!;
    expect(described.textContent).toBe(REMOVE_LAST_STOP);
    expect(described.classList.contains('sr-only')).toBe(true);
  });

  it('takes an unsaved stop away at once, and the form is clean again', async () => {
    await render();
    await click(addStop());
    expect(banner()).toBe('Unsaved changes — stop 4: new.');
    await click(removeStop());
    expect(rows()).toHaveLength(3);
    expect(banner()).toBeUndefined();
    expect(button('Save').disabled).toBe(true);
    // The stop above takes the selection.
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true');
  });

  it('names a saved stop in the banner, renumbers the list, and sends it as removed', async () => {
    await render();
    await click(rows()[1]!);
    await click(removeStop());
    expect(rows().map((r) => r.getAttribute('data-stop-row'))).toEqual(['1', '2']);
    expect(rows()[1]!.textContent).toContain('Moorhead, MN');
    expect(form().textContent).toContain('Stop 2');
    expect(banner()).toBe('Unsaved changes — stop 2 (Joliet, IL) removed.');
    expect(container!.querySelector('[data-stop-count]')?.textContent).toBe('2 stops');

    await click(button('Save'));
    const [body] = posted();
    expect(body!.removedStopIds).toEqual([DELIVERY]);
    // Nothing else changed: the stop sent is one still on the load, never the removed one.
    expect(body!.stops.map((s) => s.stopId)).not.toContain(DELIVERY);
    expect(body!.stops).toHaveLength(1);
  });

  it('comes back on Cancel: nothing is sent, and the load opens again with it', async () => {
    const onClose = vi.fn();
    primeLoadRead(client, ROW, { before: [ARRIVED_PICKUP], after: [MOORHEAD] });
    await mount(ROW, onClose);
    await click(rows()[2]!);
    await click(removeStop());
    expect(rows()).toHaveLength(2);

    await click(button('Cancel'));
    expect(container!.textContent).toContain('Discard changes?');
    expect(container!.textContent).toContain('stop 3 (Moorhead, MN) removed would be lost.');
    await click(button('Discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(posted()).toEqual([]);

    // Opened again, on the same read: all three stops.
    act(() => root!.unmount());
    root = createRoot(container!);
    await mount(ROW);
    expect(rows().map((r) => r.textContent ?? '')).toEqual([
      expect.stringContaining('Melrose Park'),
      expect.stringContaining('Joliet'),
      expect.stringContaining('Moorhead'),
    ]);
    expect(banner()).toBeUndefined();
  });
});

describe('the delivery-before-pickup note (§12.119)', () => {
  it('shows under a delivery dated before the pickup above it, and never blocks Save', async () => {
    await render({});
    await click(button('Pick up', form()));
    await click(addStop());
    // The pickup is 20 h ahead; a 00:01 delivery on the same day comes first.
    await type(field('Time at the stop'), '00:01');
    const note = form().querySelector('[data-order-note]');
    expect(note?.textContent).toMatch(/^This delivery is before the pickup above it \(stop 1, /);
    expect(button('Save').disabled).toBe(false);
    await click(button('Save'));
    expect(posted()).toHaveLength(1);
  });
});

describe('a new load of several stops (§12.119)', () => {
  const EMPTY = fleetRow({ nextStop: null, openLoadCount: 0 });

  it('saves a pickup and a delivery in one request, as a new load', async () => {
    await mount(EMPTY);
    expect(container!.querySelector('h2')?.textContent).toBe('New load — truck 137');
    await click(button('Pick up', form()));
    await type(field('City'), 'Melrose Park');
    await type(field('State'), 'IL');
    await click(addStop());
    expect(button('Deliver', form()).getAttribute('aria-pressed')).toBe('true');
    // Stop 1 had no appointment: the date is empty too, and both are asked for.
    await click(form().querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await type(field('City'), 'Joliet');
    await type(field('State'), 'IL');
    expect(banner()).toBe('Unsaved changes — stop 1: stop type, city, state, stop 2: new.');

    await click(button('Save'));
    const [body] = posted();
    expect(body!.loadId).toBeNull();
    expect(body!.stops.map((s) => [s.stopId, s.stopType, s.city])).toEqual([
      [null, 'PU', 'Melrose Park'],
      [null, 'DEL', 'Joliet'],
    ]);
    expect(body!.removedStopIds).toBeUndefined();
  });

  it('sends its first stop even when only a second one was typed', async () => {
    await mount(EMPTY);
    await click(addStop());
    await click(form().querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await type(field('City'), 'Joliet');
    await click(button('Save'));
    expect(posted()[0]!.stops).toHaveLength(2);
  });
});

it('keeps the second stop id used by these fixtures', () => {
  // The fixture's numbering, written down so a change to it fails here first.
  expect(loadReadFor(ROW, { before: [ARRIVED_PICKUP], after: [MOORHEAD] })!.stops.map((s) => s.stopId)).toEqual([
    PICKUP,
    DELIVERY,
    SECOND_DROP,
  ]);
});
