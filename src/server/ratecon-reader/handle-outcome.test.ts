import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { sql } from 'drizzle-orm';
import { commitDb, describeDb } from '@/test/db';
import { SENTINEL } from '@/test/model-read-fixtures';
import type { Db } from '@/server/audit';

/**
 * `POST /api/ratecon/outcome` (docs/llm-reader-design.md §4): what the
 * dispatcher did with an AI read, as counts. The real handler, the real rate
 * limiter, the real tables (in `fleet_commit`: an outcome commits). Only the
 * session is replaced; `requireRole` keeps the real rank check.
 *
 * The browser is untrusted: the body is parsed strictly, the read must be the
 * caller's own and have answered, and nothing in the body may be stored but
 * the counts. Every invented value carries the sentinel; no test may let it
 * reach a row, a response or a console call.
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
    const user = (await requireUser()) as { role: Parameters<typeof rankOf>[0] };
    if (rankOf(user.role) < rankOf(minimum)) throw new AuthError(`Requires ${minimum}`, 403);
    return user;
  };
  return { AuthError, requireUser, requireRole };
});

const { AuthError, requireUser } = await import('@/lib/auth');
const { handleOutcome } = await import('./handle-outcome');

let seq = 0;
const users: string[] = [];
const newUser = (role: 'viewer' | 'dispatcher' | 'admin' = 'dispatcher') => {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(4, '0')}0000beef`;
  users.push(id);
  vi.mocked(requireUser).mockResolvedValue({ id, email: null, fullName: 'Dee Dispatcher', role });
  return id;
};

const settings = { enabled: true, vendor: 'fake' as const, userCap: 25, dailyCap: 100, tz: 'America/Chicago' };
const deps = (over: { db?: Db; enabled?: boolean } = {}) => ({ db: over.db ?? commitDb(), settings: { ...settings, enabled: over.enabled ?? true } });

/** A read, as the route's reservation leaves it. */
const readFor = async (userId: string, outcome: 'ok' | 'pending' | 'timeout' = 'ok') =>
  ((await commitDb().execute(sql`insert into ratecon_ai_reads (user_id, vendor, lines_sent, outcome) values (${userId}, 'fake', 20, ${outcome}::ratecon_ai_outcome) returning id`)) as unknown as { id: string }[])[0]!.id;

let address = 0;
const request = (body: unknown, init: { raw?: string; contentLength?: string } = {}) => {
  address += 1;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `10.8.${Math.floor(address / 250)}.${address % 250}` };
  if (init.contentLength) headers['content-length'] = init.contentLength;
  return new Request('http://localhost/api/ratecon/outcome', { method: 'POST', headers, body: init.raw ?? JSON.stringify(body) });
};
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

const field = (name: string, over: Record<string, unknown> = {}) => ({ field: name, kept: 0, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0, ...over });
const stored = async (readId: string) =>
  (await commitDb().execute(sql`
    select field::text as field, kept, changed, cleared, blank_filled as "blankFilled", blank_left as "blankLeft"
    from ratecon_ai_outcome_fields where read_id = ${readId} order by field`)) as unknown as Record<string, unknown>[];
const layoutOf = async (readId: string) =>
  ((await commitDb().execute(sql`select layout from ratecon_ai_outcomes where read_id = ${readId}`)) as unknown as { layout: string[] }[])[0]?.layout;
const parents = async (readId: string) =>
  ((await commitDb().execute(sql`select count(*)::int as n from ratecon_ai_outcomes where read_id = ${readId}`)) as unknown as { n: number }[])[0]!.n;
const everything = async () =>
  JSON.stringify(await commitDb().execute(sql`select o.*, f.* from ratecon_ai_outcomes o left join ratecon_ai_outcome_fields f using (read_id)`));

let consoleSpies: MockInstance[] = [];
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});
afterEach(async () => {
  const said = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
  for (const s of consoleSpies) s.mockRestore();
  vi.mocked(requireUser).mockReset();
  expect(said, 'a sentinel value reached a console call').not.toContain(SENTINEL);
  if (users.length > 0) await commitDb().execute(sql`delete from ratecon_ai_reads where user_id in ${sql.raw(`(${users.map((u) => `'${u}'`).join(',')})`)}`);
});

describeDb('POST /api/ratecon/outcome: a read\'s outcome is stored once', () => {
  it('valid counts are stored, per field name, linked to the read', async () => {
    const id = newUser();
    const readId = await readFor(id);
    const r = await handleOutcome(request({ readId, fields: [field('street', { kept: 1, changed: 1 }), field('load_number', { cleared: 1 }), field('appointment', { kept: 1, blankLeft: 1 })] }), deps());
    expect([r.status, await json(r)]).toEqual([200, { ok: true, recorded: true }]);
    expect(await parents(readId)).toBe(1);
    expect(await stored(readId)).toEqual([
      { field: 'load_number', kept: 0, changed: 0, cleared: 1, blankFilled: 0, blankLeft: 0 },
      { field: 'street', kept: 1, changed: 1, cleared: 0, blankFilled: 0, blankLeft: 0 },
      { field: 'appointment', kept: 1, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 1 },
    ].sort((a, b) => String(a.field).localeCompare(String(b.field))));
  });

  it('its cost sits beside it: the outcome joins the read\'s counts row', async () => {
    const id = newUser();
    const readId = await readFor(id);
    await handleOutcome(request({ readId, fields: [field('zip', { kept: 2 })] }), deps());
    const joined = (await commitDb().execute(sql`
      select r.outcome::text as read_outcome, f.field::text as field, f.kept from ratecon_ai_outcome_fields f join ratecon_ai_reads r on r.id = f.read_id where f.read_id = ${readId}`)) as unknown as Record<string, unknown>[];
    expect(joined).toEqual([{ read_outcome: 'ok', field: 'zip', kept: 2 }]);
  });

  it('a second post for the same read is ignored: the first counts stand, and it says it recorded nothing', async () => {
    const id = newUser();
    const readId = await readFor(id);
    await handleOutcome(request({ readId, fields: [field('street', { kept: 2 })] }), deps());
    const again = await handleOutcome(request({ readId, fields: [field('street', { changed: 2 }), field('city', { kept: 2 })] }), deps());
    expect([again.status, await json(again)]).toEqual([200, { ok: true, recorded: false }]);
    expect(await parents(readId)).toBe(1);
    expect(await stored(readId)).toEqual([{ field: 'street', kept: 2, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0 }]);
  });

  it('two posts at the same moment store one outcome', async () => {
    const id = newUser();
    const readId = await readFor(id);
    const results = await Promise.all([
      handleOutcome(request({ readId, fields: [field('street', { kept: 2 })] }), deps()),
      handleOutcome(request({ readId, fields: [field('street', { changed: 2 })] }), deps()),
    ]);
    expect((await Promise.all(results.map(json))).map((b) => b.recorded).sort()).toEqual([false, true]);
    expect(await parents(readId)).toBe(1);
    expect(await stored(readId)).toHaveLength(1);
  });

  it('the layout fingerprint is stored on the outcome row, as the hashes it was given', async () => {
    const id = newUser();
    const readId = await readFor(id);
    const layout = ['00000001', '0a1b2c3d', 'ffffffff'];
    const r = await handleOutcome(request({ readId, fields: [field('street', { kept: 1 })], layout }), deps());
    expect([r.status, await json(r)]).toEqual([200, { ok: true, recorded: true }]);
    expect(await layoutOf(readId)).toEqual(layout);
    expect(await stored(readId)).toHaveLength(1);
  });

  it('64 hashes are stored; an empty fingerprint is stored empty; none given is empty', async () => {
    const id = newUser();
    const sixtyFour = Array.from({ length: 64 }, (_, i) => i.toString(16).padStart(8, '0'));
    const a = await readFor(id);
    const b = await readFor(id);
    const c = await readFor(id);
    await handleOutcome(request({ readId: a, fields: [field('zip', { kept: 1 })], layout: sixtyFour }), deps());
    await handleOutcome(request({ readId: b, fields: [field('zip', { kept: 1 })], layout: [] }), deps());
    await handleOutcome(request({ readId: c, fields: [field('zip', { kept: 1 })] }), deps());
    expect(await layoutOf(a)).toEqual(sixtyFour);
    expect(await layoutOf(b)).toEqual([]);
    expect(await layoutOf(c)).toEqual([]);
  });

  it('a second post is ignored whole: its layout does not replace the first', async () => {
    const id = newUser();
    const readId = await readFor(id);
    await handleOutcome(request({ readId, fields: [field('street', { kept: 2 })], layout: ['00000001'] }), deps());
    const again = await handleOutcome(request({ readId, fields: [field('street', { changed: 2 })], layout: ['00000002', '00000003'] }), deps());
    expect([again.status, await json(again)]).toEqual([200, { ok: true, recorded: false }]);
    expect(await layoutOf(readId)).toEqual(['00000001']);
  });

  it('two posts at the same moment store one layout, whole', async () => {
    const id = newUser();
    const readId = await readFor(id);
    await Promise.all([
      handleOutcome(request({ readId, fields: [field('street', { kept: 2 })], layout: ['00000001'] }), deps()),
      handleOutcome(request({ readId, fields: [field('street', { changed: 2 })], layout: ['00000002'] }), deps()),
    ]);
    const layout = await layoutOf(readId);
    expect([['00000001'], ['00000002']]).toContainEqual(layout);
    expect(await stored(readId)).toHaveLength(1);
  });

  it('an admin may record too', async () => {
    const id = newUser('admin');
    const readId = await readFor(id);
    expect((await handleOutcome(request({ readId, fields: [field('city', { kept: 1 })] }), deps())).status).toBe(200);
  });
});

describeDb('POST /api/ratecon/outcome: refused, and nothing stored', () => {
  const noRows = async (readId: string) => {
    expect(await parents(readId)).toBe(0);
    expect(await stored(readId)).toEqual([]);
  };

  it('no session: 401', async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError('Not signed in', 401));
    const r = await handleOutcome(request({ readId: '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44', fields: [field('street', { kept: 1 })] }), deps());
    expect([r.status, await json(r)]).toEqual([401, { ok: false, code: 'forbidden' }]);
  });

  it('a viewer: 403', async () => {
    const id = newUser('viewer');
    const readId = await readFor(id);
    const r = await handleOutcome(request({ readId, fields: [field('street', { kept: 1 })] }), deps());
    expect(r.status).toBe(403);
    await noRows(readId);
  });

  it('the reader off: 404, nothing stored', async () => {
    const id = newUser();
    const readId = await readFor(id);
    const r = await handleOutcome(request({ readId, fields: [field('street', { kept: 1 })] }), deps({ enabled: false }));
    expect([r.status, await json(r)]).toEqual([404, { ok: false, code: 'disabled' }]);
    await noRows(readId);
  });

  it('a read that is another user\'s: refused the same way as one that does not exist', async () => {
    const mine = newUser();
    const theirs = `00000000-0000-4000-8000-${String(seq + 1000).padStart(4, '0')}0000cafe`;
    users.push(theirs);
    const theirRead = await readFor(theirs);
    void mine;
    const r = await handleOutcome(request({ readId: theirRead, fields: [field('street', { kept: 1 })] }), deps());
    expect([r.status, await json(r)]).toEqual([404, { ok: false, code: 'unknown_read' }]);
    await noRows(theirRead);
    const ghost = await handleOutcome(request({ readId: '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44', fields: [field('street', { kept: 1 })] }), deps());
    expect([ghost.status, await json(ghost)]).toEqual([404, { ok: false, code: 'unknown_read' }]);
  });

  it.each(['pending', 'timeout'] as const)('a read that did not answer (%s) cannot have an outcome', async (state) => {
    const id = newUser();
    const readId = await readFor(id, state);
    const r = await handleOutcome(request({ readId, fields: [field('street', { kept: 1 })] }), deps());
    expect([r.status, await json(r)]).toEqual([404, { ok: false, code: 'unknown_read' }]);
    await noRows(readId);
  });

  it.each([
    ['a field name off the list', { fields: [field('dock', { kept: 1 })] }],
    ['a field name that is a value', { fields: [field(`4001 Main St ${SENTINEL}`, { kept: 1 })] }],
    ['a negative count', { fields: [field('street', { kept: -1 })] }],
    ['a huge count', { fields: [field('street', { kept: 1_000_000 })] }],
    ['counts above what a load holds', { fields: [field('street', { kept: 6, changed: 5 })] }],
    ['a second load number', { fields: [field('load_number', { kept: 1, changed: 1 })] }],
    ['a field twice', { fields: [field('street', { kept: 1 }), field('street', { kept: 1 })] }],
    ['no fields', { fields: [] }],
    ['a value under an extra key', { fields: [{ ...field('street', { kept: 1 }), value: `4001 Main St ${SENTINEL}` }] }],
    ['an extra key on the body', { fields: [field('street', { kept: 1 })], loadNumber: SENTINEL }],
    ['a count that is text', { fields: [field('street', { kept: SENTINEL })] }],
    ['a layout that is a label', { fields: [field('street', { kept: 1 })], layout: [`pick up date ${SENTINEL}`] }],
    ['a layout that is a value', { fields: [field('street', { kept: 1 })], layout: [`4001 Main St ${SENTINEL}`] }],
    ['a layout of 65 hashes', { fields: [field('street', { kept: 1 })], layout: Array.from({ length: 65 }, (_, i) => i.toString(16).padStart(8, '0')) }],
    ['a layout hash in upper case', { fields: [field('street', { kept: 1 })], layout: ['0A1B2C3D'] }],
    ['a layout with a hash twice', { fields: [field('street', { kept: 1 })], layout: ['0a1b2c3d', '0a1b2c3d'] }],
    ['a layout out of order', { fields: [field('street', { kept: 1 })], layout: ['ffffffff', '00000001'] }],
    ['a layout that is text', { fields: [field('street', { kept: 1 })], layout: SENTINEL }],
    ['a layout that is an object of text', { fields: [field('street', { kept: 1 })], layout: { label: SENTINEL } }],
    ['a layout with an object in it', { fields: [field('street', { kept: 1 })], layout: [{ hash: SENTINEL }] }],
    ['a second key beside the layout', { fields: [field('street', { kept: 1 })], layout: ['00000001'], labels: [SENTINEL] }],
  ])('%s: 400, nothing stored, and the sentinel nowhere', async (_, rest) => {
    const id = newUser();
    const readId = await readFor(id);
    const r = await handleOutcome(request({ readId, ...rest }), deps());
    const text = await r.text();
    expect([r.status, JSON.parse(text)]).toEqual([400, { ok: false, code: 'bad_request' }]);
    expect(text).not.toContain(SENTINEL);
    await noRows(readId);
    expect(await everything()).not.toContain(SENTINEL);
  });

  it('a read id that is not an id (text with a value in it): 400', async () => {
    newUser();
    const r = await handleOutcome(request({ readId: `4001 Main St ${SENTINEL}`, fields: [field('street', { kept: 1 })] }), deps());
    const text = await r.text();
    expect([r.status, JSON.parse(text)]).toEqual([400, { ok: false, code: 'bad_request' }]);
    expect(text).not.toContain(SENTINEL);
  });

  it.each([
    ['not JSON', 400, 'bad_request', { raw: '{"readId": ' }],
    ['a body over the limit by its length', 413, 'too_large', { contentLength: '100000' }],
    ['a body over the limit with no length', 413, 'too_large', { raw: JSON.stringify({ pad: 'x'.repeat(5000) }) }],
  ] as const)('%s: %i', async (_, status, code, init) => {
    newUser();
    const r = await handleOutcome(request({}, init), deps());
    expect([r.status, await json(r)]).toEqual([status, { ok: false, code }]);
  });
});

describeDb('POST /api/ratecon/outcome: it does not spend the reader\'s allowance', () => {
  it('a burst of outcomes is not limited by the three-a-minute bucket of reads', async () => {
    const id = newUser();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const readId = await readFor(id);
      statuses.push((await handleOutcome(request({ readId, fields: [field('street', { kept: 1 })] }), deps())).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });
});

describeDb('POST /api/ratecon/outcome: when recording fails', () => {
  it('a database fault is a 500 with a reference and ONE log line of code and error name — never its message or the body', async () => {
    newUser();
    const failing = { transaction: async () => Promise.reject(new Error(`boom ${SENTINEL}`)) } as unknown as Db;
    const r = await handleOutcome(request({ readId: '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44', fields: [field('street', { kept: 1 })], layout: ['0a1b2c3d'] }), deps({ db: failing }));
    const body = await json(r);
    expect(r.status).toBe(500);
    expect(body).toMatchObject({ ok: false, code: 'error' });
    expect(body.reference).toMatch(/^RATECON-500-[0-9A-Z]+$/);
    const errorSpy = consoleSpies[3]!;
    expect(errorSpy.mock.calls).toEqual([['ratecon outcome not recorded', { reference: body.reference, code: 'error', errorName: 'Error' }]]);
    // Not even the hashes: the log holds a code, a reference and a class name.
    expect(JSON.stringify(consoleSpies.flatMap((c) => c.mock.calls))).not.toContain('0a1b2c3d');
    expect(JSON.stringify(body)).not.toContain('0a1b2c3d');
  });
});
