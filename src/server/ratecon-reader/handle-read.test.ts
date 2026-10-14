import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { sql } from 'drizzle-orm';
import { commitDb, describeDb } from '@/test/db';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { REDACTION_VERSION, prepareForReading } from '@/lib/ratecon/redact';
import type { Db } from '@/server/audit';

/**
 * `POST /api/ratecon/read` (docs/llm-reader-design.md §4, §5): the real
 * handler, the real rate limiter, the real counts table (in `fleet_commit`:
 * a read commits its row), the fake vendor, real timers. Only the session is
 * replaced; `requireRole` keeps the real rank check.
 *
 * Every invented line carries the sentinel, and no test may let it reach a
 * console call, a response body or a row.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', async () => {
  const { rankOf } = await import('@/lib/roles');
  class AuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403,
    ) {
      super(message);
      this.name = 'AuthError';
    }
  }
  const requireUser = vi.fn();
  const requireRole = async (minimum: Parameters<typeof rankOf>[0]) => {
    const user = (await requireUser()) as { role: Parameters<typeof rankOf>[0]; fullName: string };
    if (rankOf(user.role) < rankOf(minimum)) throw new AuthError(`Requires ${minimum}`, 403);
    return user;
  };
  return { AuthError, requireUser, requireRole };
});

const { AuthError, requireUser } = await import('@/lib/auth');
const { FakeReaderAdapter } = await import('./fake');
const { AnthropicReaderAdapter } = await import('./anthropic');
const { handleRead } = await import('./handle-read');
type FakeStep = ConstructorParameters<typeof FakeReaderAdapter>[0][number];

const prepared = (() => {
  const p = prepareForReading(UNKNOWN_LAYOUT);
  if (!p.ok) throw new Error(p.reason);
  return p;
})();
const SENT = prepared.lines.map(({ n, text }) => ({ n, text }));
const BODY = { redactionVersion: REDACTION_VERSION, lines: SENT };

let seq = 0;
const used: string[] = [];
const newUser = (role: 'viewer' | 'dispatcher' | 'admin' = 'dispatcher') => {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(4, '0')}0000feed`;
  used.push(id);
  vi.mocked(requireUser).mockResolvedValue({ id, email: null, fullName: 'Dee Dispatcher', role });
  return id;
};

const NOW = new Date('2026-10-13T03:00:00Z'); // 22:00 on the 12th in Chicago
const settings = { enabled: true, vendor: 'fake' as const, userCap: 25, dailyCap: 100, tz: 'America/Chicago' };
const USAGE = { inputTokens: 3200, outputTokens: 540 };
/** The same step for both calls of a pair. */
const both = (step: FakeStep): FakeStep[] => [step, step];
const deps = (over: { steps?: FakeStep[]; db?: Db; timeoutMs?: number; enabled?: boolean; userCap?: number } = {}) => {
  const fake = new FakeReaderAdapter(over.steps ?? both({ reply: MODEL_REPLY, usage: USAGE }));
  return {
    fake,
    deps: {
      db: over.db ?? commitDb(),
      settings: { ...settings, enabled: over.enabled ?? true, userCap: over.userCap ?? 25 },
      adapter: () => fake,
      timeoutMs: over.timeoutMs ?? 25_000,
      now: () => NOW,
    },
  };
};
let address = 0;
const request = (body: unknown, init: { raw?: string; signal?: AbortSignal; contentLength?: string } = {}) => {
  address += 1;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(address / 250)}.${address % 250}` };
  if (init.contentLength) headers['content-length'] = init.contentLength;
  return new Request('http://localhost/api/ratecon/read', {
    method: 'POST',
    headers,
    body: init.raw ?? JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
};
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const rows = async (userId: string) =>
  (await commitDb().execute(
    sql`select outcome, vendor, lines_sent, input_tokens, output_tokens from ratecon_ai_reads where user_id = ${userId} order by created_at`,
  )) as unknown as Record<string, unknown>[];

let consoleSpies: MockInstance[] = [];
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});
afterEach(async () => {
  const said = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
  for (const s of consoleSpies) s.mockRestore();
  vi.mocked(requireUser).mockReset();
  expect(said, 'document text reached a console call').not.toContain(SENTINEL);
  if (used.length > 0) await commitDb().execute(sql`delete from ratecon_ai_reads where user_id in ${sql.raw(`(${used.map((u) => `'${u}'`).join(',')})`)}`);
});

describeDb('POST /api/ratecon/read: who may read', () => {
  it('no session: 401, and the vendor is never called', async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError('Not signed in', 401));
    const { fake, deps: d } = deps();
    const r = await handleRead(request(BODY), d);
    expect([r.status, await json(r)]).toEqual([401, { ok: false, code: 'forbidden' }]);
    expect(fake.received).toHaveLength(0);
  });

  it('a viewer: 403', async () => {
    newUser('viewer');
    const { fake, deps: d } = deps();
    expect((await handleRead(request(BODY), d)).status).toBe(403);
    expect(fake.received).toHaveLength(0);
  });

  it('the flag off: 404 disabled, nothing counted', async () => {
    const id = newUser();
    const { fake, deps: d } = deps({ enabled: false });
    const r = await handleRead(request(BODY), d);
    expect([r.status, await json(r)]).toEqual([404, { ok: false, code: 'disabled' }]);
    expect(fake.received).toHaveLength(0);
    expect(await rows(id)).toEqual([]);
  });
});

describeDb('POST /api/ratecon/read: a read is a pair', () => {
  it('makes TWO calls with the same lines and today in the dispatch zone, returns both replies, and counts ONE read', async () => {
    const id = newUser();
    const { fake, deps: d } = deps();
    const r = await handleRead(request(BODY), d);
    expect([r.status, await json(r)]).toEqual([200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY] }]);
    // 03:00 UTC on the 13th is 22:00 on the 12th in Chicago.
    expect(fake.received).toEqual([
      { lines: SENT, today: '2026-10-12' },
      { lines: SENT, today: '2026-10-12' },
    ]);
    // One row for the pair; its tokens are both calls'.
    expect(await rows(id)).toEqual([{ outcome: 'ok', vendor: 'fake', lines_sent: 20, input_tokens: 6400, output_tokens: 1080 }]);
  });

  it('returns each call\'s own reply, A then B', async () => {
    newUser();
    const other = { ...MODEL_REPLY, loadNumber: null };
    const r = await handleRead(request(BODY), deps({ steps: [{ reply: MODEL_REPLY }, { reply: other }] }).deps);
    expect(await json(r)).toEqual({ ok: true, reads: [MODEL_REPLY, other] });
  });

  it('the two calls run at the same time, so a read stays inside the time limit', async () => {
    newUser();
    const { fake, deps: d } = deps({ steps: both({ delayMs: 400, then: { reply: MODEL_REPLY } }) });
    const pending = handleRead(request(BODY), d);
    // Well inside the first call's delay: if they ran one after the other, only one would have been made.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fake.received).toHaveLength(2);
    expect((await pending).status).toBe(200);
  });

  it('an admin may read too', async () => {
    newUser('admin');
    expect((await handleRead(request(BODY), deps().deps)).status).toBe(200);
  });
});

describeDb('POST /api/ratecon/read: a pair that fails fails as a whole, and returns neither reply', () => {
  const STEP = { reply: MODEL_REPLY, usage: USAGE };

  it.each([
    ['A fails, B answers', [{ fail: 'timeout' }, STEP], 504, 'timeout'],
    ['B fails, A answers', [STEP, { fail: 'unavailable' }], 503, 'unavailable'],
    ['both fail: read A\'s code', [{ fail: 'refused' }, { fail: 'timeout' }], 422, 'refused'],
    ['A is cut off by the vendor\'s spending limit', [{ fail: 'vendor_capped' }, STEP], 503, 'vendor_capped'],
    ['B is a malformed reply', [STEP, { fail: 'malformed' }], 502, 'invalid_output'],
  ] as const)('%s: its code, and no read in the body', async (_, steps, status, code) => {
    const id = newUser();
    const r = await handleRead(request(BODY), deps({ steps: [...steps] as FakeStep[] }).deps);
    const body = await json(r);
    expect([r.status, body]).toEqual([status, { ok: false, code }]);
    expect(JSON.stringify(body)).not.toContain('reads');
    expect(await rows(id)).toHaveLength(1);
    expect((await rows(id))[0]).toMatchObject({ outcome: code });
  });

  it('A fails the schema, B is fine: invalid_output, and nothing of either reply is returned', async () => {
    const id = newUser();
    const broken = { ...MODEL_REPLY, notes: `free text ${SENTINEL}` };
    const r = await handleRead(request(BODY), deps({ steps: [{ reply: broken }, STEP] }).deps);
    const text = await r.text();
    expect([r.status, JSON.parse(text)]).toEqual([502, { ok: false, code: 'invalid_output' }]);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('Fargo');
    expect((await rows(id))[0]).toMatchObject({ outcome: 'invalid_output' });
  });

  it('B fails the schema, A is fine: the same', async () => {
    const id = newUser();
    const broken = { ...MODEL_REPLY, schemaVersion: 2 };
    const r = await handleRead(request(BODY), deps({ steps: [STEP, { reply: broken }] }).deps);
    const text = await r.text();
    expect([r.status, JSON.parse(text)]).toEqual([502, { ok: false, code: 'invalid_output' }]);
    expect(text).not.toContain('Fargo');
    expect((await rows(id))[0]).toMatchObject({ outcome: 'invalid_output' });
  });

  it('a pair where one call failed is still ONE read against the cap, with the tokens of every call that was billed', async () => {
    const id = newUser();
    const { fake, deps: d } = deps({
      userCap: 1,
      steps: [STEP, { fail: 'refused', usage: { inputTokens: 3000, outputTokens: 12 } }],
    });
    expect((await handleRead(request(BODY), d)).status).toBe(422);
    expect(await rows(id)).toEqual([{ outcome: 'refused', vendor: 'fake', lines_sent: 20, input_tokens: 6200, output_tokens: 552 }]);
    // The cap of 1 is spent by that one failed pair.
    const next = await handleRead(request(BODY), d);
    expect([next.status, await json(next)]).toEqual([429, { ok: false, code: 'capped' }]);
    expect(fake.received).toHaveLength(2);
  });

  it('one log line for a failed pair, with the failing read\'s status — nothing else', async () => {
    newUser();
    await handleRead(request(BODY), deps({ steps: [STEP, { fail: 'unavailable', vendorStatus: 401 }] }).deps);
    expect(consoleSpies[3]!.mock.calls).toEqual([
      ['ratecon read failed', { reference: expect.stringMatching(/^RATECON-503-[0-9A-Z]+$/), code: 'unavailable', errorName: 'AdapterFailure', vendorStatus: 401 }],
    ]);
  });
});

describeDb('POST /api/ratecon/read: refused before the vendor, and not counted', () => {
  it.each([
    ['a body over 64 KB by its length', 413, 'too_large', { contentLength: String(64 * 1024 + 1) }],
    ['a body over 64 KB with no length', 413, 'too_large', { raw: JSON.stringify({ ...BODY, pad: 'x'.repeat(70 * 1024) }) }],
    ['not JSON', 400, 'bad_request', { raw: '{"lines": [' }],
  ] as const)('%s: %i %s', async (_, status, code, init) => {
    const id = newUser();
    const { fake, deps: d } = deps();
    const r = await handleRead(request(BODY, init), d);
    expect([r.status, await json(r)]).toEqual([status, { ok: false, code }]);
    expect(fake.received).toHaveLength(0);
    expect(await rows(id)).toEqual([]);
  });

  it('more lines than the limit: 413', async () => {
    newUser();
    const lines = Array.from({ length: 401 }, (_, i) => ({ n: i + 1, text: `Fargo, ND 58102 ${SENTINEL}` }));
    const r = await handleRead(request({ ...BODY, lines }), deps().deps);
    expect([r.status, await json(r)]).toEqual([413, { ok: false, code: 'too_large' }]);
  });

  it('more text in all than the limit: 413', async () => {
    newUser();
    const lines = Array.from({ length: 60 }, (_, i) => ({ n: i + 1, text: 'y'.repeat(450) }));
    expect((await handleRead(request({ ...BODY, lines }), deps().deps)).status).toBe(413);
  });

  it('a line carrying anything but n and text — a page — is refused: 400', async () => {
    newUser();
    const lines = SENT.map((l) => ({ ...l, page: 2 }));
    const { fake, deps: d } = deps();
    const r = await handleRead(request({ ...BODY, lines }), d);
    expect([r.status, await json(r)]).toEqual([400, { ok: false, code: 'bad_request' }]);
    expect(fake.received).toHaveLength(0);
  });

  it('another redaction version: 409 outdated', async () => {
    newUser();
    const r = await handleRead(request({ ...BODY, redactionVersion: 'redact-1999-01-01.0' }), deps().deps);
    expect([r.status, await json(r)]).toEqual([409, { ok: false, code: 'outdated' }]);
  });

  it('a planted phone the browser should have masked: 422, nothing sent, nothing counted', async () => {
    const id = newUser();
    const lines = [...SENT, { n: SENT.length + 1, text: `Call 612-555-0147 ${SENTINEL}` }];
    const { fake, deps: d } = deps();
    const r = await handleRead(request({ ...BODY, lines }), d);
    expect([r.status, await json(r)]).toEqual([422, { ok: false, code: 'not_redacted' }]);
    expect(fake.received).toHaveLength(0);
    expect(await rows(id)).toEqual([]);
  });
});

describeDb('POST /api/ratecon/read: limits', () => {
  it('a fourth read inside a minute: 429 rate_limited', async () => {
    newUser();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await handleRead(request(BODY), deps().deps)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('the user cap counts READS, not calls: the second read of the day is 429 capped, and the vendor was called only for the first pair', async () => {
    const id = newUser();
    const { fake, deps: d } = deps({ userCap: 1, steps: [...both({ reply: MODEL_REPLY }), ...both({ reply: MODEL_REPLY })] });
    expect((await handleRead(request(BODY), d)).status).toBe(200);
    const second = await handleRead(request(BODY), d);
    expect([second.status, await json(second)]).toEqual([429, { ok: false, code: 'capped' }]);
    expect(fake.received).toHaveLength(2);
    expect(await rows(id)).toHaveLength(1);
  });
});

describeDb('POST /api/ratecon/read: when the vendor fails (both calls), nothing is returned but the code, and the row says so', () => {
  it.each([
    ['timeout', 504, 'timeout'],
    ['unavailable', 503, 'unavailable'],
    ['vendor_capped', 503, 'vendor_capped'],
    ['refused', 422, 'refused'],
    ['malformed', 502, 'invalid_output'],
  ] as const)('%s: %i %s', async (fail, status, code) => {
    const id = newUser();
    const r = await handleRead(request(BODY), deps({ steps: both({ fail, vendorStatus: 500 }) }).deps);
    expect([r.status, await json(r)]).toEqual([status, { ok: false, code }]);
    expect((await rows(id))[0]).toMatchObject({ outcome: code === 'invalid_output' ? 'invalid_output' : code });
  });

  it('the server\'s own timeout ends a vendor that does not answer — both calls — and the pair is one row', async () => {
    const id = newUser();
    const { fake, deps: d } = deps({ timeoutMs: 50, steps: both({ delayMs: 5_000, then: { reply: MODEL_REPLY } }) });
    const r = await handleRead(request(BODY), d);
    expect([r.status, await json(r)]).toEqual([504, { ok: false, code: 'timeout' }]);
    expect(fake.signals).toHaveLength(2);
    expect(fake.signals.every((signal) => signal.aborted)).toBe(true);
    expect(await rows(id)).toHaveLength(1);
    expect((await rows(id))[0]).toMatchObject({ outcome: 'timeout' });
  });

  it('the dispatcher cancelling is recorded as cancelled, not as a timeout, and cancels BOTH calls', async () => {
    const id = newUser();
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 30);
    const { fake, deps: d } = deps({ steps: both({ delayMs: 5_000, then: { reply: MODEL_REPLY } }) });
    const started = Date.now();
    const r = await handleRead(request(BODY, { signal: abort.signal }), d);
    expect(await json(r)).toEqual({ ok: false, code: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fake.signals).toHaveLength(2);
    expect(fake.signals.every((signal) => signal.aborted)).toBe(true);
    expect(await rows(id)).toHaveLength(1);
    expect((await rows(id))[0]).toMatchObject({ outcome: 'cancelled' });
  });

  it('anything unexpected is a 500 with a reference, logged without its message', async () => {
    newUser();
    const failing = { transaction: async () => Promise.reject(new Error(`boom ${SENTINEL}`)) } as unknown as Db;
    const r = await handleRead(request(BODY), deps({ db: failing }).deps);
    const body = await json(r);
    expect(r.status).toBe(500);
    expect(body).toMatchObject({ ok: false, code: 'error' });
    expect(body.reference).toMatch(/^RATECON-500-[0-9A-Z]+$/);
    const errorSpy = consoleSpies[3]!;
    expect(errorSpy.mock.calls).toEqual([['ratecon read failed', { reference: body.reference, code: 'error', errorName: 'Error', vendorStatus: null }]]);
  });
});

describeDb('POST /api/ratecon/read: what a failed read leaves behind', () => {
  it('a refusal the vendor billed: its tokens are in the row, both calls\'', async () => {
    const id = newUser();
    await handleRead(request(BODY), deps({ steps: both({ fail: 'refused', usage: { inputTokens: 3000, outputTokens: 12 } }) }).deps);
    expect(await rows(id)).toEqual([{ outcome: 'refused', vendor: 'fake', lines_sent: 20, input_tokens: 6000, output_tokens: 24 }]);
  });

  it('a refusal that billed nothing leaves the token counts empty, not zero', async () => {
    const id = newUser();
    await handleRead(request(BODY), deps({ steps: both({ fail: 'unavailable' }) }).deps);
    expect(await rows(id)).toEqual([{ outcome: 'unavailable', vendor: 'fake', lines_sent: 20, input_tokens: null, output_tokens: null }]);
  });

  it('one log line: the code and the vendor\'s status, so a revoked key shows as a 401 — nothing else', async () => {
    newUser();
    await handleRead(request(BODY), deps({ steps: both({ fail: 'unavailable', vendorStatus: 401 }) }).deps);
    expect(consoleSpies[3]!.mock.calls).toEqual([
      ['ratecon read failed', { reference: expect.stringMatching(/^RATECON-503-[0-9A-Z]+$/), code: 'unavailable', errorName: 'AdapterFailure', vendorStatus: 401 }],
    ]);
  });

  it('a cancel is not a fault, and is not logged', async () => {
    newUser();
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 30);
    await handleRead(request(BODY, { signal: abort.signal }), deps({ steps: both({ delayMs: 5_000, then: { reply: MODEL_REPLY } }) }).deps);
    expect(consoleSpies[3]!.mock.calls).toEqual([]);
  });
});

describeDb('POST /api/ratecon/read: through the real Anthropic adapter, on an injected transport', () => {
  const KEY = 'sk-ant-api03-INVENTED-route-test-key';
  const viaAnthropic = (answer: Response) => {
    // A Response body reads once, and a read makes two calls: each gets its own copy.
    const fetch = (async () => answer.clone()) as unknown as typeof globalThis.fetch;
    const { deps: d } = deps();
    return {
      ...d,
      settings: { ...d.settings, vendor: 'anthropic' as const },
      adapter: () => new AnthropicReaderAdapter({ apiKey: KEY, model: 'claude-haiku-5-5', fetch }),
    };
  };
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('a structured reply to each call: 200 with both reads, and the row counts both calls\' Anthropic tokens', async () => {
    const id = newUser();
    const r = await handleRead(
      request(BODY),
      viaAnthropic(
        answer(200, {
          id: 'msg_invented',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: JSON.stringify(MODEL_REPLY) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 2900, output_tokens: 700 },
        }),
      ),
    );
    expect([r.status, await json(r)]).toEqual([200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY] }]);
    expect(await rows(id)).toEqual([{ outcome: 'ok', vendor: 'anthropic', lines_sent: 20, input_tokens: 5800, output_tokens: 1400 }]);
  });

  it('the prepaid balance run dry: vendor_capped, and the vendor\'s status reaches the log', async () => {
    const id = newUser();
    const r = await handleRead(
      request(BODY),
      viaAnthropic(
        answer(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits. ${KEY}`,
          },
        }),
      ),
    );
    expect([r.status, await json(r)]).toEqual([503, { ok: false, code: 'vendor_capped' }]);
    expect((await rows(id))[0]).toMatchObject({ outcome: 'vendor_capped', vendor: 'anthropic' });
    expect(consoleSpies[3]!.mock.calls).toEqual([
      ['ratecon read failed', { reference: expect.stringMatching(/^RATECON-503-/), code: 'vendor_capped', errorName: 'AdapterFailure', vendorStatus: 400 }],
    ]);
    expect(JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls))).not.toContain(KEY);
  });

  it('an undocumented 4xx stays unavailable, and its status still reaches the log', async () => {
    newUser();
    await handleRead(
      request(BODY),
      viaAnthropic(answer(400, { type: 'error', error: { type: 'invalid_request_error', message: `something new ${KEY}` } })),
    );
    expect(consoleSpies[3]!.mock.calls).toEqual([
      ['ratecon read failed', { reference: expect.stringMatching(/^RATECON-503-/), code: 'unavailable', errorName: 'AdapterFailure', vendorStatus: 400 }],
    ]);
  });

  it('the account\'s spend limit: 503 vendor_capped, and neither the key nor the text in the body, the log or the row', async () => {
    const id = newUser();
    const r = await handleRead(
      request(BODY),
      viaAnthropic(
        answer(400, {
          type: 'error',
          error: { type: 'invalid_request_error', message: `You have reached your specified API usage limits. ${SENTINEL} ${KEY}` },
        }),
      ),
    );
    const body = await r.text();
    expect([r.status, JSON.parse(body)]).toEqual([503, { ok: false, code: 'vendor_capped' }]);
    const row = await rows(id);
    expect(row).toEqual([{ outcome: 'vendor_capped', vendor: 'anthropic', lines_sent: 20, input_tokens: null, output_tokens: null }]);
    const everything = JSON.stringify([body, row, consoleSpies.flatMap((s) => s.mock.calls)]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(SENTINEL);
  });
});

