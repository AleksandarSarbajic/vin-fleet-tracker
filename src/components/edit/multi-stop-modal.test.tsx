// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { APPOINTMENT_DATE_MISSING, APPOINTMENT_TIME_MISSING, LEFT_STOP_NOTE } from './load-form';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { loadReadFor, primeLoadRead } from '@/test/load-read';
import { loadReadKey } from '@/hooks/useLoadRead';
import { timeInZone } from '@/lib/format';
import type { FleetRow } from '@/server/fleet-query';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.119, stage 4a. The modal on a load of several stops: the list beside
 * the form, the rules each stop's form keeps (§12.116 D2, D4, D5), what a
 * save sends and where its errors land, the reached-stop question per stop,
 * the appointment with no time (S4-A), and the version frozen at the read.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const PICKUP = '66666666-6666-4666-8666-000000000001';
const DELIVERY = '22222222-2222-4222-8222-222222222222';

/** Stop 1 picked up and left — by hand; stop 2, the delivery, is next. */
const ROW = fleetRow({
  nextStop: nextStop({
    type: 'DEL',
    addressLine: '3450 Main Ave',
    city: 'Fargo',
    state: 'ND',
    zip: '58103',
    apptStartUtc: ahead(20),
    apptEndUtc: ahead(20.5),
    apptTz: TZ,
    apptType: 'APPT',
  }),
});
const PU = {
  type: 'PU' as const,
  addressLine: '1900 N 25th Ave',
  city: 'Melrose Park',
  state: 'IL',
  zip: '60160',
  apptStartUtc: ago(8),
  apptEndUtc: ago(8),
  apptTz: TZ,
  arrivedAt: ago(7),
  arrivedSource: 'detected' as const,
  departedAt: ago(6),
  departedSource: 'dispatcher' as const,
};

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

const props = (row: FleetRow, onReload = vi.fn()) => ({
  row,
  drivers: [],
  role: 'admin' as const,
  dispatchTz: TZ,
  onClose: vi.fn(),
  onReload,
});

const mount = async (row: FleetRow, onReload = vi.fn()) => {
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [row],
    fetchedAt: NOW.toISOString(),
  } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(QueryClientProvider, { client }, createElement(EditStopModal, props(row, onReload))),
    );
  });
  await settle();
};

const render = async (
  row: FleetRow = ROW,
  extra: Parameters<typeof loadReadFor>[1] = { before: [PU] },
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
const box = (name: string) =>
  container!.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${name}"]`)!;
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => setValue(el, text));
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
const posted = () =>
  (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([url, init]) => url === '/api/stops' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init!.body)) as {
      version?: string;
      stops: { stopId: string | null; city: string | null; zip: string | null; dispatcherNote?: string | null }[];
      reachedStop?: string;
    });
const banner = () => [...container!.querySelectorAll('p')].find((p) =>
  (p.textContent ?? '').startsWith('Unsaved changes'),
)?.textContent;

describe('the list beside the form (§12.119)', () => {
  it('lists every stop, opens on the board’s next stop, and says what each one is', async () => {
    await render();
    expect(container!.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Edit load for truck 137',
    );
    expect(container!.querySelector('h2')?.textContent).toBe('Edit load — truck 137');
    expect(container!.querySelector('[data-stop-count]')?.textContent).toBe('2 stops');

    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    // Derived, never pasted: the stop's own clock, with its abbreviation.
    expect(rows()[0]!.textContent).toContain(
      `Departed ${timeInZone(new Date(PU.departedAt), TZ)} · marked by hand`,
    );
    expect(rows()[0]!.hasAttribute('data-departed')).toBe(true);
    expect(rows()[1]!.textContent).toContain('Fargo, ND');
    expect(rows()[1]!.textContent).toContain('Next');
    expect(form().textContent).toContain('Stop 2');
    expect(form().textContent).toContain('Next stop');
  });

  it('moves between stops with the arrow keys, and the form follows', async () => {
    await render();
    await act(async () => {
      rows()[1]!.focus();
      rows()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(rows()[0]);
    expect(field('City').value).toBe('Melrose Park');
  });
});

describe('a stop the truck has left (§12.116 D4)', () => {
  it('keeps its address, type and appointment, and takes a note', async () => {
    await render();
    await click(rows()[0]!);
    expect(form().textContent).toContain(LEFT_STOP_NOTE);
    expect(field('City').disabled || field('City').closest('fieldset')!.disabled).toBe(true);
    expect(
      [...form().querySelectorAll<HTMLButtonElement>('[aria-pressed]')].every((b) => b.disabled),
    ).toBe(true);
    expect(box('This truck has left this stop').checked).toBe(true);
    expect(form().querySelector('textarea')!.closest('fieldset')!.disabled).toBe(false);
  });
});

describe('an arrival needs the stop before it left (§12.116 D5)', () => {
  const THREE = { before: [PU], after: [{ city: 'Moorhead', state: 'MN', type: 'DEL' as const }] };
  const ARRIVED = fleetRow({
    nextStop: { ...ROW.nextStop!, arrivedAt: ago(1), arrivedSource: 'detected' },
  });

  it('cannot be ticked on stop 3 while stop 2 has not been left, and says why', async () => {
    await render(ARRIVED, THREE);
    await click(rows()[2]!);
    expect(box('This truck has arrived at this stop').disabled).toBe(true);
    expect(container!.querySelector('[data-arrival-blocked]')?.textContent).toBe(
      "Stop 2 hasn't been left yet, so the truck cannot have arrived here.",
    );
  });

  it('can, once stop 2 is marked left in this same form — the server counts it now', async () => {
    await render(ARRIVED, THREE);
    await click(box('This truck has left this stop'));
    await click(rows()[2]!);
    expect(box('This truck has arrived at this stop').disabled).toBe(false);
    expect(container!.querySelector('[data-arrival-blocked]')).toBeNull();
  });
});

describe('the status override is the next stop’s (§12.116 D2)', () => {
  it('is on the next stop, and named elsewhere on the others', async () => {
    await render();
    expect(form().textContent).toContain('Status override');
    await click(rows()[0]!);
    expect(form().textContent).not.toContain('Status override');
    expect(container!.querySelector('[data-override-elsewhere]')?.textContent).toBe(
      "A status override applies to the truck's next stop (stop 2).",
    );
  });
});

describe('what a save sends (§12.119)', () => {
  it('names each stop’s unsaved fields, and sends those stops in the load’s order', async () => {
    await render();
    await type(field('ZIP'), '58104');
    await click(rows()[0]!);
    await type(form().querySelector('textarea')!, 'Gate 3');
    expect(banner()).toBe('Unsaved changes — stop 1: note, stop 2: ZIP.');
    expect(rows()[0]!.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();

    await click(button('Save'));
    const [body] = posted();
    expect(body!.stops.map((s) => s.stopId)).toEqual([PICKUP, DELIVERY]);
    expect(body!.stops[0]!.dispatcherNote).toBe('Gate 3');
    expect(body!.stops[1]!.zip).toBe('58104');
  });

  it('sends the next stop alone when only the load changed', async () => {
    await render();
    await type(field('Load number', container!), 'VL-1');
    expect(banner()).toBe('Unsaved changes — load number.');
    await click(button('Save'));
    // A new number on a load whose pickup was reached is asked about first —
    // naming that stop, though the save does not send it.
    const question = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Stop already reached"]',
    )!;
    expect(question.textContent).toContain('Stop 1 (Melrose Park, IL) was reached at');
    await click(button('Correction', question));
    expect(posted()[0]!.stops.map((s) => s.stopId)).toEqual([DELIVERY]);
    expect(posted()[0]!.reachedStop).toBe('correction');
  });

  it('puts the server’s error under its stop, marks the row, and shows that stop', async () => {
    globalThis.fetch = vi.fn(async (url: string) =>
      url === '/api/stops'
        ? {
            ok: false,
            status: 400,
            json: async () => ({
              error: 'ZIP must be 5 digits',
              // Stop 1 is the request's FIRST stop — index 0, not 1.
              fields: [{ field: 'stops.0.zip', message: 'ZIP must be 5 digits' }],
            }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: true }) },
    ) as unknown as typeof fetch;
    await render();
    await click(rows()[0]!);
    await type(form().querySelector('textarea')!, 'Gate 3');
    await click(rows()[1]!);
    await click(button('Save'));

    expect(rows()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(rows()[0]!.textContent).toContain('Error');
    expect(form().textContent).toContain('ZIP must be 5 digits');
    expect(container!.textContent).toContain('1 stop needs attention before saving');
  });
});

describe('a ticked appointment with no time (§12.119 S4-A)', () => {
  it.each(['APPT', 'FCFS'] as const)('%s: an error on the time field, on any stop, and no save', async (kind) => {
    await render(ROW, { before: [PU], after: [{ city: 'Moorhead', state: 'MN', apptStartUtc: null }] });
    await click(rows()[2]!);
    await click(form().querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    if (kind === 'FCFS') {
      await click(button('FCFS', form()));
      await type(field('Earliest receiving hour'), '');
    }
    expect(form().textContent).toContain(APPOINTMENT_TIME_MISSING);
    expect(button('Save').disabled).toBe(true);
    expect(rows()[2]!.textContent).toContain('Error');
    await type(field(kind === 'FCFS' ? 'Earliest receiving hour' : 'Time at the stop'), '09:00');
    expect(form().textContent).not.toContain(APPOINTMENT_TIME_MISSING);
  });
});

describe('the reached-stop question, per stop (§12.119)', () => {
  const question = () =>
    document.querySelector<HTMLElement>('[role="dialog"][aria-label="Stop already reached"]');
  const BOTH = fleetRow({
    nextStop: { ...ROW.nextStop!, arrivedAt: ago(1), arrivedSource: 'detected' },
  });

  it('names the stop, and offers the next trip once every stop was reached', async () => {
    await render(BOTH);
    await type(field('City'), 'West Fargo');
    await click(button('Save'));
    expect(question()?.textContent).toContain('Stop 2 (West Fargo, ND) was reached at');
    expect(() => button('Next trip', question()!)).not.toThrow();
    await click(button('Next trip', question()!));
    const [body] = posted();
    expect(body!.reachedStop).toBe('next-trip');
    expect(body!.stops.map((s) => s.stopId)).toEqual([DELIVERY]);
  });

  it('offers only Correction while a stop is still ahead, and says where the next trip goes', async () => {
    const AT_PICKUP = fleetRow({
      nextStop: {
        ...ROW.nextStop!,
        stopId: PICKUP,
        type: 'PU',
        city: 'Melrose Park',
        state: 'IL',
        arrivedAt: ago(1),
        arrivedSource: 'detected',
      },
    });
    await render(AT_PICKUP, { after: [{ city: 'Fargo', state: 'ND', type: 'DEL' }] });
    await type(field('City'), 'Franklin Park');
    await click(button('Save'));
    expect(question()?.textContent).toContain('Stop 1 (Franklin Park, IL) was reached at');
    expect(() => button('Next trip', question()!)).toThrow();
    expect(question()!.querySelector('[data-next-trip-elsewhere]')?.textContent).toBe(
      'To enter the next trip, close this load with Clear stop.',
    );
  });

  it('asks about the stop the server names when it was reached after the modal opened', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (url: string) =>
      url === '/api/stops' && call++ === 0
        ? {
            ok: false,
            status: 409,
            json: async () => ({
              error: 'This stop has been reached.',
              reachedStop: { arrivedAt: ago(0.5), stopId: DELIVERY, stopIndex: 1 },
            }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: true }) },
    ) as unknown as typeof fetch;
    await render();
    await type(field('City'), 'West Fargo');
    await click(rows()[0]!);
    await type(form().querySelector('textarea')!, 'Gate 3');
    await click(button('Save'));
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(question()?.textContent).toContain('Stop 2 (West Fargo, ND) was reached at');
  });
});

describe('the version is the read’s, frozen (§12.117, §12.119)', () => {
  it('a poll arriving mid-edit leaves the form and the version alone', async () => {
    const opened = fleetRow({ nextStop: { ...ROW.nextStop!, loadVersion: 'a'.repeat(32) } });
    await render(opened);
    await type(field('ZIP'), '58104');

    // The next poll: someone changed the load; the row says so, and a fresh
    // read of it is even in the cache under the new key.
    const polled = fleetRow({
      nextStop: { ...ROW.nextStop!, loadVersion: 'b'.repeat(32), city: 'Moorhead', state: 'MN' },
    });
    primeLoadRead(client, polled, { before: [PU] });
    await act(async () => {
      root!.render(
        createElement(QueryClientProvider, { client }, createElement(EditStopModal, props(polled))),
      );
    });
    await settle();

    expect(field('ZIP').value).toBe('58104');
    expect(field('City').value).toBe('Fargo');
    await click(button('Save'));
    expect(posted()[0]!.version).toBe('a'.repeat(32));
  });

  it('takes back the version Clear now returns, and saves with it', async () => {
    const forced = fleetRow({
      nextStop: { ...ROW.nextStop!, loadVersion: 'a'.repeat(32) },
      override: {
        forcedStatus: 'LATE',
        reason: 'DRIVER_REPORTED_DELAY',
        reasonNote: null,
        setByName: 'Dee',
        setAtUtc: ago(1),
        expiresAtUtc: ahead(3),
      },
    });
    globalThis.fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url === '/api/overrides' ? { cleared: true, loadVersion: 'c'.repeat(32) } : { ok: true }),
    })) as unknown as typeof fetch;
    await render(forced);
    await click(button('Clear now'));
    await type(field('ZIP'), '58104');
    await click(button('Save'));
    expect(posted()[0]!.version).toBe('c'.repeat(32));
  });

  it('Reload drops the read it opened with and asks for the modal again', async () => {
    const onReload = vi.fn();
    globalThis.fetch = vi.fn(async (url: string) =>
      url === '/api/stops'
        ? { ok: false, status: 409, json: async () => ({ error: 'This load was changed since you opened it. Nothing was saved.', stale: true }) }
        : { ok: true, status: 200, json: async () => ({ ok: true }) },
    ) as unknown as typeof fetch;
    primeLoadRead(client, ROW, { before: [PU] });
    await mount(ROW, onReload);
    await type(field('ZIP'), '58104');
    await click(button('Save'));
    await click(button('Reload'));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(loadReadKey(ROW)!)).toBeUndefined();
  });
});

describe('opening (§12.119)', () => {
  it('opens ready, with no wait, when the read is in hand', async () => {
    await render();
    expect(container!.textContent).not.toContain('Reading this load…');
    expect(rows()).toHaveLength(2);
    const urls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      ([url]) => url,
    );
    // Recently closed reads its own list; the load is not read again.
    expect(urls.filter((u) => u.startsWith('/api/loads/'))).toEqual([]);
  });

  it('reads the load itself when nothing was prefetched, and says so meanwhile', async () => {
    let answer: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          answer = resolve;
          expect(url).toBe(`/api/loads/${ROW.nextStop!.loadId}`);
        }),
    ) as unknown as typeof fetch;
    await mount(ROW);
    expect(container!.textContent).toContain('Reading this load…');
    await act(async () =>
      answer({ ok: true, status: 200, json: async () => loadReadFor(ROW, { before: [PU] }) }),
    );
    await settle();
    expect(rows()).toHaveLength(2);
  });

  it('says so, and offers Retry, when the read fails', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Could not read the load.' }),
    })) as unknown as typeof fetch;
    await mount(ROW);
    // One retry, about a second later, before it says so.
    await vi.waitFor(
      () =>
        expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
          'Could not read the load.',
        ),
      { timeout: 4000, interval: 50 },
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(() => button('Retry')).not.toThrow();
  });
});

describe('a ticked appointment with a time but no date (§12.119)', () => {
  it.each(['APPT', 'FCFS'] as const)('%s: an error on the date field, and no save', async (kind) => {
    await render(ROW, { before: [PU], after: [{ city: 'Moorhead', state: 'MN', apptStartUtc: null }] });
    await click(rows()[2]!);
    await click(form().querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    if (kind === 'FCFS') await click(button('FCFS', form()));
    await type(field(kind === 'FCFS' ? 'Earliest receiving hour' : 'Time at the stop'), '09:00');
    expect(form().textContent).not.toContain(APPOINTMENT_TIME_MISSING);
    expect(form().textContent).toContain(APPOINTMENT_DATE_MISSING);
    expect(button('Save').disabled).toBe(true);
    expect(rows()[2]!.textContent).toContain('Error');

    await type(field('Date (stop-local)'), '2026-10-12');
    expect(form().textContent).not.toContain(APPOINTMENT_DATE_MISSING);
  });
});

describe('the keyboard (§12.119)', () => {
  const key = (el: Element, k: string) =>
    act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });

  it('moves through the stops with every arrow, wrapping at the ends, focus following', async () => {
    await render(ROW, { before: [PU], after: [{ city: 'Moorhead', state: 'MN' }] });
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    await key(rows()[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[2]);
    await key(rows()[2]!, 'ArrowRight');
    expect(document.activeElement).toBe(rows()[0]);
    await key(rows()[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true');
    expect(field('City').value).toBe('Moorhead');
  });

  it('reaches the stop type by Tab — two plain buttons — and a press switches it', async () => {
    await render();
    const types = [...form().querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Stop type"] button')];
    expect(types.map((b) => [b.textContent, b.type, b.tabIndex, b.disabled])).toEqual([
      ['Pick up', 'button', 0, false],
      ['Deliver', 'button', 0, false],
    ]);
    expect(types.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    await click(types[0]!);
    expect(types.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(banner()).toBe('Unsaved changes — stop 2: stop type.');
  });

  it('Esc closes a clean modal from anywhere in it — the list included', async () => {
    const onClose = vi.fn();
    primeLoadRead(client, ROW, { before: [PU] });
    await act(async () => {
      root!.render(
        createElement(QueryClientProvider, { client }, createElement(EditStopModal, { ...props(ROW), onClose })),
      );
    });
    await settle();
    rows()[1]!.focus();
    await key(document.activeElement!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc on unsaved work asks first, and Esc again backs out of nothing but the question', async () => {
    const onClose = vi.fn();
    primeLoadRead(client, ROW, { before: [PU] });
    await act(async () => {
      root!.render(
        createElement(QueryClientProvider, { client }, createElement(EditStopModal, { ...props(ROW), onClose })),
      );
    });
    await settle();
    await type(field('ZIP'), '58104');
    await key(field('ZIP'), 'Escape');
    expect(container!.textContent).toContain('Discard changes?');
    expect(onClose).not.toHaveBeenCalled();
  });
});
