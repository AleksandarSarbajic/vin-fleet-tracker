import * as Sentry from '@sentry/nextjs';
import { DrizzleQueryError } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { withoutText } from '@/lib/sentry-reader';

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

const REMOVED = '[removed: a route error never reports its message]';
/** Five digits or capitals: anything else in `code` is not a SQLSTATE and is not sent. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** Causes followed, as many as Sentry's own linkedErrors follows. */
const MAX_CAUSES = 5;
/** A V8 frame line, `    at fn (file:1:2)`. */
const FRAME = /^\s+at /;
/** The SDK's own flush timeout (`flushSafelyWithTimeout`, responseEnd.js:10). */
const FLUSH_MS = 2000;

export function unexpectedFailure(error: unknown, { prefix, log, message }: RouteFailure): NextResponse {
  const reference = `${prefix}-500-${Date.now().toString(36).toUpperCase()}`;
  console.error(log, {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  report(error, prefix, reference);
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
function report(error: unknown, prefix: string, reference: string): void {
  try {
    const sqlstate = sqlstateOf(error);
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

/**
 * What Sentry is handed instead of the error: an Error with its type and its
 * stack frames, and its causes in the same form (Drizzle wraps the
 * PostgresError). Nothing else is copied — not `detail`, `where`, `query` or
 * `parameters` — and the message is cut out of the stack text as well as the
 * value, because Sentry parses every line of that text: a message line
 * holding " at " becomes a frame, and a Drizzle message's `params:` line is
 * the bound values.
 */
function typeAndStack(error: unknown, depth = 0): Error {
  const standIn = new Error(REMOVED);
  if (!(error instanceof Error)) {
    standIn.name = `Thrown ${typeof error}`;
    return standIn;
  }
  standIn.name = typeName(error);
  const stack = error.stack ?? '';
  const at = error.message ? stack.indexOf(error.message) : -1;
  const cut = at === -1 ? stack : stack.slice(0, at) + stack.slice(at + error.message.length);
  standIn.stack = [`${standIn.name}: ${REMOVED}`, ...cut.split('\n').filter((line) => FRAME.test(line))].join('\n');
  if (error.cause !== undefined && depth < MAX_CAUSES) standIn.cause = typeAndStack(error.cause, depth + 1);
  return standIn;
}

/**
 * The production build minifies class names: postgres.js names its error
 * `this.constructor.name`, which ships as a single letter, and Drizzle's
 * never sets one ("Error"). These two are named by class.
 */
function typeName(error: Error): string {
  if (error instanceof postgres.PostgresError) return 'PostgresError';
  if (error instanceof DrizzleQueryError) return 'DrizzleQueryError';
  return error.name;
}

/** The SQLSTATE of a postgres.js error, the error itself or a cause. A code, never its text. */
function sqlstateOf(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; current instanceof Error && depth <= MAX_CAUSES; depth += 1) {
    if (current instanceof postgres.PostgresError && SQLSTATE.test(current.code)) return current.code;
    current = current.cause;
  }
  return undefined;
}
