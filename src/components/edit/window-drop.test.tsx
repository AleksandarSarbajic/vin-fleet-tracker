// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfOutcome, ScanReading } from '@/lib/ratecon/read-pdf';
import { EditStopModal } from './EditStopModal';
import { NO_FILE_HANDED, carriesFiles, fileMayFill, nothingRead, rowFillRule } from './window-drop';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * Phase 3bw, QoL feature 12 (§12.163). A file let go anywhere in the edit window: read by the
 * strip on a new load, exactly as one let go on the strip; swallowed with the reason where the
 * strip is not offered. The PDF read is held, so a test sees which file reached it and how often.
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  pending.reads.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
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

const render = async (row = NEW_LOAD) => {
  if (row.nextStop) primeLoadRead(client, row);
  else primeLoadRead(client, row, { after: [] });
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [row], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row, drivers: [], role: 'dispatcher', dispatchTz: TZ, onClose: vi.fn(), onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const PDF = new File(['%PDF-1.4 invented'], 'ratecon.pdf', { type: 'application/pdf' });

/** A drag event as the browser sends one: files listed in `types`, the file in `files`. */
async function drag(target: Element, type: 'dragover' | 'drop', carrying: 'files' | 'text' | 'empty' = 'files'): Promise<Event> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value:
      carrying === 'files'
        ? { types: ['Files'], files: [PDF], dropEffect: 'none' }
        : // 'empty': a folder, or a browser that keeps the file back: it says Files and hands none.
          { types: carrying === 'empty' ? ['Files'] : ['text/plain'], files: [], dropEffect: 'none' },
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
}

const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const strip = () => container!.querySelector<HTMLElement>('[data-ratecon-strip]');
const refused = () => container!.querySelector('[data-drop-refused]')?.textContent ?? null;
const panel = () => container!.querySelector<HTMLElement>('[role="dialog"]')!.firstElementChild as HTMLElement;

describe('the rule (QoL 12), one function for the window, the strip and the board (3bx, §12.164)', () => {
  it('offers a fill only while the strip would: an editor, no saved stop, no save on its way or landed', () => {
    const said = (rule: Parameters<typeof fileMayFill>[0]) => {
      const offer = fileMayFill(rule);
      return offer.offered ? 'offered' : nothingRead(offer.reason);
    };
    expect(said({ mayEdit: true, saving: false, spent: false, anyStored: false })).toBe('offered');
    expect(said({ mayEdit: true, saving: false, spent: false, anyStored: true })).toBe(
      'Nothing was read: this load has saved stops, and a read only fills a new load.',
    );
    expect(said({ mayEdit: false, saving: false, spent: false, anyStored: false })).toBe('Nothing was read: a viewer cannot fill a load.');
    expect(said({ mayEdit: true, saving: true, spent: false, anyStored: false })).toBe('Nothing was read: a save is on its way.');
    expect(said({ mayEdit: true, saving: false, spent: true, anyStored: false })).toBe(
      'Nothing was read: this load was just saved, and a read only fills a new load.',
    );
  });

  it("a row asks it as the window it would open: no next stop is a new load, a next stop is a saved one, a viewer can't", () => {
    expect(fileMayFill(rowFillRule(NEW_LOAD, 'dispatcher'))).toEqual({ offered: true });
    expect(fileMayFill(rowFillRule(NEW_LOAD, 'admin'))).toEqual({ offered: true });
    expect(fileMayFill(rowFillRule(SAVED, 'dispatcher'))).toEqual({
      offered: false,
      reason: 'this load has saved stops, and a read only fills a new load',
    });
    expect(fileMayFill(rowFillRule(NEW_LOAD, 'viewer'))).toEqual({ offered: false, reason: 'a viewer cannot fill a load' });
  });

  it('only a drag that carries files', () => {
    expect(carriesFiles(['Files'])).toBe(true);
    expect(carriesFiles(['text/plain', 'text/uri-list'])).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe('a file let go anywhere in the edit window (QoL 12)', () => {
  it('on a new load, a file let go on the form is read by the strip, exactly as one let go on it', async () => {
    await render();
    expect(strip()).not.toBeNull();
    const event = await drag(form(), 'drop');
    expect(event.defaultPrevented).toBe(true);
    expect(pending.reads.map((r) => r.file)).toEqual([PDF]);
    expect(refused()).toBeNull();
  });

  it('a file let go on the strip is read once, by the strip, not twice', async () => {
    await render();
    await drag(strip()!, 'drop');
    expect(pending.reads).toHaveLength(1);
  });

  it('a file over the window, off the strip, is taken, and the window shows where it goes', async () => {
    await render();
    const event = await drag(form(), 'dragover');
    expect(event.defaultPrevented).toBe(true);
    expect(panel().className).toContain('ring-accent');
  });

  it('on a load with saved stops, the file is swallowed, nothing is read, and the window says why', async () => {
    await render(SAVED);
    expect(strip()).toBeNull();
    const over = await drag(form(), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(panel().className).not.toContain('ring-accent');
    const event = await drag(form(), 'drop');
    expect(event.defaultPrevented, 'the browser would open the file').toBe(true);
    expect(pending.reads).toHaveLength(0);
    expect(refused()).toBe('Nothing was read: this load has saved stops, and a read only fills a new load.');
  });

  it('a drag that says Files and hands none over, on the form: taken, nothing read, and the window says why (3bx)', async () => {
    await render();
    const event = await drag(form(), 'drop', 'empty');
    expect(event.defaultPrevented).toBe(true);
    expect(pending.reads).toHaveLength(0);
    expect(refused()).toBe(NO_FILE_HANDED);
  });

  it('the same drag on the strip: nothing read, and the strip says why (3bx)', async () => {
    await render();
    const event = await drag(strip()!, 'drop', 'empty');
    expect(event.defaultPrevented).toBe(true);
    expect(pending.reads).toHaveLength(0);
    expect(strip()!.querySelector('[data-ratecon-said="fault"]')?.textContent).toBe(NO_FILE_HANDED);
  });

  it('text let go on the strip stays as quiet as it was: nothing read, nothing said (3bx)', async () => {
    await render();
    await drag(strip()!, 'drop', 'text');
    expect(pending.reads).toHaveLength(0);
    expect(strip()!.querySelector('[data-ratecon-said]')).toBeNull();
  });

  it('text dragged into the window is the browser\'s: not taken, nothing read', async () => {
    await render();
    const event = await drag(form(), 'drop', 'text');
    expect(event.defaultPrevented).toBe(false);
    expect(pending.reads).toHaveLength(0);
  });
});
