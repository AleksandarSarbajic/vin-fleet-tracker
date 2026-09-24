import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

/**
 * What the worker says when it dies, on a host where saying it is all there is.
 *
 * Found by deploying: the first run on the droplet printed
 *
 *     {"t":"…","level":"error","msg":"invalid worker environment"}
 *     {"t":"…","level":"error","msg":"uncaught exception","fatal":true}
 *
 * — the whole failure with the cause removed. `cause` is deliberately kept out
 * of the JSON line, because an Error serialises to `{}` and would land as
 * noise, and it goes to Sentry instead for its stack. That is the right split
 * and it quietly made journald useless for the one case it matters most in.
 *
 * journald is the PRIMARY record for this process (phase 6, item 2 — the whole
 * reason the worker is leaving a laptop). Sentry is the second copy. The second
 * copy must never be the only legible one.
 */

const lines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

afterEach(() => vi.restoreAllMocks());

describe('the worker log line', () => {
  it('keeps an Error out of the JSON, where it would serialise to {}', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('routing sweep failed', {
      cause: new Error('HERE returned 503'),
      error: 'HERE returned 503',
      lane: 'CHI-DAL',
    });

    const [line] = lines(spy);
    expect(line).toBeDefined();
    expect(line).not.toHaveProperty('cause');
    // …but the detail survives, because the call site also passed it flat.
    expect(line!['error']).toBe('HERE returned 503');
    expect(line!['lane']).toBe('CHI-DAL');
  });

  it('never emits a fatal line whose only content is that it was fatal', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Exactly what `die()` does on an uncaught exception.
    logger.error('uncaught exception', {
      error: 'connect ECONNREFUSED',
      cause: new Error('connect ECONNREFUSED'),
      fatal: true,
    });

    const [line] = lines(spy);
    expect(line!['fatal']).toBe(true);
    expect(line!['error']).toBe('connect ECONNREFUSED');
    // The regression: a line carrying only msg + fatal and no reason at all.
    const informative = Object.keys(line!).filter(
      (k) => !['t', 'level', 'msg', 'fatal'].includes(k),
    );
    expect(
      informative,
      'A fatal line must name its cause. journald is the only record on the ' +
        'worker host, and a crash that logs nothing but "fatal" is the ' +
        'failure with the reason deleted.',
    ).not.toEqual([]);
  });

  it('passes warnings and info through without a cause field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('poll stall ended', { stalledSeconds: 2040 });
    expect(lines(warn)[0]).toMatchObject({ level: 'warn', stalledSeconds: 2040 });
  });

  it('keeps fields when there is no cause at all', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('poll: ingested', { vehicles: 34 });
    expect(lines(info)[0]).toMatchObject({ level: 'info', msg: 'poll: ingested', vehicles: 34 });
  });
});
