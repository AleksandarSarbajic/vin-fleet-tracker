import * as SentryNode from '@sentry/node';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';
import { sentryCapture } from '@/test/sentry-capture';

/**
 * Phase 3bx, QoL 2 (§12.164). `/api/stops/addresses` failing for real, as 3aq's routes are tested
 * (`drivers/route-failure.test.ts`): the test cluster reached with a `search_path` naming a schema
 * that does not exist, so the route's own query fails in Postgres (42P01) and comes back through
 * Drizzle as it would in production. It answers through `unexpectedFailure`, so one Sentry event
 * goes, tagged, with the error's type and none of its text (3ar), and the window's field then
 * works as plain text (`edit/address-suggest.test.tsx`).
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403,
    ) {
      super(message);
      this.name = 'AuthError';
    }
  }
  return {
    AuthError,
    requireRole: vi.fn(async () => ({ id: '00000000-0000-4000-8000-0000000000a4', email: null, fullName: 'Dee', role: 'dispatcher' })),
  };
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
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>();
  return { captureException: actual.captureException, withScope: actual.withScope, flush: actual.flush };
});

const Sentry = await import('@sentry/nextjs');
const { GET } = await import('./route');

const { options, sent, events } = sentryCapture();
SentryNode.init(options);
afterAll(async () => {
  await SentryNode.close();
  await pool.end();
});

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await Sentry.flush(2000);
  sent.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describeDb('/api/stops/addresses: an unexpected error reaches Sentry without its text (§12.164, 3aq)', () => {
  it('the query failing in Postgres: a 500 with a reference, one event, tagged, none of the error text sent or logged', async () => {
    const response = await GET(
      new Request('http://localhost/api/stops/addresses', { headers: { 'x-forwarded-for': '10.4.0.1' } }),
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    const { reference } = JSON.parse(text) as { reference: string };
    expect(reference).toMatch(/^ADDRESSES-500-[0-9A-Z]+$/);
    expect(text).toBe(JSON.stringify({ error: 'Past addresses could not be read.', reference }));
    expect(consoleError.mock.calls).toEqual([
      ['GET /api/stops/addresses failed', { reference, errorName: 'DrizzleQueryError', sqlstate: '42P01' }],
    ]);

    await Sentry.flush(2000);
    expect(events()).toHaveLength(1);
    expect(events()[0]?.tags).toEqual({ route_prefix: 'ADDRESSES', reference, sqlstate: '42P01' });
    expect(events()[0]?.exception?.values?.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
    const all = sent.join('\n');
    // The SQL, its values and Postgres's message. (Our own source lines ride in a stack's context, as every 3aq event's do.)
    for (const fragment of ['Failed query', 'params:', 'does not exist', 'relation \\"stops\\"']) expect(all).not.toContain(fragment);
  });
});
