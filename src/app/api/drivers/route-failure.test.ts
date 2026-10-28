import { randomUUID } from 'node:crypto';
import * as SentryNode from '@sentry/node';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';
import { sentryCapture } from '@/test/sentry-capture';

/**
 * §12.142 — `/api/drivers` end to end through its real handler, with the
 * database call failing for real: the test cluster, reached with a
 * `search_path` naming a schema that does not exist, so the route's own query
 * fails in Postgres (42P01) and comes back through Drizzle as it would in
 * production. Only the session is replaced, and `withScope`/`flush` are
 * wrapped so a test can hang them.
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
    if (rankOf(user.role) < rankOf(minimum)) {
      throw new AuthError(`Requires ${minimum}; ${user.fullName} is ${user.role}`, 403);
    }
    return user;
  };
  return { AuthError, requireUser, requireRole };
});

const pool = vi.hoisted(() => ({ end: async (): Promise<void> => {} }));
vi.mock('@/db', async () => {
  const postgres = (await import('postgres')).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { schema } = await import('@/db/connection');
  const client = postgres(process.env.DATABASE_URL ?? '', {
    prepare: false,
    max: 1,
    connection: { search_path: 'route_failure_nowhere' },
  });
  pool.end = () => client.end({ timeout: 5 });
  return { db: drizzle(client, { schema }), schema };
});
vi.mock('@/server/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/rate-limit')>();
  return { ...actual, enforceRateLimit: vi.fn(actual.enforceRateLimit) };
});
vi.mock('@/server/drivers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/drivers')>();
  return { ...actual, openMergeCandidates: vi.fn(actual.openMergeCandidates) };
});
// Named one by one: the SDK's re-exports are not enumerable, so a spread drops them.
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>();
  return {
    captureException: actual.captureException,
    withScope: vi.fn(actual.withScope),
    flush: vi.fn(actual.flush),
  };
});

const Sentry = await import('@sentry/nextjs');
const { AuthError, requireUser } = await import('@/lib/auth');
const { RateLimitError, enforceRateLimit } = await import('@/server/rate-limit');
const { DriverError, openMergeCandidates } = await import('@/server/drivers');
const { GET, POST } = await import('./route');

const { options, sent, events } = sentryCapture();
SentryNode.init(options);
afterAll(async () => {
  await SentryNode.close();
  await pool.end();
});

let address = 0;
const headers = () => ({ 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${address}` });
const get = () => GET(new Request('http://localhost/api/drivers', { headers: headers() }));
const post = (body: string) => POST(new Request('http://localhost/api/drivers', { method: 'POST', headers: headers(), body }));
const as = (role: 'viewer' | 'dispatcher') => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  email: null,
  fullName: role === 'viewer' ? 'Vera Viewer' : 'Dee Dispatcher',
  role,
});

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  address += 1;
  await Sentry.flush(2000);
  sent.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  vi.mocked(requireUser).mockReset();
  vi.mocked(Sentry.withScope).mockClear();
});

describeDb('/api/drivers: an unexpected error reaches Sentry without its text (§12.142)', () => {
  it('GET with the query failing in Postgres: the same 500, one event, tagged, none of the error text', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('dispatcher'));
    const response = await get();

    expect(response.status).toBe(500);
    const text = await response.text();
    const { reference } = JSON.parse(text) as { reference: string };
    expect(reference).toMatch(/^DRIVER-GET-500-[0-9A-Z]+$/);
    expect(text).toBe(JSON.stringify({ error: 'The driver could not be saved.', reference }));

    // The console line is as before, and it carries text that must not reach Sentry.
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, logged] = consoleError.mock.calls[0] as [string, { reference: string; error: string }];
    expect(label).toBe('DRIVER-GET failed');
    expect(logged.reference).toBe(reference);
    expect(logged.error).toMatch(/^Failed query: /);

    await Sentry.flush(2000);
    expect(events()).toHaveLength(1);
    const [event] = events();
    expect(event?.tags).toEqual({ route_prefix: 'DRIVER-GET', reference, sqlstate: '42P01' });
    expect(event?.exception?.values?.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
    const all = sent.join('\n');
    for (const text of ['Failed query', 'params:', 'does not exist']) expect(all).not.toContain(text);
  });

  it('POST with a body that is not JSON: the parse error quotes the body, and the quote never leaves', async () => {
    // Ten characters: V8's parse error quotes about ten from where it failed (e2e/route-failure-sentry.spec.ts).
    const sentinel = `q${randomUUID().replaceAll('-', '').slice(0, 9)}`;
    const response = await post(`{"action": ${sentinel}}`);

    expect(response.status).toBe(500);
    const { reference } = (await response.json()) as { reference: string };
    expect(reference).toMatch(/^DRIVER-POST-500-[0-9A-Z]+$/);
    const [label, logged] = consoleError.mock.calls[0] as [string, { error: string }];
    expect(label).toBe('DRIVER-POST failed');
    expect(logged.error).toContain(sentinel);

    await Sentry.flush(2000);
    expect(events()).toHaveLength(1);
    expect(events()[0]?.tags).toEqual({ route_prefix: 'DRIVER-POST', reference });
    expect(events()[0]?.exception?.values?.map((v) => v.type)).toEqual(['SyntaxError']);
    expect(sent.join('\n')).not.toContain(sentinel);
  });

  const createAnn = () => post('{"action":"create","driver":{"name":"Ann Example"}}');
  it.each<[label: string, status: number, arrange: () => void, call: () => Promise<Response>]>([
    ['our rate limit (429)', 429, () => void vi.mocked(enforceRateLimit).mockRejectedValueOnce(new RateLimitError(30)), get],
    ['no session (401)', 401, () => void vi.mocked(requireUser).mockRejectedValueOnce(new AuthError('Sign in.', 401)), get],
    ['a viewer creating (403)', 403, () => void vi.mocked(requireUser).mockResolvedValue(as('viewer')), createAnn],
    ['a domain refusal (400)', 400, () => {
      vi.mocked(requireUser).mockResolvedValue(as('dispatcher'));
      vi.mocked(openMergeCandidates).mockRejectedValueOnce(new DriverError('That driver no longer exists.', 'driverId'));
    }, get],
    ['a body that fails validation (400)', 400, () => undefined, () => post('{"action":"nope"}')],
  ])('%s: answered as before, and nothing reported', async (_label, status, arrange, call) => {
    arrange();
    const response = await call();
    expect(response.status).toBe(status);
    await Sentry.flush(2000);
    expect(Sentry.withScope).not.toHaveBeenCalled();
    expect(events()).toHaveLength(0);
  });

  it('the 500 does not wait for Sentry: a flush that never settles holds nothing', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('dispatcher'));
    // Every flush in this test hangs, not just the first: a route that awaited a second one must not slip by.
    const flush = vi.mocked(Sentry.flush);
    const passThrough = flush.getMockImplementation();
    flush.mockReturnValue(new Promise<boolean>(() => {}));
    try {
      const outcome = await Promise.race([
        get(),
        new Promise<'held'>((resolve) => setTimeout(() => resolve('held'), 2_000)),
      ]);
      expect(outcome).toBeInstanceOf(Response);
      expect((outcome as Response).status).toBe(500);
    } finally {
      if (passThrough) flush.mockImplementation(passThrough);
    }
  });
});
