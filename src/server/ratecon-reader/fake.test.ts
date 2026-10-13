import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_REPLY, SENTINEL } from '@/test/model-read-fixtures';
import type { SentLine } from '@/lib/ratecon/redact';
import { FakeReaderAdapter } from './fake';

/**
 * The fake vendor (docs/llm-reader-design.md §6): scripted, never a network
 * call, never a throw. Phase 2's route tests and the e2e run through it.
 */

const LINES: SentLine[] = [
  { n: 1, text: `Load # EX-40417 ${SENTINEL}` },
  { n: 2, text: `Pick Up 1 ${SENTINEL}` },
];
const live = () => new AbortController().signal;

describe('FakeReaderAdapter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the scripted reply and usage', async () => {
    const fake = new FakeReaderAdapter([{ reply: MODEL_REPLY, usage: { inputTokens: 3200, outputTokens: 540 } }]);
    expect(await fake.read(LINES, live())).toEqual({ ok: true, output: MODEL_REPLY, usage: { inputTokens: 3200, outputTokens: 540 } });
  });

  it('returns a scripted failure with its vendor status', async () => {
    const fake = new FakeReaderAdapter([{ fail: 'unavailable', vendorStatus: 503 }]);
    expect(await fake.read(LINES, live())).toEqual({ ok: false, code: 'unavailable', vendorStatus: 503 });
  });

  it('plays its steps in order, then says unavailable for every read after: it never throws', async () => {
    const fake = new FakeReaderAdapter([{ fail: 'refused' }, { reply: 'not json' }]);
    expect(await fake.read(LINES, live())).toMatchObject({ ok: false, code: 'refused' });
    expect(await fake.read(LINES, live())).toMatchObject({ ok: true, output: 'not json' });
    expect(await fake.read(LINES, live())).toEqual({ ok: false, code: 'unavailable', vendorStatus: null });
    expect(await fake.read(LINES, live())).toEqual({ ok: false, code: 'unavailable', vendorStatus: null });
  });

  it('records exactly what it was handed, every key, as it was at the call', async () => {
    const fake = new FakeReaderAdapter([{ reply: MODEL_REPLY }]);
    const lines = [{ n: 1, text: 'one', page: 2 }];
    await fake.read(lines, live());
    lines[0]!.text = 'changed after the call';
    expect(fake.received).toEqual([[{ n: 1, text: 'one', page: 2 }]]);
  });

  it('a delay ends in its step', async () => {
    const fake = new FakeReaderAdapter([{ delayMs: 20_000, then: { reply: MODEL_REPLY } }]);
    const pending = fake.read(LINES, live());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ ok: true });
  });

  it('an abort during the delay is a timeout, and the reply is never returned', async () => {
    const fake = new FakeReaderAdapter([{ delayMs: 30_000, then: { reply: MODEL_REPLY } }]);
    const abort = new AbortController();
    const pending = fake.read(LINES, abort.signal);
    await vi.advanceTimersByTimeAsync(25_000);
    abort.abort();
    expect(await pending).toEqual({ ok: false, code: 'timeout', vendorStatus: null });
  });

  it('a signal already aborted is a timeout at once', async () => {
    const abort = new AbortController();
    abort.abort();
    const fake = new FakeReaderAdapter([{ reply: MODEL_REPLY }]);
    expect(await fake.read(LINES, abort.signal)).toEqual({ ok: false, code: 'timeout', vendorStatus: null });
  });
});
