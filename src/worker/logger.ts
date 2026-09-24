import type { Logger } from '@/samsara/client';
import { captureWorkerError, workerBreadcrumb } from './sentry';

/**
 * The worker's only way of saying anything (phase 6, item 4).
 *
 * Structured single-line JSON — greppable in journald at 3am — and, since
 * every error the worker reports already comes through here, the one place
 * Sentry needs to be wired into. Intercepting `console` would have caught the
 * same calls and grouped them uselessly: see the note in ./sentry.ts.
 */

/**
 * An Error hiding in the fields, pulled out before serialisation.
 *
 * `JSON.stringify(new Error('boom'))` is `{}`, so an Error passed as a field
 * lands in the log as an empty object and its stack is lost. Call sites that
 * still hold the real Error pass it as `cause`; it goes to Sentry, where a
 * stack is worth something, and never to the JSON line, where it is worth
 * nothing.
 */
function splitCause(fields?: Record<string, unknown>): {
  cause: unknown;
  rest: Record<string, unknown> | undefined;
} {
  if (!fields || !('cause' in fields)) return { cause: undefined, rest: fields };
  const { cause, ...rest } = fields;
  return { cause, rest: Object.keys(rest).length > 0 ? rest : undefined };
}

function emit(level: string, message: string, fields?: Record<string, unknown>): void {
  const { cause, rest } = splitCause(fields);

  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: message,
    ...rest,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);

  /**
   * Errors become Sentry events; warnings and info become breadcrumbs.
   *
   * The worker warns on things that are true for a while rather than wrong —
   * a routing budget past 70%, a stall that has ended — and every one of them
   * repeats on a schedule. As events they would be a pager that is always
   * going off; as breadcrumbs they are the context underneath the error that
   * eventually matters, which is where a reader actually wants them.
   */
  if (level === 'error') captureWorkerError(message, rest, cause);
  else workerBreadcrumb(level === 'warn' ? 'warning' : 'info', message, rest);
}

export const logger: Logger = {
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
};
