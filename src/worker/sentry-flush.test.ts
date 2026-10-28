import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

/**
 * `flushWorkerSentry` never blocks the exit and never fails silently: a flush
 * that rejects is one console line with the error's type, not its text
 * (§12.144). Sentry's `init` is a no-op here and `flush` a stub, so nothing
 * is sent anywhere.
 */

vi.mock('@sentry/node', () => ({ init: vi.fn(), setTags: vi.fn(), flush: vi.fn() }));

const Sentry = await import('@sentry/node');
const { flushWorkerSentry, initWorkerSentry } = await import('./sentry');

it('a flush that rejects: it still resolves, and says so in one line without the message', async () => {
  const S = `sx${randomUUID().replaceAll('-', '')}`;
  initWorkerSentry({ dsn: 'http://public@127.0.0.1:9/1', environment: 'test' });
  vi.mocked(Sentry.flush).mockRejectedValueOnce(new TypeError(`flush failed ${S}`));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(flushWorkerSentry(10)).resolves.toBeUndefined();
    expect(consoleError.mock.calls).toEqual([['sentry flush failed', { errorName: 'TypeError' }]]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(S);
  } finally {
    consoleError.mockRestore();
  }
});
