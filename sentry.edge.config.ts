import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';

/**
 * The edge runtime — which here means exactly one thing: `src/middleware.ts`,
 * the auth-cookie refresh that every request passes through. It is small and
 * it is the single point through which a broken session takes the whole
 * console down, so it is worth its own initialisation.
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
   * v11 collects cookies, bodies and bound query parameters unless told not
   * to. Shared across all four runtimes — see src/lib/sentry-privacy.ts.
   */
  dataCollection: SENTRY_DATA_COLLECTION,
});
