import { randomUUID } from 'node:crypto';
import * as SentryNode from '@sentry/node';
import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sentryCapture } from '@/test/sentry-capture';

/**
 * §12.142. A route's unexpected error reaches Sentry as its type, its stack,
 * the route's prefix, the reference the dispatcher saw and a SQLSTATE —
 * never its message.
 *
 * Sentry is started for real (src/test/sentry-capture.ts); every assertion
 * about "what leaves" reads the envelopes it would have sent, not a mock's
 * arguments. Only `withScope` and `flush` are wrapped, so a test can make
 * them throw or hang.
 *
 * The sentinel is made at run time: Sentry attaches source lines around each
 * frame, and a sentinel written in this file would be sent as source.
 */

// Named one by one: the SDK's re-exports are not enumerable, so a spread drops them.
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>();
  return {
    addBreadcrumb: actual.addBreadcrumb,
    captureException: actual.captureException,
    withScope: vi.fn(actual.withScope),
    flush: vi.fn(actual.flush),
  };
});

const Sentry = await import('@sentry/nextjs');
const { unexpectedFailure } = await import('./route-failure');

const S = `sx${randomUUID().replaceAll('-', '')}`;
const ROUTE = { prefix: 'DRIVER-GET', log: 'DRIVER-GET failed', message: 'The driver could not be saved.' };

const { options, sent, events } = sentryCapture();
SentryNode.init(options);
afterAll(() => SentryNode.close());

/** A postgres.js error as the driver builds it: one object of fields, `message` among them. */
const PostgresError = postgres.PostgresError as unknown as new (fields: Record<string, string>) => postgres.PostgresError;

/** What a failed Drizzle query throws: SQL and bound values in the message, the PostgresError as cause. */
const dbError = (code = '23505') =>
  new DrizzleQueryError(
    `insert into drivers (name, note)\n  values ($1, $2)`,
    [`Meet at dock ${S}`, `Ann ${S}`],
    new PostgresError({
      message: `duplicate key value violates unique constraint "drivers_${S}"`,
      code,
      detail: `Key (name)=(${S}) already exists.`,
      where: `PL/pgSQL function at line 3 ${S}`,
      hint: S,
      severity: 'ERROR',
    }),
  );

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  // The previous test's events may still be on their way.
  await Sentry.flush(2000);
  sent.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  vi.mocked(Sentry.withScope).mockClear();
});

describe('unexpectedFailure: what the dispatcher and the console see, unchanged', () => {
  it('answers the 500 every route gave: the same body, the same reference, the same console line', async () => {
    const error = dbError();
    const response = unexpectedFailure(error, ROUTE);
    expect(response.status).toBe(500);
    const text = await response.text();
    const body = JSON.parse(text) as { error: string; reference: string };
    expect(body.reference).toMatch(/^DRIVER-GET-500-[0-9A-Z]+$/);
    expect(text).toBe(JSON.stringify({ error: 'The driver could not be saved.', reference: body.reference }));
    expect(consoleError.mock.calls[0]).toEqual(['DRIVER-GET failed', { reference: body.reference, error: error.message }]);
  });

  it('logs a thrown non-Error as its string, as before', () => {
    unexpectedFailure(`thrown ${S}`, ROUTE);
    expect(consoleError.mock.calls[0]?.[1]).toMatchObject({ error: `thrown ${S}` });
  });
});

describe('unexpectedFailure: one Sentry event, type and stack, never the message', () => {
  const cases: [label: string, error: () => unknown][] = [
    ['a Drizzle error wrapping a PostgresError', () => dbError()],
    // Sentry parses every line of the stack text: this line would become a frame.
    ['a message line shaped like a stack frame', () => new TypeError(`first\n    at ${S} (evil.js:1:2)`)],
    ['a message that says " at " mid-line', () => new Error(`params: Meet at dock ${S}`)],
    ['a thrown string', () => `thrown ${S}`],
    ['a thrown object', () => ({ message: S, detail: S })],
  ];

  it.each(cases)('%s: exactly one event, and the sentinel nowhere in what is sent', async (_label, make) => {
    // The route's own console line becomes a breadcrumb in production.
    Sentry.addBreadcrumb({ category: 'console', message: `DRIVER-GET failed ${S}`, data: { arguments: [S] } });
    unexpectedFailure(make(), ROUTE);
    await Sentry.flush(2000);
    expect(events()).toHaveLength(1);
    expect(sent.join('\n')).not.toContain(S);
  });

  it('keeps the type of the error and of its cause, and the stack frames', async () => {
    unexpectedFailure(dbError(), ROUTE);
    await Sentry.flush(2000);
    const values = events()[0]?.exception?.values ?? [];
    expect(values.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
    expect(values.every((v) => v.value === '[removed: a route error never reports its message]')).toBe(true);
    const frames = values[1]?.stacktrace?.frames ?? [];
    expect(frames.some((f) => f.filename?.endsWith('route-failure.test.ts'))).toBe(true);
  });

  it('tags the prefix, the reference the response carries, and the SQLSTATE — nothing else', async () => {
    const body = (await unexpectedFailure(dbError('23505'), ROUTE).json()) as { reference: string };
    await Sentry.flush(2000);
    expect(events()[0]?.tags).toEqual({ route_prefix: 'DRIVER-GET', reference: body.reference, sqlstate: '23505' });
  });

  it('sends no SQLSTATE for an error that is not a database one, or a code that is not a SQLSTATE', async () => {
    unexpectedFailure(new TypeError('x'), ROUTE);
    unexpectedFailure(dbError(`code ${S}`), ROUTE);
    await Sentry.flush(2000);
    expect(events().map((e) => e.tags?.['sqlstate'])).toEqual([undefined, undefined]);
    expect(sent.join('\n')).not.toContain(S);
  });
});

describe('unexpectedFailure: Sentry is never a reason the 500 does not go out', () => {
  it('a Sentry that throws: the same 500, and one console line by reference, no message', async () => {
    vi.mocked(Sentry.withScope).mockImplementationOnce(() => {
      throw new Error(`sentry down ${S}`);
    });
    const response = unexpectedFailure(dbError(), ROUTE);
    const body = (await response.json()) as { error: string; reference: string };
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'The driver could not be saved.', reference: body.reference });
    expect(consoleError.mock.calls[1]).toEqual(['route error not reported to Sentry', { reference: body.reference }]);
    expect(JSON.stringify(consoleError.mock.calls[1])).not.toContain(S);
  });

  it('a flush that never settles: the response is already made', () => {
    vi.mocked(Sentry.flush).mockReturnValueOnce(new Promise<boolean>(() => {}));
    expect(unexpectedFailure(dbError(), ROUTE)).toBeInstanceOf(Response);
  });

  it('a flush that rejects: said once on the console, by reference, and no unhandled rejection', async () => {
    vi.mocked(Sentry.flush).mockReturnValueOnce(Promise.reject(new Error(`flush failed ${S}`)));
    const body = (await unexpectedFailure(dbError(), ROUTE).json()) as { reference: string };
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError.mock.calls[1]).toEqual(['route error not reported to Sentry', { reference: body.reference }]);
  });
});
