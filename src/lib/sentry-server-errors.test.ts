import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as Sentry from '@sentry/nextjs';
import * as SentryNode from '@sentry/node';
import type { ErrorEvent, Event, StackParser } from '@sentry/core';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { onRequestError } from '@/instrumentation';
import { sentryCapture } from '@/test/sentry-capture';
import { scrubReaderEvent } from './sentry-reader';
import { REMOVED, errorType, rebuildException, scrubServerEvent, sqlstateOf, typeAndStack } from './sentry-server-errors';

/**
 * §12.143. No server error event carries text, whoever captured it.
 *
 * The page path is the one that leaked (5 of 9 Sentry issues, 2026-10-14/15,
 * "Page Server Component /"): Sentry's wrapper around the page captures the
 * raw error, then Next hands the same error to `onRequestError`. Both are the
 * real SDK functions here, on a real client with an in-memory transport.
 *
 * The sentinel is made at run time: Sentry attaches source lines around each
 * frame, and a sentinel written in this file would be sent as source.
 */

const S = `sx${randomUUID().replaceAll('-', '')}`;

/** postgres.js's error as the production build ships it: class name minified, server fields assigned. */
class o extends Error {
  severity = 'ERROR';
  code = '42P01';
  detail = `Key (note)=(${S}) is unknown.`;
  where = `PL/pgSQL function at line 3 ${S}`;
}

/** A page's failed query: SQL and bound values in the message, " at " in a value, a frame-shaped line in the cause. */
const pageError = () =>
  new DrizzleQueryError(
    'select "id", "name"\n  from "truck_lists" where "note" = $1',
    [`Meet at dock ${S}`, `Ann ${S}`],
    new o(`relation "truck_lists_${S}" does not exist\n    at ${S} (evil.js:1:2)`),
  );

const { options, sent, events } = sentryCapture();
SentryNode.init(options);
afterAll(() => SentryNode.close());
beforeEach(async () => {
  await SentryNode.flush(2000);
  sent.length = 0;
});

describe('an uncaught server error, through a real Sentry client', () => {
  it("a page component's error: one event from the wrapper and onRequestError, no text, real frames", async () => {
    const error = pageError();
    const Page = Sentry.wrapServerComponentWithSentry(
      async (): Promise<never> => {
        throw error;
      },
      { componentRoute: '/', componentType: 'Page' },
    );
    await expect(Page()).rejects.toBe(error);
    // What Next does next (app-render/create-error-handler.js: the same error object).
    onRequestError(error, { path: '/', method: 'GET', headers: {} }, { routerKind: 'App Router', routePath: '/', routeType: 'render' });
    await SentryNode.flush(2000);

    expect(events()).toHaveLength(1);
    expect(sent.join('\n')).not.toContain(S);
    const values = events()[0]?.exception?.values ?? [];
    expect(values.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
    expect(values.every((v) => v.value === REMOVED)).toBe(true);

    const frames = values[1]?.stacktrace?.frames ?? [];
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.some((f) => f.filename?.endsWith('sentry-server-errors.test.ts'))).toBe(true);
    expect(frames.every((f) => typeof f.lineno === 'number')).toBe(true);
    for (const f of values.flatMap((v) => v.stacktrace?.frames ?? [])) {
      expect(f.filename ?? '').not.toMatch(/evil\.js|dock/);
    }
  });

  it('an error captured directly, with extra and a breadcrumb: no text', async () => {
    SentryNode.withScope((scope) => {
      scope.setExtra('note', S);
      SentryNode.addBreadcrumb({ category: 'console', message: `logged ${S}`, data: { arguments: [S] } });
      SentryNode.captureException(new TypeError(`first\n    at ${S} (evil.js:1:2)`));
    });
    await SentryNode.flush(2000);
    expect(events()).toHaveLength(1);
    expect(events()[0]?.exception?.values?.map((v) => v.type)).toEqual(['TypeError']);
    expect(sent.join('\n')).not.toContain(S);
  });

  it('a captured message, which has no Error to rebuild from: the backstop takes its text', async () => {
    SentryNode.captureMessage(`message ${S}`);
    await SentryNode.flush(2000);
    expect(events()).toHaveLength(1);
    expect(sent.join('\n')).not.toContain(S);
  });
});

describe('rebuildException: error events only', () => {
  const parser: StackParser = () => [{ filename: 'app.js', lineno: 1 }];

  it('leaves a transaction as it is, even one handed an Error', () => {
    const transaction: Event = { type: 'transaction', transaction: `GET /x ${S}`, exception: { values: [{ value: S }] } };
    const before = structuredClone(transaction);
    rebuildException(transaction, { originalException: new Error(S) }, parser);
    expect(transaction).toEqual(before);
  });

  it('leaves an event with no captured Error to the backstop, which takes its text', () => {
    const event: ErrorEvent = { type: undefined, message: S, exception: { values: [{ type: 'Error', value: S }] } };
    rebuildException(event, undefined, parser);
    expect(event.exception?.values?.[0]?.value).toBe(S);
    expect(JSON.stringify(scrubServerEvent(event))).not.toContain(S);
  });
});

describe('scrubServerEvent, the beforeSend of both server configs', () => {
  const event = (transaction: string, url: string): ErrorEvent => ({
    type: undefined,
    transaction,
    message: `failed ${S}`,
    exception: { values: [{ type: 'PostgresError', value: S, stacktrace: { frames: [{ function: 'GET' }] } }] },
    extra: { body: S },
    request: { url, data: S },
    breadcrumbs: [{ category: 'console', message: `logged ${S}`, data: { arguments: [S] }, timestamp: 1 }],
  });

  it.each([
    ['any route', event('GET /api/fleet', 'https://app.example/api/fleet')],
    ['the edge runtime (middleware)', event('middleware GET', 'https://app.example/login')],
    ['a page', event('Page Server Component (/)', 'https://app.example/')],
  ])('%s: no text survives; the type, the stack and the trail do', (_label, input) => {
    const out = scrubServerEvent(input);
    expect(JSON.stringify(out)).not.toContain(S);
    expect(out.exception?.values?.[0]).toMatchObject({ type: 'PostgresError', stacktrace: { frames: [{ function: 'GET' }] } });
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual(['console']);
  });

  it("the reader route's event exactly as scrubReaderEvent leaves it", () => {
    const reader = event('POST /api/ratecon/read', 'https://app.example/api/ratecon/read');
    expect(scrubServerEvent(structuredClone(reader))).toEqual(scrubReaderEvent(structuredClone(reader)));
  });
});

describe('typeAndStack and the names', () => {
  it('names a minified postgres.js error and a Drizzle error by shape, and finds the SQLSTATE in a cause', () => {
    const error = pageError();
    expect(errorType(error)).toBe('DrizzleQueryError');
    expect(errorType(error.cause)).toBe('PostgresError');
    expect(errorType(`thrown ${S}`)).toBe('Thrown string');
    expect(sqlstateOf(error)).toBe('42P01');
    expect(sqlstateOf(new TypeError('x'))).toBeUndefined();
  });

  it('keeps the frames and the causes, and no line of any message', () => {
    const standIn = typeAndStack(pageError());
    expect(standIn.name).toBe('DrizzleQueryError');
    expect(standIn.cause).toBeInstanceOf(Error);
    expect((standIn.cause as Error).name).toBe('PostgresError');
    expect(standIn.stack).toMatch(/\n\s+at .*sentry-server-errors\.test\.ts/);
    expect(`${standIn.stack} ${(standIn.cause as Error).stack}`).not.toContain(S);
  });
});

/** The code with comments stripped, as sentry-privacy.test.ts reads configs. */
const code = (file: string) =>
  readFileSync(join(import.meta.dirname, '..', '..', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('both server configs are wired the same way', () => {
  it.each(['sentry.server.config.ts', 'sentry.edge.config.ts'])(
    '%s: the backstop as beforeSend, the integration added, nothing on transactions or spans',
    (file) => {
      const config = code(file);
      expect(config).toMatch(/beforeSend:\s*scrubServerEvent\b/);
      expect(config).toMatch(/Sentry\.addIntegration\(\s*textlessErrors\(\)\s*\)/);
      expect(config).not.toMatch(/beforeSendTransaction|beforeSendSpan/);
    },
  );
});

describe('one implementation of the stand-in', () => {
  const ROOT = join(import.meta.dirname, '..', '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(ROOT, path)] : [];
    });

  it('only src/lib/sentry-server-errors.ts cuts a message out of a stack', () => {
    const files = [...sources(join(ROOT, 'src')), 'sentry.server.config.ts', 'sentry.edge.config.ts'];
    const cutters = files.filter((file) => {
      const text = code(file);
      return /function\s+typeAndStack\b|typeAndStack\s*=/.test(text) || /stack\.indexOf\(\s*\w+\.message\s*\)/.test(text);
    });
    expect(cutters).toEqual(['src/lib/sentry-server-errors.ts']);
  });
});
