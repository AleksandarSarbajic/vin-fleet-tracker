import * as Sentry from '@sentry/nextjs';

/**
 * Next's server-side instrumentation hook (phase 6, item 4).
 *
 * Next calls `register()` once per server runtime before any request is
 * handled, which is the only place Sentry can be started early enough to see
 * a failure in the first request rather than from the second onwards.
 *
 * The two runtimes are initialised from separate files because they are
 * separate builds with separate constraints: the edge runtime has no Node
 * built-ins, so importing the Node config there fails at build time rather
 * than at runtime. The dynamic imports keep each out of the other's bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/**
 * Errors thrown inside React Server Components, route handlers and server
 * actions (Next 15's `onRequestError`).
 *
 * Without this, a server-side render that throws is caught by Next's own error
 * boundary and reported to nobody. Route handlers here already answer with a
 * reference code (`FLEET-500-…`) — this is what makes that code findable in
 * Sentry instead of only in a terminal the dispatcher cannot see.
 */
export const onRequestError = Sentry.captureRequestError;
