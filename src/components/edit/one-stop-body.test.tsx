// @vitest-environment happy-dom
import { createElement } from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { loadReadFor } from '@/test/load-read';
import type { FleetRow } from '@/server/fleet-query';
import type { BoardDriver } from '@/server/assignments';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.119, condition 4 of stage 4a. On a load with ONE stop, the two-pane
 * modal must send exactly what the one-stop modal sent: the same keys, in
 * the same order, with the same values — byte for byte.
 *
 * The golden file was recorded from the one-stop modal BEFORE it was split
 * (commit 33c215a's `EditStopModal`), by running this file with
 * `RECORD_ONE_STOP_BODIES=1`. It is never re-recorded to make a change pass:
 * a different body is a different request, and that is the change.
 */

const GOLDEN = join(import.meta.dirname, 'one-stop-bodies.golden.json');
const RECORD = process.env.RECORD_ONE_STOP_BODIES === '1';
const recorded: Record<string, string> = {};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

const DRIVER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRIVER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PREVIOUS_LOAD = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-18T15:00:00.000Z');

const driver = (id: string, name: string, truckId: string | null): BoardDriver => ({
  id,
  name,
  active: true,
  source: 'app',
  samsaraDriverId: null,
  phone: null,
  truckId,
  truckLabel: truckId ? '137' : null,
});

const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** A finished stop on an open load, for the previous-load question. */
const previousStop = {
  stopId: '44444444-4444-4444-8444-44444444440a',
  loadId: PREVIOUS_LOAD,
  loadNumber: '6612193',
  loadStatus: 'AVAILABLE',
  loadCreatedAt: ago(20),
  sequence: 1,
  type: 'DEL',
  addressLine: '220 N Fairway Dr',
  city: 'Vernon Hills',
  state: 'IL',
  zip: '60061',
  apptStartUtc: null,
  apptEndUtc: null,
  apptTz: 'America/Chicago',
  apptType: 'APPT',
  arrivedAt: ago(2),
  arrivedSource: 'detected',
  departedAt: ago(1),
  departedSource: 'detected',
  dispatcherNote: null,
  noteAt: null,
  overrides: [],
};

const preview = {
  gaining: {
    truckId: '11111111-1111-4111-8111-111111111111',
    truckLabel: '137',
    driverId: DRIVER_A,
    driverName: 'Sam Driver',
    driverSource: 'app',
    driverSamsaraId: null,
    nextApptUtc: null,
    nextApptTz: null,
    toDriverId: DRIVER_B,
    toDriverName: 'Hal Hand',
  },
  losing: null,
  summary: 'Truck 137: Sam Driver → Hal Hand.',
  note: '',
  token: 'preview-token-1',
};

/** Every request the modal makes, answered as the server would. */
const serve = (row: FleetRow) => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const path = String(url);
    const body = path.startsWith('/api/loads/')
      ? loadReadFor(row)
      : path.startsWith('/api/timeline')
        ? { stops: [previousStop] }
        : path === '/api/assignments/preview'
          ? preview
          : { ok: true };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
};

/** The raw body of the one save, exactly as it went on the wire. */
const savedBody = (): string => {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
    .mock.calls.filter(([url, init]) => url === '/api/stops' && init?.method === 'POST');
  expect(calls).toHaveLength(1);
  return String(calls[0]![1]!.body);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const render = async (row: FleetRow, drivers: BoardDriver[] = []) => {
  serve(row);
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
          drivers,
          role: 'admin' as const,
          dispatchTz: 'America/Chicago',
          onClose: () => {},
        }),
      ),
    );
  });
  await settle();
};

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const field = (label: string): HTMLInputElement => {
  const match = Array.from(container!.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').trim().startsWith(label),
  );
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input as HTMLInputElement;
};

const click = async (label: string, scope: ParentNode = document) => {
  const button = Array.from(scope.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => button.click());
  await settle();
};

const type = async (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  await act(async () => setValue(el, text));
};

const check = (name: string, body: string) => {
  if (RECORD) {
    recorded[name] = body;
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
  expect(golden[name], `no golden body for ${name}`).toBeDefined();
  expect(body).toBe(golden[name]);
};

const WITH_APPOINTMENT = fleetRow({
  nextStop: nextStop({
    apptStartUtc: '2026-09-19T14:00:00.000Z',
    apptEndUtc: '2026-09-19T14:30:00.000Z',
    apptTz: 'America/Chicago',
    apptType: 'APPT',
    dispatcherNote: 'Dock 4',
  }),
});

const REACHED = fleetRow({
  nextStop: nextStop({
    loadNumber: '12120640',
    city: 'Joliet',
    arrivedAt: '2026-09-18T11:44:00.000Z',
    arrivedSource: 'detected',
    apptTz: 'America/Chicago',
  }),
  etaAbsence: 'arrived',
  status: 'ARRIVED',
  computed: 'ARRIVED',
});

describe('a one-stop save sends what the one-stop modal sent (§12.119)', () => {
  afterEach(() => {
    if (RECORD) writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`);
  });

  it('a plain save', async () => {
    await render(WITH_APPOINTMENT);
    await type(field('ZIP'), '60602');
    await type(container!.querySelector('textarea')!, 'Dock 5, ring twice');
    await click('Save');
    check('plain', savedBody());
  });

  it('a reassign, confirmed against the preview', async () => {
    await render(WITH_APPOINTMENT, [
      driver(DRIVER_A, 'Sam Driver', WITH_APPOINTMENT.id),
      driver(DRIVER_B, 'Hal Hand', null),
    ]);
    const picker = field('Assigned driver');
    await act(async () => picker.click());
    await type(picker, 'Hal');
    const option = Array.from(container!.querySelectorAll('[role="option"]')).find((o) =>
      (o.textContent ?? '').includes('Hal Hand'),
    ) as HTMLElement | undefined;
    if (!option) throw new Error('No option for Hal Hand');
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      option.click();
    });
    await click('Confirm reassign & save');
    await click('Assign driver');
    check('reassign', savedBody());
  });

  it('a new load that closes the previous one', async () => {
    await render(fleetRow({ nextStop: null, openLoadCount: 1 }));
    await type(field('City'), 'Aurora');
    await click('Save');
    const group = document.querySelector(`[data-save-question="${PREVIOUS_LOAD}"]`)!;
    await click('Delivered', group);
    check('previous-load-close', savedBody());
  });

  it('a reached stop, answered Correction', async () => {
    await render(REACHED);
    await type(field('City'), 'Des Plaines');
    await click('Save');
    await click('Correction');
    check('reached-correction', savedBody());
  });

  it('a reached stop, answered Next trip', async () => {
    await render(REACHED);
    await type(field('City'), 'Des Plaines');
    await click('Save');
    await click('Next trip');
    check('next-trip', savedBody());
  });
});
