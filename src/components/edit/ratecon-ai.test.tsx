// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import type { FleetResponse } from '@/hooks/useFleet';
import type { ModelRead } from '@/lib/ratecon/model-read';

/**
 * "Read with AI", in the modal (docs/llm-reader-design.md §1, §10): offered
 * only after a template miss, what it says it sends, what it fills, the AI
 * marks and "Looks right", and every failure filling nothing. Through the
 * pasted-text path, with invented text; only `fetch` is replaced.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-10T15:00:00.000Z');
/** The invented unknown layout, as pasted: 23 lines, every one carrying the sentinel. */
const CLIP = UNKNOWN_LAYOUT.map((l) => l.text).join('\n');

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let readAnswer: (init: RequestInit) => Promise<Response>;
const reads: RequestInit[] = [];

const respond = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  reads.length = 0;
  readAnswer = respond(200, { ok: true, read: MODEL_REPLY });
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/ratecon/read') {
      reads.push(init!);
      return readAnswer(init!);
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

const render = async (aiReader = true) => {
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
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;
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
const readWithAi = () => buttonIn(strip(), 'Read with AI');

describe('offered only after a template miss, and only when the server offers it', () => {
  it('flag off: "Layout not recognised" and no button', async () => {
    await render(false);
    await pasteText(CLIP);
    expect(strip().textContent).toContain('Layout not recognised, nothing filled.');
    expect(readWithAi()).toBeNull();
  });

  it('flag on: the button, how many lines it sends, and what it leaves out', async () => {
    await render();
    await pasteText(CLIP);
    expect(readWithAi()).not.toBeNull();
    expect(strip().textContent).toContain('sends 23 lines, with rates, contacts, phones, emails and driver names removed');
    expect(reads).toHaveLength(0);
  });

  it('"Show what is sent": the numbered, redacted lines, and nothing it removed', async () => {
    await render();
    await pasteText(CLIP);
    const sent = strip().querySelector('[data-ratecon-sent]')!;
    expect(sent.querySelector('summary')?.textContent).toBe('Show what is sent');
    const text = sent.querySelector('pre')!.textContent!;
    expect(text).toContain('L3 Booked by: [REMOVED]');
    expect(text).toContain('L13 Fargo, ND 58102');
    for (const removed of ['612', 'dispatch@example.com', '1,850', 'Sam Placeholder', '123456']) expect(text).not.toContain(removed);
  });

  it('a document redaction cannot clear is not offered, and says why', async () => {
    await render();
    await pasteText(`Fargo, ND 58102\nwrite to ops@`);
    expect(readWithAi()).toBeNull();
    expect(strip().textContent).toContain('This document could not be prepared for reading; nothing was sent.');
  });
});

describe('a read', () => {
  it('sends the lines as n and text, fills the load, and marks every filled field as read by AI', async () => {
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    expect(reads).toHaveLength(1);
    const body = JSON.parse(String(reads[0]!.body)) as { lines: Record<string, unknown>[] };
    expect(body.lines).toHaveLength(23);
    expect(Object.keys(body.lines[0]!).sort()).toEqual(['n', 'text']);
    expect(said()).toBe('Filled 2 stops, read by AI. Check each stop against its quote, then press Looks right. Nothing is saved until Save.');
    expect(input(container!, 'Load number').value).toBe('EX-40417');
    expect(input(form(), 'Street address').value).toBe('4001 Main St');
    expect(strip().querySelector('[data-ai-to-confirm]')?.textContent).toBe('2 stops read by AI to confirm');
  });

  it('beside each AI-filled field, the quote it came from; and "Looks right" clears that stop\'s marks', async () => {
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    const street = field(form(), 'Street address').querySelector('[data-field-ai]');
    expect(street?.textContent).toBe(`Read by AI from the pasted text: “4001 Main St”`);
    await click(buttonIn(form(), 'Looks right')!);
    expect(buttonIn(form(), 'Looks right')).toBeNull();
    expect(field(form(), 'Street address').querySelector('[data-field-ai]')).toBeNull();
    // Where it came from stays; only the mark goes.
    expect(field(form(), 'Street address').querySelector('[data-field-source]')?.textContent).toContain('4001 Main St');
    expect(strip().querySelector('[data-ai-to-confirm]')?.textContent).toBe('1 stop read by AI to confirm');
  });

  it('the load number has its own confirm', async () => {
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    const loadConfirm = container!.querySelector<HTMLButtonElement>('[data-ai-confirm-load]')!;
    expect(loadConfirm.textContent).toBe('Looks right');
    await click(loadConfirm);
    expect(container!.querySelector('[data-ai-confirm-load]')).toBeNull();
    expect(input(container!, 'Load number').value).toBe('EX-40417');
  });

  it('asks before replacing what was typed, and Keep mine fills nothing', async () => {
    await render();
    await type(input(container!, 'Load number'), 'MINE-1');
    await pasteText(CLIP);
    await click(readWithAi()!);
    expect(strip().textContent).toContain('Replace the load number and stops you have entered with this rate confirmation?');
    await click(buttonIn(strip(), 'Keep mine')!);
    expect(input(container!, 'Load number').value).toBe('MINE-1');
  });
});

describe('every failure fills nothing, says one fixed sentence, and leaves the button', () => {
  it.each([
    [503, { ok: false, code: 'unavailable' }, 'The AI reader is not available right now. Nothing was filled.'],
    [429, { ok: false, code: 'capped' }, 'Today’s AI reads are used up. Type the load, or try tomorrow.'],
    [429, { error: 'Too many requests.', retryAfterSeconds: 40 }, 'Wait a minute and try again.'],
    [502, { ok: false, code: 'invalid_output' }, 'The AI read came back unusable. Nothing was filled.'],
  ] as const)('%i %j', async (status, body, sentence) => {
    readAnswer = respond(status, body);
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    expect(said()).toBe(sentence);
    expect(input(container!, 'Load number').value).toBe('');
    expect(readWithAi()).not.toBeNull();
  });

  it('a 500 gives its reference', async () => {
    readAnswer = respond(500, { ok: false, code: 'error', reference: 'RATECON-500-K9' });
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    expect(said()).toBe('The AI read failed. Nothing was filled. Reference RATECON-500-K9.');
  });

  it('a reply nothing in which follows from the text fills nothing', async () => {
    const lost = { value: 'Nowhere', quote: { line: 1, text: 'not in the text' } };
    const reply: ModelRead = {
      schemaVersion: 1,
      loadNumber: lost,
      stops: [{ type: { value: 'PU', quote: { line: 1, text: 'not in the text' } }, street: lost, city: lost, state: lost, zip: lost, appointment: { kind: 'none' } }],
    };
    readAnswer = respond(200, { ok: true, read: reply });
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    expect(said()).toBe('The AI read could not be confirmed against the text. Nothing was filled.');
    expect(input(container!, 'Load number').value).toBe('');
  });

  it('Cancel, while reading', async () => {
    readAnswer = (init) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    expect(strip().textContent).toContain('Reading with AI…');
    await click(buttonIn(strip(), 'Cancel')!);
    expect(said()).toBe('Cancelled. Nothing was filled.');
    expect(readWithAi()).not.toBeNull();
  });
});

describe('the sentinel', () => {
  it('reaches the request only inside the redacted lines, and no console call at all', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    await render();
    await pasteText(CLIP);
    await click(readWithAi()!);
    const body = JSON.parse(String(reads[0]!.body)) as { redactionVersion: string; lines: { text: string }[] };
    expect(body.redactionVersion).not.toContain(SENTINEL);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(SENTINEL);
    for (const s of spies) s.mockRestore();
  });
});
