import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';

/**
 * The browser. Next loads this before any client code runs.
 *
 * The DSN is `NEXT_PUBLIC_` on purpose and is the one deliberate exception to
 * this project's rule about that prefix: a DSN is a write-only ingest address
 * that can file an event and cannot read one, so it is designed to ship to
 * browsers. See the note in src/env/schema.ts.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: 0,

  /**
   * Turned on by `SENTRY_DEBUG=1` without a code change, which is the only
   * way to answer "is it reporting?" on a host you cannot attach a debugger
   * to. Off by default: the transport logs are hundreds of lines per event.
   */
  debug: process.env.SENTRY_DEBUG === '1',

  /**
   * No session replay. The console shows real loads, real addresses and real
   * driver names all day; recording a dispatcher's screen to debug a render
   * error is a trade this application should not make quietly.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  /**
   * v11 collects cookies, bodies and bound query parameters unless told not
   * to. Shared across all four runtimes — see src/lib/sentry-privacy.ts.
   */
  dataCollection: SENTRY_DATA_COLLECTION,
});

/** Lets Sentry tie an error to the navigation that led to it. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
