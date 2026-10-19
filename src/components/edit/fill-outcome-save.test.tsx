// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import { loadReadFor, primeLoadRead } from '@/test/load-read';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { PU_SO_PASTED } from '@/test/ratecon-fixtures';
import type { FleetResponse } from '@/hooks/useFleet';
import type { ModelRead } from '@/lib/ratecon/model-read';
import { readCounts } from '@/lib/ratecon/session-counts';
import { linesFromText } from '@/lib/ratecon/lines';
import { layoutLabels } from '@/lib/ratecon/layout';
import { prepareForReading } from '@/lib/ratecon/redact';

/**
 * What the dispatcher did with an AI read, told to the server (docs/
 * llm-reader-design.md §4; Alex, 2026-10-14): in the modal, through the
 * strip, the save and the network — only `fetch` is replaced. Counts only,
 * once per read, at the first save after the fill, and never in the way of
 * the save.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-10T15:00:00.000Z');
const CLIP = UNKNOWN_LAYOUT.map((l) => l.text).join('\n');
const READ_ID = '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44';

/** MODEL_REPLY, with stop 2's appointment "none": an AI fill the dispatcher can save as it is. */
const SAVEABLE: ModelRead = {
  ...MODEL_REPLY,
  stops: [MODEL_REPLY.stops[0]!, { ...MODEL_REPLY.stops[1]!, appointment: { kind: 'none' } }],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let onClose: ReturnType<typeof vi.fn>;
/** Every request the page made, in order. */
let calls: { url: string; body: string }[] = [];
let readAnswer: () => Response;
let stopsAnswer: () => Response;
let outcomeAnswer: () => Promise<Response>;
/** `GET /api/loads/:id`: the load read again after a save that keeps the modal open (§12.127). */
let loadAnswer: () => Response;
const SAVED_LOAD = '77777777-7777-4777-8777-777777777777';
const SAVED_VERSION = 'abcdef0123456789abcdef0123456789';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const posts = (url: string) => calls.filter((c) => c.url === url);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onClose = vi.fn();
  calls = [];
  readAnswer = () => json(200, { ok: true, reads: [SAVEABLE, SAVEABLE], readId: READ_ID });
  stopsAnswer = () => json(200, { ok: true });
  outcomeAnswer = async () => json(200, { ok: true, recorded: true });
  loadAnswer = () => json(404, { error: 'That load does not exist.' });
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') });
    if (url === '/api/ratecon/read') return readAnswer();
    if (url === '/api/stops') return stopsAnswer();
    if (url === '/api/ratecon/outcome') return outcomeAnswer();
    if (url.startsWith('/api/loads/')) return loadAnswer();
    return json(200, { ok: true });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const EMPTY = fleetRow({ nextStop: null, openLoadCount: 0 });

const render = async () => {
  primeLoadRead(client, EMPTY, { after: [] });
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [EMPTY], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row: EMPTY, drivers: [], role: 'dispatcher', dispatchTz: TZ, aiReader: true, onClose, onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const strip = () => container!.querySelector<HTMLElement>('[data-ratecon-strip]')!;
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase())) ?? null;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
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
const input = (scope: ParentNode, label: string) => {
  const l = [...scope.querySelectorAll('label')].find((x) => (x.textContent ?? '').trim().startsWith(label));
  if (!l) throw new Error(`No field ${label}`);
  return l.querySelector('input') as HTMLInputElement;
};
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const aiFill = async () => {
  await pasteText(CLIP);
  await click(buttonIn(strip(), 'Read with AI')!);
};
const save = () => click(buttonIn(container!, 'Save')!);
const sent = () => JSON.parse(posts('/api/ratecon/outcome')[0]!.body) as { readId: string; fields: Record<string, unknown>[]; layout: string[] };
/** The fingerprint of the text the page sent for CLIP: the sent lines, labelled. */
const CLIP_LAYOUT = (() => {
  const prepared = prepareForReading(linesFromText(CLIP));
  if (!prepared.ok) throw new Error(prepared.reason);
  return layoutLabels(prepared.lines);
})();
const notRecorded = () => readCounts().outcomeNotRecorded;

describe('an AI fill, saved', () => {
  it('tells the server once, after the load has saved: the read\'s id and counts per field name', async () => {
    await render();
    await aiFill();
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
    await save();
    expect(posts('/api/stops')).toHaveLength(1);
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);
    // The save went first.
    expect(calls.findIndex((c) => c.url === '/api/stops')).toBeLessThan(calls.findIndex((c) => c.url === '/api/ratecon/outcome'));
    const body = sent();
    expect(body.readId).toBe(READ_ID);
    const by = Object.fromEntries(body.fields.map((f) => [f.field, f]));
    expect(by.street).toMatchObject({ kept: 2, changed: 0, cleared: 0 });
    expect(by.load_number).toMatchObject({ kept: 1 });
    expect(by.appointment).toMatchObject({ kept: 1, blankLeft: 1 });
    expect(onClose).toHaveBeenCalled();
  });

  it('what was edited before the save is changed, cleared or blank-filled — and nothing else leaves', async () => {
    await render();
    await aiFill();
    await type(input(form(), 'Street address'), `4003 Main St ${SENTINEL}`);
    await type(input(form(), 'City'), '');
    await save();
    const text = posts('/api/ratecon/outcome')[0]!.body;
    const by = Object.fromEntries(sent().fields.map((f) => [f.field, f]));
    expect(by.street).toMatchObject({ kept: 1, changed: 1 });
    expect(by.city).toMatchObject({ kept: 1, cleared: 1 });
    for (const forbidden of [SENTINEL, 'Main', 'Fargo', 'Duluth', 'EX-40417', '58102']) expect(text).not.toContain(forbidden);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['fields', 'layout', 'readId']);
  });

  it('sends the read\'s layout with it: hashes of the labels in the text that was sent, and nothing else', async () => {
    await render();
    await aiFill();
    await type(input(form(), 'Street address'), `${SENTINEL} Main St`);
    await save();
    const body = sent();
    expect(CLIP_LAYOUT.length).toBeGreaterThan(0);
    expect(body.layout).toEqual(CLIP_LAYOUT);
    for (const h of body.layout) expect(h).toMatch(/^[0-9a-f]{8}$/);
    const text = posts('/api/ratecon/outcome')[0]!.body;
    for (const forbidden of [SENTINEL, 'Load', 'Booked', 'Pick', 'Dana', 'Fargo']) expect(text).not.toContain(forbidden);
  });

  it('a layout the server refuses never touches the save: the load saved, the miss is counted, nothing shown', async () => {
    outcomeAnswer = async () => json(400, { ok: false, code: 'bad_request' });
    const before = notRecorded();
    await render();
    await aiFill();
    await save();
    expect(posts('/api/stops')).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
    expect(notRecorded()).toBe(before + 1);
  });

  it('only the FIRST save after the fill: a later edit and save posts nothing more', async () => {
    // A warning keeps the modal open, on the load as saved (§12.127).
    const saved = loadReadFor(fleetRow({ nextStop: { loadId: SAVED_LOAD, loadVersion: SAVED_VERSION } }))!;
    stopsAnswer = () =>
      json(200, { loadId: SAVED_LOAD, loadVersion: SAVED_VERSION, warnings: [{ field: 'zip', message: 'a thing to know' }] });
    loadAnswer = () => json(200, saved);
    await render();
    await aiFill();
    await save();
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);
    await type(input(form(), 'Street address'), '9 Elm Ave');
    await save();
    expect(posts('/api/stops')).toHaveLength(2);
    expect(JSON.parse(posts('/api/stops')[1]!.body)).toMatchObject({ loadId: SAVED_LOAD, version: SAVED_VERSION });
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);
  });

  it('a save that did not land says nothing yet: the outcome waits for the one that does', async () => {
    stopsAnswer = () => json(500, { error: 'Save failed.' });
    await render();
    await aiFill();
    await save();
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
    stopsAnswer = () => json(200, { ok: true });
    await save();
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);
  });
});

describe('nothing is recorded', () => {
  it('for a load saved without any AI fill', async () => {
    await render();
    await type(input(container!, 'Load number'), 'MINE-1');
    await type(input(form(), 'Street address'), '1 Elm St');
    await type(input(form(), 'City'), 'Fargo');
    await type(input(form(), 'State'), 'ND');
    await type(input(form(), 'ZIP'), '58102');
    await save();
    expect(posts('/api/stops')).toHaveLength(1);
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
  });

  it('for a fill from a template', async () => {
    await render();
    await pasteText(PU_SO_PASTED);
    await save();
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
  });

  it('for an AI fill the dispatcher replaced with a template one', async () => {
    await render();
    await aiFill();
    await pasteText(PU_SO_PASTED);
    await click(buttonIn(strip(), 'Replace') ?? buttonIn(strip(), 'Replace')!);
    await save();
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
  });

  it('for a failed pair: nothing was filled', async () => {
    readAnswer = () => json(503, { ok: false, code: 'unavailable' });
    await render();
    await pasteText(CLIP);
    await click(buttonIn(strip(), 'Read with AI')!);
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
  });

  it('when the server named no read to link it to', async () => {
    readAnswer = () => json(200, { ok: true, reads: [SAVEABLE, SAVEABLE] });
    await render();
    await aiFill();
    await save();
    expect(posts('/api/stops')).toHaveLength(1);
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
  });

  it('when the modal closes without a save', async () => {
    await render();
    await aiFill();
    expect(posts('/api/ratecon/outcome')).toHaveLength(0);
  });
});

describe('a save is never in its way', () => {
  it.each([
    ['refuses it (500)', async () => json(500, { ok: false, code: 'error' })],
    ['says the read is not known (404)', async () => json(404, { ok: false, code: 'unknown_read' })],
    ['cannot be reached', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('the server %s: the load still saves and the modal still closes, with no error shown', async (_, answer) => {
    outcomeAnswer = answer;
    await render();
    await aiFill();
    const before = notRecorded();
    await save();
    expect(posts('/api/stops')).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
    expect(container!.textContent).not.toContain('Save failed');
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    // Counted in this tab, told to nobody.
    expect(notRecorded()).toBe(before + 1);
  });

  it('an outcome that never answers does not hold the save: the modal closes at once', async () => {
    outcomeAnswer = () => new Promise<Response>(() => undefined);
    await render();
    await aiFill();
    await save();
    expect(posts('/api/stops')).toHaveLength(1);
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('changes nothing the dispatcher sees: the strip reads the same whether the outcome was recorded or not', async () => {
    await render();
    await aiFill();
    await save();
    const recorded = strip().textContent;
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);

    act(() => root?.unmount());
    root = createRoot(container!);
    calls = [];
    outcomeAnswer = async () => Promise.reject(new TypeError('Failed to fetch'));
    await render();
    await aiFill();
    await save();
    expect(posts('/api/ratecon/outcome')).toHaveLength(1);
    expect(strip().textContent).toBe(recorded);
  });
});
