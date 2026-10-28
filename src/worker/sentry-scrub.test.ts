import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOVED, workerFields } from '@/lib/sentry-server-errors';

/**
 * §12.144. What the worker sends to Sentry: types, frames, the logger's
 * literal message, and fields of a few safe shapes — no free text.
 *
 * Everything real: `initWorkerSentry`, the logger, and @sentry/node's own
 * HTTP transport, posting to a loopback server here that stands in for
 * Sentry's ingest. No option was added to the worker for this test.
 *
 * The console is silenced BEFORE Sentry starts, so Sentry's console
 * integration wraps the silent versions and still turns each JSON line into a
 * breadcrumb — the path that would otherwise carry the line's text.
 *
 * The sentinel is made at run time: Sentry attaches source lines around each
 * frame, and a sentinel written in this file would be sent as source.
 */

const silenced = (['error', 'warn', 'info'] as const).map((level) =>
  vi.spyOn(console, level).mockImplementation(() => {}),
);

const S = `sx${randomUUID().replaceAll('-', '')}`;
const STOP = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b';

const envelopes: string[] = [];
const ingest = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    if ((request.url ?? '').includes('/envelope/')) {
      envelopes.push((request.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body).toString());
    }
    response.end('{}');
  });
});
await new Promise<void>((resolve) => ingest.listen(0, '127.0.0.1', resolve));
const port = (ingest.address() as AddressInfo).port;

const { Sentry, flushWorkerSentry, initWorkerSentry } = await import('./sentry');
const { logger } = await import('./logger');
initWorkerSentry({ dsn: `http://public@127.0.0.1:${port}/1`, environment: 'test' });

afterAll(async () => {
  await Sentry.close(2_000);
  await new Promise<void>((resolve) => ingest.close(() => resolve()));
  for (const spy of silenced) spy.mockRestore();
});

interface WorkerEvent {
  message?: string;
  fingerprint?: string[];
  tags?: Record<string, string>;
  contexts?: { fields?: Record<string, unknown> };
  breadcrumbs?: { category?: string; message?: string; data?: Record<string, unknown> }[];
  exception?: { values?: { type?: string; value?: string; stacktrace?: { frames?: { filename?: string }[] } }[] };
}

/** An envelope: a header line, then pairs of an item header line and its payload line. */
function events(): WorkerEvent[] {
  return envelopes.flatMap((raw) => {
    const lines = raw.split('\n').filter((line) => line.length > 0);
    const found: WorkerEvent[] = [];
    for (let i = 1; i + 1 < lines.length; i += 2) {
      if ((JSON.parse(lines[i]!) as { type?: string }).type === 'event') found.push(JSON.parse(lines[i + 1]!) as WorkerEvent);
    }
    return found;
  });
}

/** postgres.js's error as the build ships it: class name minified, server fields assigned. */
class o extends Error {
  severity = 'ERROR';
  code = '23505';
  detail = `Key (name)=(${S}) already exists.`;
}

/** A failed Drizzle query: SQL and bound values in the message, " at " in a value, a frame-shaped line in the cause. */
const dbError = () =>
  new DrizzleQueryError(
    'update stops set note = $1\n  where id = $2',
    [`Meet at dock ${S}`, STOP],
    new o(`duplicate key "stops_${S}"\n    at ${S} (evil.js:1:2)`),
  );

beforeEach(async () => {
  await flushWorkerSentry();
  envelopes.length = 0;
});

describe('the worker reports through Sentry without text', () => {
  it("a database error logged by the worker: one event, types and frames, the safe fields, the literal message's fingerprint", async () => {
    // A request first: its query string (coordinates, a key) rides on a breadcrumb unless scrubbed.
    await fetch(`http://127.0.0.1:${port}/route?origin=41.8781,-87.6298&apiKey=k${S}`);
    const error = dbError();
    logger.error('routing sweep failed', { cause: error, error: error.message, truckNumber: 128, stopId: STOP });
    await flushWorkerSentry();

    expect(events()).toHaveLength(1);
    const [event] = events();
    expect(envelopes.join('\n')).not.toContain(S);

    const values = event?.exception?.values ?? [];
    expect(values.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
    expect(values.every((v) => v.value === REMOVED)).toBe(true);
    expect((values[1]?.stacktrace?.frames ?? []).some((f) => f.filename?.endsWith('sentry-scrub.test.ts'))).toBe(true);

    expect(event?.contexts?.fields).toEqual({ error: REMOVED, truckNumber: 128, stopId: STOP });
    expect(event?.fingerprint).toEqual(['worker', 'routing sweep failed']);
    expect(event?.tags).toMatchObject({ service: 'worker', sqlstate: '23505' });

    const http = (event?.breadcrumbs ?? []).filter((b) => b.category === 'http');
    expect(http.length).toBeGreaterThan(0);
    expect(JSON.stringify(http)).not.toContain('41.8781');
    const lines = (event?.breadcrumbs ?? []).filter((b) => b.category === 'console');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((b) => b.message === undefined && b.data === undefined)).toBe(true);
  });

  it("a warning's breadcrumb keeps its literal message and safe fields; the next error carries no text", async () => {
    logger.warn('eta mark log failed', { error: `failed ${S}`, note: S, count: 2, at: '2026-10-28T03:00:00.000Z' });
    logger.error('prune failed', { error: `prune ${S}` });
    await flushWorkerSentry();

    expect(events()).toHaveLength(1);
    const [event] = events();
    expect(envelopes.join('\n')).not.toContain(S);
    // No cause: a message event, grouped by that literal message (no fingerprint, as before).
    expect(event?.message).toBe('prune failed');
    expect(event?.contexts?.fields).toEqual({ error: REMOVED });
    const own = (event?.breadcrumbs ?? []).filter((b) => b.category === 'worker');
    expect(own.at(-1)).toMatchObject({
      message: 'eta mark log failed',
      data: { error: REMOVED, note: REMOVED, count: 2, at: '2026-10-28T03:00:00.000Z' },
    });
  });
});

describe('workerFields: which shapes leave', () => {
  it.each<[label: string, key: string, value: unknown, kept: boolean]>([
    ['a number', 'stalledSeconds', 412, true],
    ['a boolean', 'complete', false, true],
    ['null', 'truck', null, true],
    ['a UUID', 'stopId', STOP, true],
    ['an ISO timestamp', 'at', '2026-10-28T03:00:00.000Z', true],
    ['an ISO date', 'day', '2026-10-28', true],
    ['a SQLSTATE under its key', 'sqlstate', '40001', true],
    ['a truck number as text under a truck key', 'truck', '128', true],
    ['digits under any other key (a ZIP is digits too)', 'stop', '60601', false],
    ['five capitals under any other key', 'reason', 'ABORT', false],
    ['free text', 'reason', `lock lost ${S}`, false],
    ['an object', 'detail', { total: 3 }, false],
    ['an array', 'capped', [1, 2], false],
    ['"error", whatever it holds', 'error', 404, false],
    ['"cause", whatever it holds', 'cause', true, false],
  ])('%s', (_label, key, value, kept) => {
    expect(workerFields({ [key]: value })).toEqual({ [key]: kept ? value : REMOVED });
  });
});
