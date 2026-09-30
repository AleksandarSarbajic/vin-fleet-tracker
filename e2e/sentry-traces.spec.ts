import { expect, test, type BrowserContext } from '@playwright/test';
import { SENTRY_SINK_URL } from '../playwright.config';

/**
 * §12.87. A real sign-in, through the real SDK and the real config, and what
 * Sentry would receive from it.
 *
 * The app under test sends to `e2e/sentry-sink.mjs` instead of Sentry. This
 * signs in for real (hosted Supabase, the e2e account), gathers every span of
 * the sign-in's trace — the Node server action AND the edge middleware — and
 * fails if any of them carries the password, a cookie, an authorization
 * header, a session token, or the request body.
 *
 * The secrets are not guessed at; they are the ones THIS sign-in used: the
 * password from the environment, every cookie value the browser holds
 * afterwards, and the access and refresh tokens decoded out of Supabase's
 * session cookie. The e2e email stands in for the body — the form posts it,
 * and nothing else in a trace has any reason to.
 *
 * Sentry v11 STREAMS spans (`trace_lifecycle: stream`): envelopes carry `span`
 * items of `{ version, items: [span] }`, not transactions, and the Node side
 * flushes on its own schedule — hence the wait.
 */

test.use({ storageState: { cookies: [], origins: [] } });

interface SinkItem {
  type: string;
  payload: unknown;
  raw: string;
}

interface Span {
  name: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  is_segment?: boolean;
  start_timestamp: number;
  end_timestamp: number;
  status?: string;
  attributes: Record<string, { value: unknown; type?: string }>;
}

const attr = (s: Span, key: string): unknown => s.attributes[key]?.value;

async function spans(): Promise<Span[]> {
  const items = (await (await fetch(`${SENTRY_SINK_URL}/items`)).json()) as SinkItem[];
  return items
    .filter((i) => i.type === 'span')
    .flatMap((i) => ((i.payload as { items?: Span[] }).items ?? []) as Span[]);
}

/** Supabase's SSR cookie: `base64-<base64url JSON>`, possibly split `.0`, `.1`. */
function tokensFrom(cookies: Awaited<ReturnType<BrowserContext['cookies']>>): string[] {
  const auth = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join('');
  if (!auth) return [];
  const json = Buffer.from(auth.replace(/^base64-/, ''), 'base64url').toString();
  const session = JSON.parse(json) as { access_token?: string; refresh_token?: string };
  return [session.access_token, session.refresh_token].filter((t): t is string => !!t);
}

/** The Node server's segment for the sign-in POST — the one that must exist. */
const isNodeSignIn = (s: Span): boolean =>
  !!s.is_segment &&
  attr(s, 'http.request.method') === 'POST' &&
  attr(s, 'http.target') === '/login' &&
  attr(s, 'next.span_type') === 'BaseServer.handleRequest';

test('a sign-in trace carries no password, cookie, authorization or body', async ({ page, context }) => {
  await fetch(`${SENTRY_SINK_URL}/reset`, { method: 'POST' });

  await page.goto('/login');
  await page.getByLabel('Work email').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  // Spans from an EARLIER sign-in (the setup project's) can still be flushing
  // into the sink after the reset, so this sign-in is picked out by time.
  const clickedAt = Date.now() / 1000;
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Search the fleet')).toBeVisible({ timeout: 30_000 });

  const cookies = await context.cookies();
  const tokens = tokensFrom(cookies);
  expect(tokens.length, 'the session cookie should decode to two tokens').toBe(2);
  /** Labelled, so a failure names WHAT leaked without printing it. */
  const labelled: [label: string, value: string][] = [
    ['password', process.env.E2E_PASSWORD!],
    ['password (form-encoded)', encodeURIComponent(process.env.E2E_PASSWORD!)],
    ['email — the request body', process.env.E2E_EMAIL!],
    ['email — the request body (form-encoded)', encodeURIComponent(process.env.E2E_EMAIL!)],
    ...cookies
      .filter((c) => c.value.length >= 16)
      .map((c): [string, string] => [`cookie ${c.name}`, c.value]),
    ['access token', tokens[0]!],
    ['refresh token', tokens[1]!],
  ];
  const secrets = labelled.map(([, v]) => v);
  const mask = (s: string) => secrets.reduce((out, v) => out.split(v).join('[SECRET]'), s);

  // Node flushes on its own schedule; wait for this sign-in's segment AND its
  // auth call, which can arrive in a later envelope than the segment.
  const ours = (s: Span) => isNodeSignIn(s) && s.start_timestamp >= clickedAt - 1;
  const hasAuthCall = (all: Span[], traceId: string) =>
    all.some(
      (s) =>
        s.trace_id === traceId &&
        attr(s, 'sentry.op') === 'http.client' &&
        attr(s, 'url.path') === '/auth/v1/token',
    );
  let all: Span[] = [];
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; ) {
    all = await spans();
    const found = all.find(ours);
    if (found && hasAuthCall(all, found.trace_id)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const signIn = all.find(ours);

  if (process.env['SINK_DUMP']) {
    for (const s of [...all].sort((a, b) => a.start_timestamp - b.start_timestamp)) {
      console.info(
        mask(
          `${s.trace_id.slice(0, 6)} ${s.is_segment ? 'SEG' : '   '} ${s.name.padEnd(48)} ` +
            `${String(Math.round((s.end_timestamp - s.start_timestamp) * 1000)).padStart(5)}ms ` +
            `seg=${String(attr(s, 'sentry.segment.name') ?? '')} op=${String(attr(s, 'sentry.op') ?? '')} ` +
            `path=${String(attr(s, 'url.path') ?? attr(s, 'http.target') ?? '')}`,
        ),
      );
    }
  }
  expect(
    signIn,
    `no Node sign-in segment reached the sink; it received: ${[...new Set(all.map((s) => s.name))].join(', ') || 'nothing'}`,
  ).toBeDefined();

  // Every span of the sign-in's trace: edge middleware, Node server, children.
  const trace = all.filter((s) => s.trace_id === signIn!.trace_id);
  const raw = JSON.stringify(trace);

  // 1. No secret value anywhere. Soft, so check 2 still reports.
  const leaked = labelled.filter(([, v]) => raw.includes(v)).map(([label]) => label);
  expect.soft(leaked, 'secret values in the sign-in trace (labels only)').toEqual([]);

  // 2. No header, cookie or body attribute, by name, on any span.
  const forbidden = [
    ...new Set(
      trace
        .flatMap((s) => Object.keys(s.attributes))
        .filter((k) =>
          /header\.(cookie|authorization|set[-_]cookie)|request\.body|http\.request\.body|\bcookies?\b|request\.data/i.test(k),
        ),
    ),
  ];
  expect.soft(forbidden, 'span attributes naming a header, cookie or body').toEqual([]);

  // 3. The Supabase auth call is IN the trace. It is the span a slow sign-in
  //    gets broken down by; the first sampler dropped it as "1% of the rest".
  const authCall = trace.find(
    (s) => attr(s, 'sentry.op') === 'http.client' && attr(s, 'url.path') === '/auth/v1/token',
  );
  expect(authCall, 'the sign-in trace has no span for the Supabase auth call').toBeDefined();

  // 4. The sampler's own mark: every sign-in segment was kept at rate 1.
  for (const s of trace.filter((x) => x.is_segment)) {
    expect(attr(s, 'sentry.sample_rate'), `${s.name} sample rate`).toBe(1);
  }

  // Shown, masked, so the run log says what a sign-in trace actually holds.
  console.info(
    mask(
      JSON.stringify(
        trace
          .sort((a, b) => a.start_timestamp - b.start_timestamp)
          .map((s) => ({
            name: s.name,
            segment: !!s.is_segment,
            ms: Math.round((s.end_timestamp - s.start_timestamp) * 1000),
            attributes: Object.fromEntries(
              Object.entries(s.attributes)
                .filter(([k]) => !/^(device|app|os|culture|process)\.|sdk\.integrations/.test(k))
                .map(([k, v]) => [k, v.value]),
            ),
          })),
        null,
        1,
      ),
    ),
  );
});
