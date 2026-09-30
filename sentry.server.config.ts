import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';
import { sampleTraces } from '@/lib/sentry-sampling';

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
   * §12.87. Every sign-in, 1% of everything else — see
   * src/lib/sentry-sampling.ts. A flat rate either misses the sign-ins (they
   * are a few a day) or spends the quota on `/api/fleet`, polled every 20 s
   * per open console. Same sampler as the edge config, so a sampled sign-in
   * is timed through the middleware too.
   */
  tracesSampler: sampleTraces,

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
