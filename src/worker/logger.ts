import type { Logger } from '@/samsara/client';

/** Structured single-line JSON — greppable in a log aggregator at 3am. */
function emit(level: string, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export const logger: Logger = {
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
};
