import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { withoutText } from '@/lib/sentry-reader';
import { REMOVED, errorType, sqlstateOf, typeAndStack } from '@/lib/sentry-server-errors';

/**
 * A route's UNEXPECTED error (§12.142): what every route under src/app/api
 * answers once its 4xx cases are ruled out.
 *
 * Until 3aq each route had its own copy of this — a reference, a console line,
 * a 500 — and none reached Sentry: the error was caught, so only the console
 * saw it, and Vercel's logs are not readable from here. Now one Sentry event
 * goes too, carrying the error's TYPE and STACK, the route's prefix, the
 * reference the dispatcher was shown and, for a database error, its SQLSTATE.
 * Never the message: a Drizzle error's message is the SQL and its bound
 * values, and a JSON parse error's quotes the body it was given.
 *
 * Since 3ar the console line carries no message either (§12.143): Vercel keeps
 * function logs, and the message is the same text.
 *
 * Not for the reader's two routes, which keep their own frozen log line
 * (src/server/ratecon-reader/log.ts).
 */

export interface RouteFailure {
  /** The reference's prefix, `DRIVER-GET` → `DRIVER-GET-500-…`; also a Sentry tag. */
  prefix: string;
  /** The console line's label, exactly as the route wrote it before 3aq. */
  log: string;
  /** What the response tells the dispatcher. */
  message: string;
}

/** The SDK's own flush timeout (`flushSafelyWithTimeout`, responseEnd.js:10). */
const FLUSH_MS = 2000;

export function unexpectedFailure(error: unknown, { prefix, log, message }: RouteFailure): NextResponse {
  const reference = `${prefix}-500-${Date.now().toString(36).toUpperCase()}`;
  const sqlstate = sqlstateOf(error);
  // A class name and a code, like the reader's line: never the message.
  console.error(log, { reference, errorName: errorType(error), ...(sqlstate ? { sqlstate } : {}) });
  report(error, prefix, reference, sqlstate);
  return NextResponse.json({ error: message, reference }, { status: 500 });
}

/**
 * One event, sent without being awaited, and never a reason the 500 does not
 * go out: a Sentry that throws is said on the console, by reference only.
 *
 * The flush is the SDK's own for a route handler — `waitUntil(
 * flushSafelyWithTimeout())` in the wrapper's `finally`
 * (@sentry/nextjs common/wrapRouteHandlerWithSentry.js:70–72) — minus the
 * `waitUntil`, which registers nothing outside the edge runtime
 * (@sentry/core utils/vercelWaitUntil.js:6–8). These routes run on Node. See
 * HANDOFF 3aq for what that leaves unverified on Vercel.
 */
function report(error: unknown, prefix: string, reference: string, sqlstate: string | undefined): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTags({ route_prefix: prefix, reference, ...(sqlstate ? { sqlstate } : {}) });
      // Scope processors run last (@sentry/core utils/prepareEvent.js:49–53),
      // after the breadcrumbs — this request's console lines among them — are on.
      scope.addEventProcessor((event) =>
        event.type === undefined ? withoutText({ ...event, type: undefined }, REMOVED) : event,
      );
      Sentry.captureException(typeAndStack(error));
    });
    Sentry.flush(FLUSH_MS).catch(() => notReported(reference));
  } catch {
    notReported(reference);
  }
}

function notReported(reference: string): void {
  console.error('route error not reported to Sentry', { reference });
}
