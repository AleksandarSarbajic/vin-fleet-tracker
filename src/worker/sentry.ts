import * as Sentry from '@sentry/node';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';

/**
 * Error reporting for the worker process (phase 6, item 4).
 *
 * The worker and the Next app are separate Sentry PROJECTS, not two halves of
 * one. They are different runtimes with different failure modes — the app
 * fails per-request in front of a dispatcher who can see it, the worker fails
 * alone at 3am with nobody watching — and mixing them makes the second kind
 * invisible behind the volume of the first. Separate projects also mean
 * separate quotas, so a chatty app cannot starve the worker's reporting.
 *
 * Deliberately NOT Sentry's recommended `node --import ./instrument.js`
 * preload. That pattern exists to let the SDK monkey-patch HTTP and database
 * libraries before they are imported, which buys automatic performance tracing
 * we are not asking for. What we want is errors, and errors are capturable from
 * inside the process. The cost is honest and small: spans for outbound calls
 * made during module evaluation are not instrumented. Nothing does that here.
 */

let active = false;

/** True once `init` has been given a DSN. Callers use it to stay silent. */
export const sentryActive = (): boolean => active;

export interface WorkerSentryOptions {
  dsn: string | undefined;
  environment: string;
  /** Usually the deployed commit. Absent locally, which is fine. */
  release?: string | undefined;
}

/**
 * Starts reporting, or says why it is not.
 *
 * Absent a DSN this is a no-op and the worker runs exactly as before. That is
 * deliberate and matches how the HERE key is treated (§12.31): an observability
 * dependency must never be able to keep the ingestion worker off the air. A
 * fleet nobody can see is a worse outcome than errors nobody records.
 */
export function initWorkerSentry(options: WorkerSentryOptions): boolean {
  if (!options.dsn) {
    active = false;
    return false;
  }

  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,

    /**
     * Errors only. No performance tracing.
     *
     * The worker makes the same four calls every 30 seconds forever; a trace
     * of one is a trace of all of them, and sampling them would spend the
     * quota that the rare interesting failure needs. Raise this deliberately
     * if a latency question ever actually arises.
     */
    tracesSampleRate: 0,

    /** `SENTRY_DEBUG=1` on the droplet, without a redeploy. */
    debug: process.env['SENTRY_DEBUG'] === '1',

    /**
     * v11 collects bound database query parameters and stack-frame locals
     * unless told not to — which for this process means position rows and
     * driver names. Shared with the app: src/lib/sentry-privacy.ts.
     */
    dataCollection: SENTRY_DATA_COLLECTION,

    /**
     * The console is NOT intercepted, on purpose.
     *
     * `captureConsoleIntegration` would work — `logger.ts` emits through
     * console.error — but it would send the serialised JSON line as the event
     * message, so every event would group by its own unique payload and
     * Sentry would show thousands of singletons instead of "this failed 400
     * times". `logger.ts` reports structurally instead: a stable message for
     * grouping, the fields as context, and the real Error where one exists.
     *
     * The default `consoleIntegration` is left ON, so console output still
     * arrives as breadcrumbs — the lines leading up to a failure, which is
     * exactly what a 3am reader wants underneath it.
     */

    /**
     * Sentry's own crash handlers are REMOVED, and `index.ts` owns them.
     *
     * Left in, every crash is reported twice: once by Sentry's handler and
     * once by ours, because the handler in `index.ts` reports through
     * `logger.error` in order to attach the worker's context — which stop it
     * was on, how long the feed had been unobserved. Two events for one crash
     * is not redundancy, it is two issues that each look half as frequent as
     * the problem really is.
     *
     * Ours is the one worth keeping: it carries that context, it flushes
     * before exiting so the last error actually ships, and owning the exit is
     * what lets the process die predictably for systemd to restart. It also
     * satisfies the standing rule that there are no unhandled rejections —
     * a rejection that reaches a default handler is unhandled by definition.
     */
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
  });

  Sentry.setTags({ service: 'worker', runtime: 'node' });
  active = true;
  return true;
}

/**
 * One error, reported with a stack when we have one.
 *
 * `cause` is the real Error object where the call site still had it. Passing it
 * matters: a stack is the difference between "a query failed somewhere in the
 * routing sweep" and a line number, and by the time the logger has turned it
 * into `error: message` the stack is gone.
 */
export function captureWorkerError(
  message: string,
  fields: Record<string, unknown> | undefined,
  cause: unknown,
): void {
  if (!active) return;
  Sentry.withScope((scope) => {
    if (fields && Object.keys(fields).length > 0) scope.setContext('fields', fields);
    if (cause instanceof Error) {
      /**
       * Grouped by OUR message, not by the exception's.
       *
       * Left alone, Sentry groups on the stack, so one failing query arriving
       * through three different sweeps becomes three issues — and the
       * dispatch-relevant fact ("the routing sweep is failing") is the thing
       * that gets split. The fingerprint puts it back.
       */
      scope.setFingerprint(['worker', message]);
      Sentry.captureException(cause);
    } else {
      Sentry.captureMessage(message, 'error');
    }
  });
}

/** Context for an error that has not happened yet. Breadcrumbs, not events. */
export function workerBreadcrumb(
  level: 'warning' | 'info',
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (!active) return;
  Sentry.addBreadcrumb({
    level,
    message,
    category: 'worker',
    // `exactOptionalPropertyTypes` — an absent key, not an explicit undefined.
    ...(fields ? { data: fields } : {}),
  });
}

/**
 * Hands queued events to Sentry before the process goes away.
 *
 * Without this, the last error before a shutdown — which is usually the one
 * that explains the shutdown — is dropped in the transport queue. Bounded, so
 * a Sentry outage cannot hold a `systemctl restart` open.
 */
export async function flushWorkerSentry(timeoutMs = 4_000): Promise<void> {
  if (!active) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Reporting the reporter is not a thing. Never block a clean exit on it.
  }
}

export { Sentry };
