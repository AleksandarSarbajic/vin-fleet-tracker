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
 * Phase 3bw, QoL feature 6 (§12.163). The glow's cause is the save itself: the window calls
 * `onSaved` with its truck when a save closes it. Not when a save stays open to say something,
 * not when it fails, not on Cancel. That the call comes after the save's own fetch of the fleet
 * (awaited before it in `sendSave`) needs a mounted fleet query, so the e2e test shows it.
 */
const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const ROW = fleetRow({
  nextStop: nextStop({ city: 'Joliet', state: 'IL', apptTz: TZ, apptStartUtc: '2026-10-09T15:00:00.000Z', apptEndUtc: '2026-10-09T15:30:00.000Z' }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let onSaved: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let order: string[];

const reply = (stops: { status: number; body: unknown }) => {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/stops' && init?.method === 'POST') {
      order.push('save answered');
      return new Response(JSON.stringify(stops.body), { status: stops.status });
    }
    if (url.startsWith('/api/fleet')) order.push('fleet fetched');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  order = [];
  onSaved = vi.fn(() => order.push('onSaved'));
  onClose = vi.fn(() => order.push('onClose'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const render = async () => {
  primeLoadRead(client, ROW);
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [ROW], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row: ROW, drivers: [], role: 'dispatcher', dispatchTz: TZ, onClose, onSaved, onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)!;
const typeNote = (text: string) =>
  act(async () => {
    const note = container!.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(note, text);
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
const save = async () => {
  await typeNote('Gate 4');
  await act(async () => button('Save').click());
  await settle();
};

describe('the window names the save it closed on (QoL 6)', () => {
  it('a save that closes the window: onSaved with its truck, once, after the save was answered, then onClose', async () => {
    reply({ status: 200, body: { ok: true, loadId: 'l1', loadVersion: 'v2' } });
    await render();
    await save();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(ROW.id);
    expect(order.indexOf('onSaved')).toBeGreaterThan(order.indexOf('save answered'));
    expect(order.slice(-2)).toEqual(['onSaved', 'onClose']);
  });

  it('a save that stays open to say something: no onSaved, the window says it', async () => {
    reply({ status: 200, body: { ok: true, loadId: 'l1', loadVersion: 'v2', warnings: [{ field: '*', message: 'Saved, and one thing to know.' }] } });
    await render();
    await save();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a save that failed: no onSaved', async () => {
    reply({ status: 500, body: { error: 'Save failed.' } });
    await render();
    await save();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Cancel: no onSaved', async () => {
    reply({ status: 200, body: { ok: true } });
    await render();
    await act(async () => button('Cancel').click());
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
