import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';

/**
 * The Next app's Node runtime. A DIFFERENT Sentry project from the worker's
 * (see src/env/schema.ts): the app fails per-request in front of a dispatcher
 * who can retry, the worker fails alone at 3am, and one stream makes the
 * second kind invisible.
 *
 * Absent a DSN this is inert and the console runs exactly as before. Error
 * reporting must never be a reason the dispatch board will not load.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  /**
   * Errors, not traces — the same call as the worker makes, for a different
   * reason. `/api/fleet` is polled every 20 seconds per open console; tracing
   * it would spend the quota on the most predictable request in the system.
   */
  tracesSampleRate: 0,

  /**
   * Turned on by `SENTRY_DEBUG=1` without a code change, which is the only
   * way to answer "is it reporting?" on a host you cannot attach a debugger
   * to. Off by default: the transport logs are hundreds of lines per event.
   */
  debug: process.env.SENTRY_DEBUG === '1',

  /**
   * v11 collects cookies, bodies and bound query parameters unless told not
   * to. Shared across all four runtimes — see src/lib/sentry-privacy.ts.
   */
  dataCollection: SENTRY_DATA_COLLECTION,
});
