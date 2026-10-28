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
 * boundary and reported to nobody. It sees only what is THROWN: the API routes
 * catch their errors and answer with a reference (`FLEET-500-…`), so they never
 * reach it. They report through src/server/route-failure.ts (§12.142), which
 * tags the event with that reference.
 *
 * It is handed the RAW error, on purpose (§12.143). Sentry's wrapper around a
 * page has usually captured that same error object already, and Sentry drops
 * a second capture of one object; a stand-in here would be a second event.
 * The error's text is cut for every capture by the `textlessErrors`
 * integration both server configs add (src/lib/sentry-server-errors.ts).
 */
export const onRequestError = Sentry.captureRequestError;
