import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';
import { withoutAiIntegrations } from '@/lib/sentry-reader';
import { sampleTraces } from '@/lib/sentry-sampling';
import { scrubServerEvent, textlessErrors, textlessSpan } from '@/lib/sentry-server-errors';

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

  /**
   * No error event carries text (§12.143): every one keeps its exception type
   * and stack, and loses the message, `extra`, request data and breadcrumb
   * text. The language-model reader's route exactly as before
   * (`scrubReaderEvent`, src/lib/sentry-reader.ts). A backstop: the text is
   * cut earlier, by the integration added below.
   */
  beforeSend: scrubServerEvent,

  /**
   * §12.165. Spans, streamed, and nothing else: no transaction event is ever
   * built. Pinned, because `SENTRY_TRACE_LIFECYCLE=static` in the host's
   * environment would otherwise switch both runtimes to transactions, whose
   * console breadcrumbs carry Next's printout of the failed query (message and
   * stack), and under which the SDK ignores the hook below
   * (@sentry/core client.js:110-116).
   */
  traceLifecycle: 'stream',

  /**
   * §12.165. Every span keeps its status and loses its status message, which
   * on a failed query is the Postgres error word for word (3bw found wrong 9).
   */
  beforeSendSpan: textlessSpan,

  /**
   * No AI-monitoring integration: with tracing on, Sentry installs ten by
   * default, and they record prompts and replies on spans.
   */
  integrations: withoutAiIntegrations,
});

/**
 * §12.143. Every error event's exception rebuilt from the error's type and
 * stack frames, before Sentry parses its message lines into frames — whoever
 * captured it: onRequestError, or Sentry's own wrappers around pages, actions
 * and route handlers (src/lib/sentry-server-errors.ts).
 */
Sentry.addIntegration(textlessErrors());
