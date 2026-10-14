import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_REPLY, SENTINEL } from '@/test/model-read-fixtures';
import { BROWSER_TIMEOUT_MS, requestModelReads } from './read-client';
import { REDACTION_VERSION, type PreparedLine } from './redact';

/**
 * The browser's half of "Read with AI" (docs/llm-reader-design.md §4, §5):
 * what it sends, and how every answer becomes a code. The network is the
 * one thing replaced.
 */

const LINES: PreparedLine[] = [
  { n: 1, page: 2, text: `Load # EX-40417 ${SENTINEL}` },
  { n: 2, page: 2, text: `Pick Up 1 ${SENTINEL}` },
];
const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const live = () => new AbortController().signal;

afterEach(() => vi.useRealTimers());

describe('what is sent', () => {
  it('the redaction version and each line as n and text — never its page', async () => {
    const fetcher = answer(200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY] });
    await requestModelReads(LINES, live(), fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ratecon/read');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      redactionVersion: REDACTION_VERSION,
      lines: [
        { n: 1, text: `Load # EX-40417 ${SENTINEL}` },
        { n: 2, text: `Pick Up 1 ${SENTINEL}` },
      ],
    });
  });
});

describe('what comes back', () => {
  it('two replies that pass the schema, A then B', async () => {
    const other = { ...MODEL_REPLY, loadNumber: null };
    expect(await requestModelReads(LINES, live(), answer(200, { ok: true, reads: [MODEL_REPLY, other] }))).toEqual({
      ok: true,
      replies: [MODEL_REPLY, other],
      readId: null,
    });
  });

  it('the read\'s id, when the server sends one: so an outcome can be linked to it', async () => {
    const readId = '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44';
    expect(await requestModelReads(LINES, live(), answer(200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY], readId }))).toEqual({
      ok: true,
      replies: [MODEL_REPLY, MODEL_REPLY],
      readId,
    });
  });

  it.each([['text', '4001 Main St'], ['a number', 7], ['an empty string', '']])('a read id that is %s is no id: the read still fills, nothing is linked', async (_, readId) => {
    const out = await requestModelReads(LINES, live(), answer(200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY], readId }));
    expect(out).toEqual({ ok: true, replies: [MODEL_REPLY, MODEL_REPLY], readId: null });
  });

  it.each([
    ['either reply failing the schema (A)', { ok: true, reads: [{ ...MODEL_REPLY, notes: 'x' }, MODEL_REPLY] }],
    ['either reply failing the schema (B)', { ok: true, reads: [MODEL_REPLY, { ...MODEL_REPLY, notes: 'x' }] }],
    ['one reply where a pair is due — the old single-read shape', { ok: true, read: MODEL_REPLY }],
    ['a list of one', { ok: true, reads: [MODEL_REPLY] }],
    ['a list of three', { ok: true, reads: [MODEL_REPLY, MODEL_REPLY, MODEL_REPLY] }],
    ['no replies at all', { ok: true }],
  ])('%s is invalid_output, checked again here: the pair fails as a whole', async (_, body) => {
    expect(await requestModelReads(LINES, live(), answer(200, body))).toEqual({ ok: false, code: 'invalid_output' });
  });

  it.each([
    [503, 'unavailable'],
    [504, 'timeout'],
    [429, 'capped'],
    [422, 'not_redacted'],
    [409, 'outdated'],
  ] as const)('%i with its code: that code', async (status, code) => {
    expect(await requestModelReads(LINES, live(), answer(status, { ok: false, code }))).toEqual({ ok: false, code });
  });

  it('every code the server can send is read as itself — vendor_capped is not mistaken for unavailable by its 503', async () => {
    const { READ_MESSAGES } = await import('./read-codes');
    for (const code of Object.keys(READ_MESSAGES)) {
      expect(await requestModelReads(LINES, live(), answer(503, { ok: false, code })), code).toEqual({ ok: false, code });
    }
  });

  it('the shared 429, which carries no code, is rate_limited', async () => {
    const out = await requestModelReads(LINES, live(), answer(429, { error: 'Too many requests.', retryAfterSeconds: 40 }));
    expect(out).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('a 500 keeps its reference, so the dispatcher can quote it', async () => {
    const out = await requestModelReads(LINES, live(), answer(500, { ok: false, code: 'error', reference: 'RATECON-500-ABC' }));
    expect(out).toEqual({ ok: false, code: 'error', reference: 'RATECON-500-ABC' });
  });

  it('a code it does not know, or no JSON at all, is read from the status alone', async () => {
    expect(await requestModelReads(LINES, live(), answer(403, { ok: false, code: 'something-new' }))).toEqual({ ok: false, code: 'forbidden' });
    const notJson = vi.fn(async () => new Response('<html>gateway</html>', { status: 502 }));
    expect(await requestModelReads(LINES, live(), notJson)).toEqual({ ok: false, code: 'unavailable' });
  });

  it('a network failure is unavailable', async () => {
    const down = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await requestModelReads(LINES, live(), down)).toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('stopping', () => {
  /** A fetch that answers only when aborted, as a real one would. */
  const hanging = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );

  it('Cancel is cancelled', async () => {
    const abort = new AbortController();
    const pending = requestModelReads(LINES, abort.signal, hanging);
    abort.abort();
    expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  });

  it('the browser gives up after its own timeout, and says timeout', async () => {
    vi.useFakeTimers();
    const pending = requestModelReads(LINES, live(), hanging);
    await vi.advanceTimersByTimeAsync(BROWSER_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: 'timeout' });
  });
});
