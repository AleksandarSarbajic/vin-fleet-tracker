import type { SamplingContext } from '@sentry/core';

/**
 * Which traces the app keeps (§12.87). Shared by the Node and edge configs;
 * the browser and the worker stay at `tracesSampleRate: 0`.
 *
 * **Every sign-in, and 1% of everything else.** A flat rate is the wrong
 * tool for the question tracing was turned on to answer — "how long does a
 * real sign-in take from Vercel" — because sign-ins are a few a day: at 1% one
 * would be seen every few months. The console's polling is the opposite, 240
 * requests per open tab per hour, and 1% of it is enough to see a slow
 * middleware `getUser` without spending the quota.
 *
 * **A kept parent keeps its children; a dropped parent decides nothing.**
 * Sentry v11 streams spans, and a child span can come back through this
 * sampler on its own — measured: the Supabase `/auth/v1/token` call inside a
 * sampled sign-in was dropped as "1% of everything else", leaving a sign-in
 * trace with no auth call in it, which is the one span a slow sign-in has to
 * be broken down by. So `parentSampled === true` keeps the span.
 *
 * `parentSampled === false` is deliberately NOT inherited (and neither is
 * `inheritOrSampleWith`): the browser runs at rate 0, so every request it
 * makes arrives carrying an unsampled parent, and inheriting that would drop
 * exactly the sign-ins this exists to see.
 *
 * Pure and edge-safe: the middleware's config imports it, and the edge
 * runtime has no Node built-ins.
 */

export const SIGN_IN_SAMPLE_RATE = 1;
export const DEFAULT_SAMPLE_RATE = 0.01;

/** The sign-in form posts to its own page — a Next server action on /login. */
const SIGN_IN_PATH = '/login';

type Context = Pick<SamplingContext, 'name' | 'attributes' | 'normalizedRequest' | 'parentSampled'>;

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function pathOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, 'http://placeholder').pathname;
  } catch {
    return undefined; // Not a URL: nothing to match, which is "not a sign-in".
  }
}

/**
 * True for a POST to /login, from whichever of the three places this runtime
 * put it. The Node server span and the edge middleware span describe the same
 * request differently, so each source is tried rather than trusting one.
 */
export function isSignInPost(ctx: Context): boolean {
  const attrs = ctx.attributes ?? {};
  const method = (
    text(ctx.normalizedRequest?.method) ??
    text(attrs['http.request.method']) ??
    text(attrs['http.method']) ??
    text(ctx.name)?.split(' ')[0] ??
    ''
  ).toUpperCase();
  if (method !== 'POST') return false;

  const paths = [
    pathOf(text(ctx.normalizedRequest?.url)),
    pathOf(text(attrs['url.path'])),
    pathOf(text(attrs['url.full'])),
    pathOf(text(attrs['http.target'])),
    pathOf(text(attrs['http.url'])),
    text(attrs['http.route']),
    text(attrs['next.route']),
    // "POST /login" — the span name is the last resort, not the first.
    text(ctx.name)?.split(' ')[1],
  ];
  return paths.some((p) => p === SIGN_IN_PATH);
}

export function sampleTraces(ctx: Context): number {
  if (ctx.parentSampled === true) return 1;
  return isSignInPost(ctx) ? SIGN_IN_SAMPLE_RATE : DEFAULT_SAMPLE_RATE;
}
