// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfOutcome, ScanReading } from '@/lib/ratecon/read-pdf';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { loadReadFor } from '@/test/load-read';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * Phase 3bx, QoL feature 1 (§12.164). The real edit window given the file a row took: read through
 * the strip's own way in (`takeFile`, 3bw), once, exactly as a file let go on the strip; kept past
 * a reading panel (a window slowed to open); and refused with the rule's reason when the window
 * opens on saved stops after all. The PDF read is held, so a test sees which file reached it and
 * how often.
 */
type Read = { file: File; scan: Pick<ScanReading, 'onProgress' | 'signal'>; answer: (out: PdfOutcome) => void };
const pending = vi.hoisted(() => ({ reads: [] as Read[] }));
vi.mock('@/lib/ratecon/read-pdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ratecon/read-pdf')>();
  return {
    ...real,
    linesFromPdfFile: (file: File, scan: Pick<ScanReading, 'onProgress' | 'signal'> = {}) =>
      new Promise<PdfOutcome>((answer) => pending.reads.push({ file, scan, answer })),
  };
});

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const NEW_LOAD = fleetRow({ nextStop: null, openLoadCount: 0 });
const SAVED = fleetRow({
  nextStop: nextStop({ city: 'Joliet', state: 'IL', apptTz: TZ, apptStartUtc: '2026-10-09T15:00:00.000Z', apptEndUtc: '2026-10-09T15:30:00.000Z' }),
});
const PDF = new File(['%PDF-1.4 invented'], 'rate-con.pdf', { type: 'application/pdf' });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
/** The load read, held until a test lets it go: a window slowed to open. */
let releaseRead: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  pending.reads.length = 0;
  releaseRead = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/loads/')) {
      await new Promise<void>((go) => (releaseRead = go));
      return new Response(JSON.stringify(loadReadFor(SAVED)), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
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

const render = async (row = NEW_LOAD, startFile: File | null = PDF) => {
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [row], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row, drivers: [], role: 'dispatcher', dispatchTz: TZ, onClose: vi.fn(), onReload: vi.fn(), startFile }),
      ),
    );
  });
  await settle();
};

const strip = () => container!.querySelector<HTMLElement>('[data-ratecon-strip]');
const refused = () => container!.querySelector('[data-drop-refused]')?.textContent ?? null;

describe('the window a row opened with a file (QoL 1)', () => {
  it('on a new load the strip reads the very file, once, exactly as a drop on the strip', async () => {
    await render();
    expect(strip()).not.toBeNull();
    expect(pending.reads.map((r) => r.file)).toEqual([PDF]);
    expect(strip()!.getAttribute('data-open')).toBe('true');
    expect(refused()).toBeNull();
    // A re-render (a poll's new row, a keystroke) reads nothing again.
    await render(NEW_LOAD, PDF);
    expect(pending.reads).toHaveLength(1);
  });

  it('opened without a file it reads nothing, as before', async () => {
    await render(NEW_LOAD, null);
    expect(pending.reads).toHaveLength(0);
    expect(strip()!.getAttribute('data-open')).toBe('false');
  });

  it('slowed to open: the file is kept past the reading panel, and on saved stops nothing is read and the window says why', async () => {
    // The truck gained a load between the drop and the opening: the window reads it first.
    await render(SAVED, PDF);
    expect(container!.textContent).toContain('Reading this load');
    expect(pending.reads).toHaveLength(0);
    await act(async () => releaseRead?.());
    await settle();
    expect(container!.querySelector('[role="tabpanel"]')).not.toBeNull();
    expect(strip()).toBeNull();
    expect(pending.reads).toHaveLength(0);
    expect(refused()).toBe('Nothing was read: this load has saved stops, and a read only fills a new load.');
  });
});
