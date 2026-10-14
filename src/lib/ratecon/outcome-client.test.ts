import { describe, expect, it, vi } from 'vitest';
import { SENTINEL } from '@/test/model-read-fixtures';
import { postOutcome } from './outcome-client';
import type { OutcomeBody } from './outcome-codes';

/**
 * The browser's half of "what the dispatcher did with an AI read": it sends
 * the read id and the counts, and says whether they were recorded. It NEVER
 * throws: it runs after a load has saved, and must not touch the save.
 */

const body: OutcomeBody = {
  readId: '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44',
  fields: [{ field: 'street', kept: 1, changed: 1, cleared: 0, blankFilled: 0, blankLeft: 0 }],
};
const answer = (status: number, payload: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }));

describe('what is sent', () => {
  it('the read id and the counts, as JSON, to the outcome route — and nothing else', async () => {
    const fetcher = answer(200, { ok: true, recorded: true });
    await postOutcome(body, fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ratecon/outcome');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect(String(init.body)).not.toContain(SENTINEL);
  });

  it('asks the browser to finish it even if the page moves on', async () => {
    const fetcher = answer(200, { ok: true, recorded: true });
    await postOutcome(body, fetcher);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].keepalive).toBe(true);
  });
});

describe('what it says', () => {
  it('recorded, or ignored as a second post: both are fine', async () => {
    expect(await postOutcome(body, answer(200, { ok: true, recorded: true }))).toBe(true);
    expect(await postOutcome(body, answer(200, { ok: true, recorded: false }))).toBe(true);
  });

  it.each([
    [404, { ok: false, code: 'disabled' }],
    [404, { ok: false, code: 'unknown_read' }],
    [400, { ok: false, code: 'bad_request' }],
    [429, { error: 'Too many requests.' }],
    [500, { ok: false, code: 'error', reference: 'RATECON-500-X' }],
    [200, { unexpected: true }],
  ])('%i %j is not recorded', async (status, payload) => {
    expect(await postOutcome(body, answer(status, payload))).toBe(false);
  });

  it('not JSON at all (a gateway page) is not recorded', async () => {
    expect(await postOutcome(body, vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })))).toBe(false);
  });

  it('a network failure is not recorded, and is not thrown', async () => {
    await expect(postOutcome(body, vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))).resolves.toBe(false);
  });
});
