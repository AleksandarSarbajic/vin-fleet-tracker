// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { SCAN_CHECK } from './ratecon-fill';
import { SCAN_NOTE } from './RateconStrip';
import { fleetRow } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { LABEL_ROWS } from '@/test/ratecon-fixtures';
import { linesFromRuns, type Line } from '@/lib/ratecon/lines';
import type { PdfOutcome, ScanReading } from '@/lib/ratecon/read-pdf';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.128, in the modal: a scan read by OCR. The OCR itself is proved in
 * `read-scan.test.ts`; here the PDF reader is replaced by one the test
 * drives — its progress, when it answers, and with what — so what the strip
 * and the form do with a scan can be watched step by step. Every document
 * is invented.
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
/** The invented label-rows document, as its lines; a scan of it would give these. */
const LABEL_LINES: Line[] = linesFromRuns(LABEL_ROWS.flatMap((runs, i) => runs.map((r) => ({ page: i + 1, ...r }))));

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
  globalThis.fetch = vi.fn(async (url: string) =>
    url === '/api/ratecon/read'
      ? new Response(JSON.stringify({ ok: true, reads: [MODEL_REPLY, MODEL_REPLY] }), { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ) as unknown as typeof fetch;
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

const EMPTY = fleetRow({ nextStop: null, openLoadCount: 0 });

const render = async (aiReader = false) => {
  primeLoadRead(client, EMPTY, { after: [] });
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [EMPTY], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row: EMPTY, drivers: [], role: 'dispatcher', dispatchTz: TZ, aiReader, onClose: vi.fn(), onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const strip = () => container!.querySelector<HTMLElement>('[data-ratecon-strip]')!;
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const tabs = () => [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const field = (scope: ParentNode, label: string) => {
  const l = [...scope.querySelectorAll('label')].find((x) => (x.textContent ?? '').trim().startsWith(label));
  if (!l) throw new Error(`No field ${label}`);
  return l;
};
const input = (scope: ParentNode, label: string) => field(scope, label).querySelector('input') as HTMLInputElement;
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const said = () => strip().querySelector('[data-ratecon-said]')?.textContent ?? '';
const progress = () => strip().querySelector('[data-ratecon-scanning]')?.textContent ?? null;
const checkOf = (label: string) => field(form(), label).querySelector('[data-field-check]')?.textContent ?? null;
const appointmentCheck = () => form().querySelector('[data-appointment-check]')?.textContent ?? null;
const loadCheck = () => field(container!, 'Load number').querySelector('[data-field-check]')?.textContent ?? null;
const typeCheck = () => form().querySelector('[data-type-fill] .text-status-risk-fg')?.textContent ?? null;

/** Drops an invented PDF on the strip; the reader the test drives takes it. */
const drop = async () => {
  const chooser = strip().querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([new Uint8Array([37, 80, 68, 70, 45])], 'invented.pdf', { type: 'application/pdf' });
  Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
  await act(async () => {
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  return pending.reads.at(-1)!;
};
const progressTo = async (read: Read, page: number, of: number) => {
  await act(async () => read.scan.onProgress?.({ page, of }));
  await settle();
};
const answer = async (read: Read, out: PdfOutcome) => {
  await act(async () => read.answer(out));
  await settle();
};

describe('a scan, read by OCR in the browser (§12.128)', () => {
  it('says how far it has got, page by page, and the dispatcher can type meanwhile', async () => {
    await render();
    const read = await drop();
    await progressTo(read, 0, 3);
    expect(progress()).toBe('Reading the scan — starting the reader…');
    await progressTo(read, 2, 3);
    expect(progress()).toBe('Reading the scan — page 2 of 3');
    // Typing folds the strip's detail, but a scan being read stays on it.
    await type(input(form(), 'Street address'), '12 Typed Rd');
    expect(input(form(), 'Street address').value).toBe('12 Typed Rd');
    expect(progress()).toBe('Reading the scan — page 2 of 3');
  });

  it('fills from a template and marks EVERY field it filled or left as read from a scan', async () => {
    await render();
    const read = await drop();
    await progressTo(read, 1, 1);
    await answer(read, { ok: true, lines: LABEL_LINES, fromScan: true });
    expect(said()).toBe(
      'Filled 2 stops from label rows (PICKUP DATE / SHIPPER / CONSIGNEE), read from a scan: every field is marked Check. Nothing is saved until Save.',
    );
    expect(input(container!, 'Load number').value).toBe('550123');
    expect(loadCheck()).toBe(`Check: ${SCAN_CHECK}`);
    for (const [i, stop] of tabs().entries()) {
      await click(stop);
      for (const label of ['Street address', 'City', 'State', 'ZIP']) expect(checkOf(label), `stop ${i + 1} ${label}`).toBe(`Check: ${SCAN_CHECK}`);
      expect(typeCheck(), `stop ${i + 1} type`).toBe(`Check: ${SCAN_CHECK}`);
      expect(appointmentCheck(), `stop ${i + 1} appointment`).toContain(`Check: ${SCAN_CHECK}`);
    }
    // 2 stops × 6 fields, and the load number.
    expect(strip().querySelector('[data-to-check]')?.textContent).toBe('13 fields to check');
  });

  it('the same lines from a text layer are not marked', async () => {
    await render();
    const read = await drop();
    await answer(read, { ok: true, lines: LABEL_LINES, fromScan: false });
    expect(said()).toBe('Filled 2 stops from label rows (PICKUP DATE / SHIPPER / CONSIGNEE). Nothing is saved until Save.');
    expect(checkOf('City')).toBeNull();
    expect(loadCheck()).toBeNull();
  });

  it('asks before replacing what was typed while it read, though nothing was typed when it was dropped', async () => {
    await render();
    const read = await drop();
    await progressTo(read, 1, 1);
    await type(input(form(), 'City'), 'Moorhead');
    await answer(read, { ok: true, lines: LABEL_LINES, fromScan: true });
    expect(strip().textContent).toContain('Replace the load number and stops you have entered with this rate confirmation?');
    expect(input(form(), 'City').value).toBe('Moorhead');
    await click(buttonIn(strip(), 'Replace')!);
    expect(input(form(), 'City').value).toBe('Fargo');
    expect(checkOf('City')).toBe(`Check: ${SCAN_CHECK}`);
  });

  it('fills the form as it is when the read lands, keeping what was changed meanwhile', async () => {
    await render();
    const read = await drop();
    await progressTo(read, 1, 1);
    const status = container!.querySelector<HTMLSelectElement>('select')!;
    const other = [...status.options].map((o) => o.value).find((v) => v !== status.value)!;
    await act(async () => {
      status.value = other;
      status.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    await answer(read, { ok: true, lines: LABEL_LINES, fromScan: true });
    expect(input(container!, 'Load number').value).toBe('550123');
    expect(container!.querySelector<HTMLSelectElement>('select')!.value).toBe(other);
  });

  it('Cancel stops the read, fills nothing, and drops what it would have read', async () => {
    await render();
    const read = await drop();
    await progressTo(read, 1, 2);
    await click(buttonIn(strip(), 'Cancel')!);
    expect(read.scan.signal?.aborted).toBe(true);
    expect(said()).toBe('Stopped reading the scan. Nothing was filled.');
    await answer(read, { ok: true, lines: LABEL_LINES, fromScan: true });
    expect(input(container!, 'Load number').value).toBe('');
    expect(said()).toBe('Stopped reading the scan. Nothing was filled.');
  });

  it('a newer file stops the scan still being read', async () => {
    await render();
    const first = await drop();
    await progressTo(first, 1, 2);
    await drop();
    expect(first.scan.signal?.aborted).toBe(true);
  });

  it('closing the modal stops it', async () => {
    await render();
    const read = await drop();
    await progressTo(read, 1, 2);
    act(() => root?.unmount());
    root = null;
    expect(read.scan.signal?.aborted).toBe(true);
  });

  it('a scan OCR could not read says so, and fills nothing', async () => {
    await render();
    const read = await drop();
    await answer(read, { ok: false, message: 'This is a scan, and no text could be read from it. Type the load from the PDF.' });
    expect(said()).toBe('This is a scan, and no text could be read from it. Type the load from the PDF.');
    expect(input(container!, 'Load number').value).toBe('');
  });

  it('a scan no template reads says it was a scan; with the reader off, nothing more', async () => {
    await render(false);
    const read = await drop();
    await answer(read, { ok: true, lines: UNKNOWN_LAYOUT, fromScan: true });
    expect(said()).toBe(`Layout not recognised, nothing filled. ${SCAN_NOTE}`);
  });

  it('then Read with AI, as for any template miss — the redaction unchanged — and every AI-filled field marked as from a scan', async () => {
    await render(true);
    const read = await drop();
    await answer(read, { ok: true, lines: UNKNOWN_LAYOUT, fromScan: true });
    expect(strip().querySelector('[data-ratecon-scan]')?.textContent).toBe(SCAN_NOTE);
    const sent = strip().querySelector('[data-ratecon-sent] pre')!.textContent!;
    expect(sent).toContain('L3 Booked by: [REMOVED]');
    expect(sent).not.toContain('dispatch@example.com');
    await click(buttonIn(strip(), 'Read with AI')!);
    expect(said()).toBe(
      'Filled 2 stops, read by AI from a scan: every field is marked Check. Check each stop against its quote and the PDF, then press Looks right. Nothing is saved until Save.',
    );
    expect(input(form(), 'Street address').value).toBe('4001 Main St');
    expect(checkOf('Street address')).toBe(`Check: ${SCAN_CHECK}`);
    expect(loadCheck()).toBe(`Check: ${SCAN_CHECK}`);
    // The AI's own marks stand beside it: "Looks right" clears those, not the scan's.
    expect(strip().querySelector('[data-ai-to-confirm]')?.textContent).toBe('2 stops read by AI to confirm');
    await click(buttonIn(form(), 'Looks right')!);
    expect(checkOf('Street address')).toBe(`Check: ${SCAN_CHECK}`);
  });
});
