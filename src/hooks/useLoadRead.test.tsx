// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { loadReadFor } from '@/test/load-read';
import type { FleetRow } from '@/server/fleet-query';
import { LOAD_READ_SETTLE_MS, loadReadKey, usePrefetchLoadRead } from './useLoadRead';

/**
 * §12.119. The selected truck's load is read before Edit load is clicked —
 * once the selection settles, never twice, and under a key that changes
 * whenever the board shows the load has.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

function Probe({ row }: { row: FleetRow | null }) {
  usePrefetchLoadRead(row);
  return null;
}

const ROW = fleetRow();
const reads = () =>
  (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls
    .map(([url]) => url)
    .filter((u) => u.startsWith('/api/loads/'));

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => loadReadFor(ROW),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const show = (row: FleetRow | null) =>
  act(async () => {
    root!.render(createElement(QueryClientProvider, { client }, createElement(Probe, { row })));
  });

describe('prefetching the selected truck’s load (§12.119)', () => {
  it('reads it once the selection has settled, and not before', async () => {
    await show(ROW);
    await act(async () => vi.advanceTimersByTime(LOAD_READ_SETTLE_MS - 1));
    expect(reads()).toEqual([]);
    await act(async () => vi.advanceTimersByTime(1));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(reads()).toEqual([`/api/loads/${ROW.nextStop!.loadId}`]);
    expect(client.getQueryData(loadReadKey(ROW)!)).toEqual(loadReadFor(ROW));
  });

  it('reads nothing for a selection the arrows passed straight through', async () => {
    const other = fleetRow({ id: '11111111-1111-4111-8111-0000000000aa' });
    await show(ROW);
    await act(async () => vi.advanceTimersByTime(100));
    await show(other);
    await act(async () => vi.advanceTimersByTime(100));
    await show(null);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(reads()).toEqual([]);
  });

  it('does not read again what is in hand, and reads again once the board says it changed', async () => {
    await show(ROW);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    // A poll: the same load, unchanged — a new row object, the same key.
    await show(fleetRow());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(reads()).toHaveLength(1);

    const changed = fleetRow({ nextStop: { loadVersion: 'f'.repeat(32) } });
    await show(changed);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(reads()).toHaveLength(2);
  });

  it('keys the read by what the worker can change too: the next stop and its arrival', () => {
    const base = loadReadKey(ROW);
    expect(loadReadKey(fleetRow({ nextStop: { arrivedAt: '2026-10-08T14:00:00.000Z' } }))).not.toEqual(base);
    expect(
      loadReadKey(fleetRow({ nextStop: { stopId: '22222222-2222-4222-8222-0000000000bb' } })),
    ).not.toEqual(base);
    expect(loadReadKey(fleetRow({ nextStop: null }))).toBeNull();
  });
});

describe('a prefetched read is kept long enough to be used (§12.119)', () => {
  it('is still in hand ten minutes after the selection, with nothing watching it', async () => {
    await show(ROW);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(client.getQueryData(loadReadKey(ROW)!)).toEqual(loadReadFor(ROW));
  });
});
