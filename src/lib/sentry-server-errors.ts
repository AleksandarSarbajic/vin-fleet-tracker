import type { Client, ErrorEvent, Event, EventHint, Exception, Integration, Mechanism, StackParser } from '@sentry/core';
import { isReaderEvent, scrubReaderEvent, withoutText } from './sentry-reader';

/**
 * No server error event carries text (§12.143). The one place that decides
 * what an error is allowed to become in Sentry: its type and its stack frames,
 * its causes' too, and never a message.
 *
 * A message is not safe anywhere in an event. A Drizzle error's message is the
 * SQL and its bound values; a JSON parse error's quotes the body. Dropping the
 * exception's value is not enough: Sentry parses every line of the stack text,
 * and a message line holding " at " becomes a frame (3aq). So the text is cut
 * from the error BEFORE its frames are parsed, here, and every event is then
 * scrubbed again by `scrubServerEvent`, for whatever this did not see.
 *
 * No Node import: the edge config uses this too.
 */

export const REMOVED = '[removed: a server error never reports its text]';
/** Five digits or capitals: anything else in `code` is not a SQLSTATE. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** Causes followed, as many as Sentry's own linkedErrors follows. */
const MAX_CAUSES = 5;
/** A V8 frame line, `    at fn (file:1:2)`. */
const FRAME = /^\s+at /;

/** What Sentry's `isError` accepts, so an error from another realm is not missed. */
function isError(value: unknown): value is Error {
  if (value instanceof Error) return true;
  const tag = Object.prototype.toString.call(value);
  return ['[object Error]', '[object Exception]', '[object DOMException]', '[object WebAssembly.Exception]'].includes(tag);
}

/**
 * postgres.js's error, by its shape. Not `instanceof`: the build bundles
 * postgres.js once per layer (the routes', the pages', instrumentation's), so
 * the class a module imports is not always the class that threw, and its name
 * ships minified to one letter.
 */
function isPostgresError(error: Error): error is Error & { code: string } {
  return (
    'severity' in error &&
    typeof error.severity === 'string' &&
    'code' in error &&
    typeof error.code === 'string' &&
    SQLSTATE.test(error.code)
  );
}

/** Drizzle's query error, by its shape: it never sets a name ("Error"). */
function isDrizzleQueryError(error: Error): boolean {
  return 'query' in error && typeof error.query === 'string' && 'params' in error && Array.isArray(error.params);
}

/** An error's type as Sentry and the console line both show it. */
export function errorType(error: unknown): string {
  if (!isError(error)) return `Thrown ${typeof error}`;
  if (isPostgresError(error)) return 'PostgresError';
  if (isDrizzleQueryError(error)) return 'DrizzleQueryError';
  return error.name;
}

/** The SQLSTATE of a postgres.js error, the error itself or a cause. A code, never its text. */
export function sqlstateOf(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; isError(current) && depth <= MAX_CAUSES; depth += 1) {
    if (isPostgresError(current)) return current.code;
    current = current.cause;
  }
  return undefined;
}

/**
 * What Sentry is shown instead of an error: an Error with its type and its
 * stack frames, and its causes in the same form. Nothing else is copied — not
 * `detail`, `where`, `query` or `parameters` — and the message is cut out of
 * the stack text as well as the value.
 */
export function typeAndStack(error: unknown, depth = 0): Error {
  const standIn = new Error(REMOVED);
  standIn.name = errorType(error);
  if (!isError(error)) return standIn;
  const stack = error.stack ?? '';
  const at = error.message ? stack.indexOf(error.message) : -1;
  const cut = at === -1 ? stack : stack.slice(0, at) + stack.slice(at + error.message.length);
  standIn.stack = [`${standIn.name}: ${REMOVED}`, ...cut.split('\n').filter((line) => FRAME.test(line))].join('\n');
  if (error.cause !== undefined && depth < MAX_CAUSES) standIn.cause = typeAndStack(error.cause, depth + 1);
  return standIn;
}

/**
 * An ERROR event's whole exception list, rebuilt from `typeAndStack` of the
 * error that was captured: the error last, its causes before it, as
 * linkedErrors orders them, with linkedErrors' mechanism fields. Whatever was
 * there is replaced, so it makes no difference whether linkedErrors ran first.
 *
 * Frames are parsed as Sentry parses them (`stackParser(stack, 1)`,
 * @sentry/core utils/eventbuilder.js:8–9). A transaction, or an event with no
 * captured Error, is left as it is: `scrubServerEvent` still takes its text.
 */
export function rebuildException(event: Event, hint: EventHint | undefined, parser: StackParser): void {
  const captured = hint?.originalException;
  if (event.type !== undefined || !isError(captured)) return;
  const chain: Error[] = [];
  for (let e: unknown = typeAndStack(captured); isError(e) && chain.length <= MAX_CAUSES; e = e.cause) {
    chain.push(e);
  }
  const capturedMechanism = event.exception?.values?.at(-1)?.mechanism;
  const values = chain.map((e, i): Exception => {
    const frames = parser(e.stack ?? '', 1);
    const mechanism: Mechanism | undefined =
      i > 0
        ? { handled: true, type: 'chained', source: 'cause', exception_id: i, parent_id: i - 1 }
        : chain.length > 1
          ? { handled: true, type: 'auto.core.linked_errors', ...capturedMechanism, exception_id: 0 }
          : capturedMechanism;
    return {
      type: e.name,
      value: REMOVED,
      ...(frames.length ? { stacktrace: { frames } } : {}),
      ...(mechanism ? { mechanism } : {}),
    };
  });
  event.exception = { ...event.exception, values: values.reverse() };
}

/**
 * The integration both server configs add. It hooks in `afterAllSetup`, so
 * its listener runs after every other integration's `preprocessEvent` —
 * linkedErrors' among them, wherever this sits in the list — and before any
 * `processEvent`: source context and the frame rewrite for source maps still
 * apply to the rebuilt frames.
 *
 * Every capture goes through it: Sentry's wrappers around pages, server
 * actions and route handlers capture the raw error themselves, before
 * `onRequestError` (@sentry/nextjs common/wrapServerComponentWithSentry.js:35).
 */
export function textlessErrors(): Integration {
  return {
    name: 'TextlessErrors',
    afterAllSetup(client: Client) {
      client.on('preprocessEvent', (event, hint) => rebuildException(event, hint, client.getOptions().stackParser));
    },
  };
}

/**
 * Both server configs' `beforeSend`, the backstop: an event from the reader
 * route exactly as `scrubReaderEvent` leaves it, any other error event through
 * `withoutText`. `beforeSend` sees error events only; transactions and spans
 * have their own hooks, which neither config sets.
 */
export function scrubServerEvent(event: ErrorEvent): ErrorEvent {
  return isReaderEvent(event) ? scrubReaderEvent(event) : withoutText(event, REMOVED);
}
