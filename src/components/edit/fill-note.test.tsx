// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { LABEL_ROWS, PU_SO_PASTED } from '@/test/ratecon-fixtures';
import { linesFromRuns, type Line } from '@/lib/ratecon/lines';
import type { PdfOutcome, ScanReading } from '@/lib/ratecon/read-pdf';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.122, phase 3bq. A note typed on a new load's stop is something entered, as a load number
 * or an address is: a fill over it asks first, Replace or Keep mine. Before 3bq it did not count,
 * and a fill, which builds every stop afresh, threw every typed note away without a question.
 * Through a recognised paste, a scan landing, and an AI read landing; every document is invented.
 */

type Read = { scan: Pick<ScanReading, 'onProgress' | 'signal'>; answer: (out: PdfOutcome) => void };
const pending = vi.hoisted(() => ({ reads: [] as Read[] }));
vi.mock('@/lib/ratecon/read-pdf', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ratecon/read-pdf')>();
  return {
    ...real,
    linesFromPdfFile: (_file: File, scan: Pick<ScanReading, 'onProgress' | 'signal'> = {}) =>
      new Promise<PdfOutcome>((answer) => pending.reads.push({ scan, answer })),
  };
});

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const LABEL_LINES: Line[] = linesFromRuns(LABEL_ROWS.flatMap((runs, i) => runs.map((r) => ({ page: i + 1, ...r }))));
const AI_CLIP = UNKNOWN_LAYOUT.map((l) => l.text).join('\n');
const ASKED = 'Replace the load number and stops you have entered with this rate confirmation?';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
/** The AI read's answer, held until the test lets it land. */
let aiLands: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  pending.reads.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === '/api/ratecon/read') {
      await new Promise<void>((resolve) => (aiLands = resolve));
      return new Response(JSON.stringify({ ok: true, reads: [MODEL_REPLY, MODEL_REPLY] }), { status: 200 });
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
const buttonIn = (scope: ParentNode, label: string) => {
  const found = [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  if (!found) throw new Error(`No button ${label}`);
  return found;
};
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const input = (label: string) => {
  const l = [...container!.querySelectorAll('label')].find((x) => (x.textContent ?? '').trim().startsWith(label));
  if (!l) throw new Error(`No field ${label}`);
  return l.querySelector('input') as HTMLInputElement;
};
/** The open stop's "Dispatcher note · visible to the next shift". */
const note = () => {
  const set = [...form().querySelectorAll('fieldset')].find((f) =>
    (f.querySelector('legend')?.textContent ?? '').startsWith('Dispatcher note'),
  );
  if (!set) throw new Error('No dispatcher note');
  return set.querySelector('textarea')!;
};
const typeNote = (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(note(), text);
    note().dispatchEvent(new Event('input', { bubbles: true }));
  });
const asked = () => (strip().textContent ?? '').includes(ASKED);
const addStop = () => click(container!.querySelector<HTMLButtonElement>('[data-add-stop]')!);
/** Every stop's note, opening each stop in turn. */
const notes = async () => {
  const out: string[] = [];
  for (const tab of tabs()) {
    await click(tab);
    out.push(note().value);
  }
  return out;
};
const pasteText = async (clip: string) => {
  const area = strip().querySelector('textarea')!;
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => clip } });
  await act(async () => {
    area.dispatchEvent(event);
  });
  await settle();
};
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

describe('a typed note counts as something entered (§12.122, phase 3bq)', () => {
  it('a note on stop 1 and nothing else: a recognised paste asks first, and the note is still there', async () => {
    await render();
    await typeNote('Gate code 4471');
    await pasteText(PU_SO_PASTED);
    expect.soft(asked(), 'Replace or Keep mine was asked').toBe(true);
    expect.soft(note().value, "stop 1's note").toBe('Gate code 4471');
    expect(tabs()).toHaveLength(1);
  });

  it('Keep mine keeps the note and fills nothing; Replace fills, and the note goes with the stop', async () => {
    await render();
    await typeNote('Gate code 4471');
    await pasteText(PU_SO_PASTED);
    await click(buttonIn(strip(), 'Keep mine'));
    expect(note().value).toBe('Gate code 4471');
    expect(input('Load number').value).toBe('');
    expect(tabs()).toHaveLength(1);
    await pasteText(PU_SO_PASTED);
    expect(asked()).toBe(true);
    await click(buttonIn(strip(), 'Replace'));
    expect(input('Load number').value).toBe('88123');
    expect(input('City').value).toBe('Fargo');
    expect(await notes()).toEqual(['', '']);
  });

  it('a note on an added stop 2, stop 1 left blank: asks, and Keep mine keeps it', async () => {
    await render();
    await addStop();
    expect(tabs()).toHaveLength(2);
    await click(tabs()[1]!);
    await typeNote('Call 30 min out');
    await pasteText(PU_SO_PASTED);
    expect(asked()).toBe(true);
    await click(buttonIn(strip(), 'Keep mine'));
    expect(await notes()).toEqual(['', 'Call 30 min out']);
  });

  it('Keep mine keeps every note', async () => {
    await render();
    await typeNote('Gate code 4471');
    await addStop();
    await click(tabs()[1]!);
    await typeNote('Call 30 min out');
    await pasteText(PU_SO_PASTED);
    expect(asked()).toBe(true);
    await click(buttonIn(strip(), 'Keep mine'));
    expect(await notes()).toEqual(['Gate code 4471', 'Call 30 min out']);
  });

  it('a note of only spaces is not an entry: the paste fills without asking', async () => {
    await render();
    await typeNote('   ');
    await pasteText(PU_SO_PASTED);
    expect(asked()).toBe(false);
    expect(input('Load number').value).toBe('88123');
    expect(tabs()).toHaveLength(2);
  });

  it('a scan: a note typed while it reads is decided when the read lands, and Keep mine keeps it', async () => {
    await render();
    const read = await drop();
    await typeNote('Gate code 4471');
    await act(async () => read.answer({ ok: true, lines: LABEL_LINES, fromScan: true }));
    await settle();
    expect(asked()).toBe(true);
    expect(note().value).toBe('Gate code 4471');
    await click(buttonIn(strip(), 'Keep mine'));
    expect(note().value).toBe('Gate code 4471');
    expect(input('Load number').value).toBe('');
  });

  it('an AI read: a note typed while it reads is decided when the read lands, and Keep mine keeps it', async () => {
    await render(true);
    await pasteText(AI_CLIP);
    await click(buttonIn(strip(), 'Read with AI'));
    await typeNote('Gate code 4471');
    await act(async () => aiLands());
    await settle();
    expect(asked()).toBe(true);
    await click(buttonIn(strip(), 'Keep mine'));
    expect(note().value).toBe('Gate code 4471');
    expect(input('Load number').value).toBe('');
  });
});
