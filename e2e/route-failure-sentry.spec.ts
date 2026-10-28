import { expect, test } from '@playwright/test';
import { SENTRY_SINK_URL } from '../playwright.config';
import { connect } from './fixtures';

/**
 * §12.142. A real 500 from the production build, and what Sentry would
 * receive from it: one error event, tagged with the reference the response
 * carried, without the error's message. §12.143: the same for an UNCAUGHT
 * error, a page's, in the second test.
 *
 * The 500 is one the routes already give, with no switch added for a test: a
 * body that is not JSON. `POST /api/drivers` parses the body before anything
 * else, and a parse error is none of its 4xx cases. V8's parse error quotes
 * about ten characters of the body from where it failed, so a ten-character
 * sentinel there is in the message that must not leave — checked below, in
 * this process's V8, before the request is made.
 *
 * The app sends to `e2e/sentry-sink.mjs` instead of Sentry (§12.87).
 */

interface SinkItem {
  type: string;
  payload: unknown;
  raw: string;
}

interface SentEvent {
  platform?: string;
  transaction?: string;
  tags?: Record<string, string>;
  exception?: { values?: { type?: string; value?: string; mechanism?: { type?: string } }[] };
}

const REMOVED = '[removed: a server error never reports its text]';

const sinkItems = async (): Promise<SinkItem[]> =>
  (await (await fetch(`${SENTRY_SINK_URL}/items`)).json()) as SinkItem[];

const errorEvents = (items: SinkItem[]) =>
  items.filter((i) => i.type === 'event').map((i) => i.payload as SentEvent);

test("a route's unexpected error reaches Sentry once, by its reference, without its message", async ({ page }) => {
  const sentinel = `q${Math.random().toString(36).slice(2, 11).padEnd(9, '0')}`;
  const body = `{"action": ${sentinel}}`;
  expect(() => JSON.parse(body), 'the parse error should quote the sentinel').toThrow(sentinel);

  await fetch(`${SENTRY_SINK_URL}/reset`, { method: 'POST' });
  const response = await page.request.post('/api/drivers', {
    headers: { 'content-type': 'application/json' },
    // A Buffer, not the string: with a JSON content type Playwright sends a
    // string that does not parse as JSON.stringify(string) — valid JSON, a 400
    // (playwright-core lib/coreBundle.js:59335–59338, v1.63; run 2026-10-28T13-39-11-285Z).
    data: Buffer.from(body, 'utf8'),
  });

  expect(response.status()).toBe(500);
  const answer = (await response.json()) as { error: string; reference: string };
  expect(answer.error).toBe('The driver could not be saved.');
  expect(answer.reference).toMatch(/^DRIVER-POST-500-[0-9A-Z]+$/);

  // The server sends on its own schedule; wait for this reference's event.
  let items: SinkItem[] = [];
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
    items = await sinkItems();
    if (errorEvents(items).some((e) => e.tags?.['reference'] === answer.reference)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // A second event for the same failure would be sent with the first; give it a moment to land.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  items = await sinkItems();

  const fromThisRoute = errorEvents(items).filter((e) => e.tags?.['route_prefix'] === 'DRIVER-POST');
  expect(fromThisRoute, 'exactly one error event from the route').toHaveLength(1);
  const [event] = fromThisRoute;
  expect(event?.tags).toEqual({ route_prefix: 'DRIVER-POST', reference: answer.reference });
  expect(event?.exception?.values?.map((v) => v.type)).toEqual(['SyntaxError']);
  expect(event?.exception?.values?.[0]?.value).toBe(REMOVED);

  // Nowhere in anything the sink received: not the event, its breadcrumbs, or a span.
  const everything = items.map((i) => i.raw).join('\n');
  expect(everything.includes(sentinel), 'the sentinel reached the sink').toBe(false);
  expect(everything.includes('is not valid JSON'), 'the parse error text reached the sink').toBe(false);
});

/**
 * §12.143. An UNCAUGHT server error: a page's query fails in Postgres. No
 * switch in the app: for this test only, `truck_lists` in the e2e database
 * becomes a view over a function that raises, and `/history` reads it
 * (`loadTruckLists`). The raised message holds a sentinel twice, once on a
 * line shaped like a stack frame — the text Sentry would otherwise parse into
 * a frame. Sentry's wrapper around the page captures the error, then Next
 * hands the same error to onRequestError: one event is expected.
 */
test("a page's uncaught database error reaches Sentry once, as types and frames, without its text", async ({ page }) => {
  const sentinel = `q${Math.random().toString(36).slice(2, 11).padEnd(9, '0')}`;
  const sql = connect();
  try {
    await sql.unsafe(`
      alter table truck_lists rename to truck_lists__e2e_3ar;
      create function e2e_3ar_raise() returns setof truck_lists__e2e_3ar language plpgsql as $f$
      begin
        raise exception '%', 'list read failed ${sentinel}' || chr(10) || '    at ${sentinel} (evil.js:1:2)';
      end
      $f$;
      create view truck_lists as select * from e2e_3ar_raise();
    `).simple();

    await fetch(`${SENTRY_SINK_URL}/reset`, { method: 'POST' });
    const response = await page.goto('/history');
    test.info().annotations.push({ type: 'page status', description: String(response?.status()) });

    // Server events only: the browser may report the error page too, with no text of the server's.
    const fromServer = (items: SinkItem[]) => errorEvents(items).filter((e) => e.platform === 'node');
    let items: SinkItem[] = [];
    for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
      items = await sinkItems();
      if (fromServer(items).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    items = await sinkItems();

    const events = fromServer(items);
    expect(events, 'exactly one server error event').toHaveLength(1);
    const [event] = events;
    test.info().annotations.push({
      type: 'event',
      description: `transaction=${event?.transaction ?? ''} mechanism=${event?.exception?.values?.at(-1)?.mechanism?.type ?? ''}`,
    });
    // Named by shape: the build minifies postgres.js's class name to one letter.
    expect(event?.exception?.values?.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
    expect(event?.exception?.values?.every((v) => v.value === REMOVED)).toBe(true);

    const everything = items.map((i) => i.raw).join('\n');
    expect(everything.includes(sentinel), 'the sentinel reached the sink').toBe(false);
    expect(everything.includes('evil.js'), 'a frame made from the message reached the sink').toBe(false);
  } finally {
    await sql.unsafe(`
      drop view if exists truck_lists;
      drop function if exists e2e_3ar_raise();
      alter table if exists truck_lists__e2e_3ar rename to truck_lists;
    `).simple();
    await sql.end({ timeout: 5 });
  }
});
