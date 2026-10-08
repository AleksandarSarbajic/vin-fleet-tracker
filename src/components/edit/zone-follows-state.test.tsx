// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.120, in the modal. The zone follows the typed state — and in a state
 * with two zones, the ZIP — unless the dispatcher picked one; a saved stop
 * keeps its stored zone; and Save waits only while a zone is uncertain and
 * unconfirmed. A one-zone state adds no step at all.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const ROW = fleetRow({
  nextStop: nextStop({
    type: 'PU',
    city: 'Joliet',
    state: 'IL',
    apptStartUtc: ahead(20),
    apptEndUtc: ahead(20.5),
    apptTz: TZ,
    apptType: 'APPT',
  }),
});
/** Saved in Mountain time, in a Central state: the stored zone is the answer. */
const DROP = {
  type: 'DEL' as const,
  city: 'Moorhead',
  state: 'MN',
  zip: '56560',
  apptStartUtc: ahead(30),
  apptEndUtc: ahead(30.5),
  apptTz: 'America/Denver',
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

const render = async () => {
  primeLoadRead(client, ROW, { after: [DROP] });
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [ROW],
    fetchedAt: NOW.toISOString(),
  } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row: ROW,
          drivers: [],
          role: 'admin',
          dispatchTz: TZ,
          onClose: vi.fn(),
          onReload: vi.fn(),
        }),
      ),
    );
  });
  await settle();
};

const rows = () => [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const labelled = (label: string) => {
  const match = [...form().querySelectorAll('label')].find((l) =>
    (l.textContent ?? '').trim().startsWith(label),
  );
  if (!match) throw new Error(`No field labelled ${label}`);
  return match;
};
const field = (label: string) => labelled(label).querySelector('input') as HTMLInputElement;
const zone = () => labelled('Facility time zone').querySelector('select') as HTMLSelectElement;
const zoneCheck = () => form().querySelector('[data-zone-check]')?.textContent ?? null;
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pick = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
};
const save = () => button('Save');
const addStop = () => click(container!.querySelector<HTMLButtonElement>('[data-add-stop]')!);
const postedZones = () =>
  (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([url, init]) => url === '/api/stops' && init?.method === 'POST')
    .flatMap(([, init]) =>
      (JSON.parse(String(init!.body)) as { stops: { appointment: { tz: string } | null }[] }).stops,
    )
    .map((s) => s.appointment?.tz);

/** A new stop at the end, with its address and a time typed in. */
const newStopAt = async (address: { zip?: string; city: string; state: string }) => {
  await addStop();
  if (address.zip !== undefined) await type(field('ZIP'), address.zip);
  await type(field('City'), address.city);
  await type(field('State'), address.state);
  await type(field('Time at the stop'), '09:00');
};

describe('a saved stop keeps its stored zone (§12.120)', () => {
  it('opens on it, unchanged and not dirty, whatever its state says', async () => {
    await render();
    await click(rows()[1]!);
    expect(zone().value).toBe('America/Denver');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(true);
  });

  it('is not moved by a new state or ZIP', async () => {
    await render();
    await click(rows()[1]!);
    await type(field('State'), 'ND');
    await type(field('ZIP'), '58102');
    expect(zone().value).toBe('America/Denver');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
  });
});

describe('a new stop’s zone follows the typed state (§12.120)', () => {
  it('in a one-zone state, with no extra step', async () => {
    await render();
    await newStopAt({ zip: '80216', city: 'Denver', state: 'CO' });
    expect(zone().value).toBe('America/Denver');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
    await click(save());
    expect(postedZones()).toContain('America/Denver');
  });

  it('in Illinois and Minnesota, with no extra step and no ZIP needed', async () => {
    await render();
    await newStopAt({ city: 'Des Plaines', state: 'IL' });
    expect(zone().value).toBe('America/Chicago');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
    await type(field('State'), 'MN');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('in a two-zone state, from the ZIP', async () => {
    await render();
    await newStopAt({ zip: '58601', city: 'Dickinson', state: 'ND' });
    expect(zone().value).toBe('America/Denver');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
  });
});

describe('an uncertain zone waits for the dispatcher (§12.120)', () => {
  it('blocks Save in a two-zone state with no ZIP, until "Zone is right"', async () => {
    await render();
    await newStopAt({ city: 'Fargo', state: 'ND' });
    expect(zone().value).toBe('America/Chicago');
    expect(zoneCheck()).toContain('ND has more than one time zone');
    expect(save().disabled).toBe(true);
    await click(button('Zone is right'));
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
    await click(save());
    expect(postedZones()).toContain('America/Chicago');
  });

  it('never guesses a ZIP that crosses the line', async () => {
    await render();
    await newStopAt({ zip: '58854', city: 'Watford City', state: 'ND' });
    expect(zoneCheck()).toContain('ZIP 58854 crosses a time zone line');
    expect(save().disabled).toBe(true);
  });

  it('asks again when the address changes after a confirmation', async () => {
    await render();
    await newStopAt({ city: 'Fargo', state: 'ND' });
    await click(button('Zone is right'));
    await type(field('ZIP'), '58854');
    expect(zoneCheck()).toContain('crosses');
    expect(save().disabled).toBe(true);
  });

  it('is settled by picking the zone by hand, and the state never overrides it after', async () => {
    await render();
    await newStopAt({ zip: '58854', city: 'Watford City', state: 'ND' });
    await pick(zone(), 'America/Denver');
    expect(zoneCheck()).toBeNull();
    expect(save().disabled).toBe(false);
    await type(field('State'), 'IL');
    await type(field('ZIP'), '60018');
    expect(zone().value).toBe('America/Denver');
    expect(zoneCheck()).toBeNull();
  });
});
