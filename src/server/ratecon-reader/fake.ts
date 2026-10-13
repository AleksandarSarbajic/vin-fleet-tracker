import 'server-only';
import type { AdapterFailure, AdapterResult, AdapterUsage, ReaderAdapter, ReaderRequest } from './adapter';

/**
 * A scripted vendor for tests and e2e (docs/llm-reader-design.md §6). Makes
 * no network call and never throws. Plays its steps in order; once they run
 * out, every read is `unavailable`.
 *
 * Records each request it was handed — every key, deep-copied at the call —
 * so a test can prove what would have left the server.
 *
 * Selected by `LLM_READER_VENDOR=fake`, which the env schema refuses when
 * `VERCEL_ENV` is `production`.
 */

export type FakeStep =
  | { reply: unknown; usage?: AdapterUsage }
  | { fail: AdapterFailure; vendorStatus?: number | null; usage?: AdapterUsage }
  | { delayMs: number; then: FakeStep };

const TIMEOUT: AdapterResult = { ok: false, code: 'timeout', vendorStatus: null };

export class FakeReaderAdapter implements ReaderAdapter {
  readonly vendor = 'fake';
  readonly model = 'fake';
  readonly received: ReaderRequest[] = [];
  private readonly steps: FakeStep[];

  constructor(steps: readonly FakeStep[]) {
    this.steps = [...steps];
  }

  async read(request: ReaderRequest, signal: AbortSignal): Promise<AdapterResult> {
    this.received.push(structuredClone({ ...request, lines: [...request.lines] }));
    return this.play(this.steps.shift() ?? { fail: 'unavailable' }, signal);
  }

  private async play(step: FakeStep, signal: AbortSignal): Promise<AdapterResult> {
    if (signal.aborted) return TIMEOUT;
    if ('delayMs' in step) {
      const finished = await new Promise<boolean>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve(false);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(true);
        }, step.delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      return finished ? this.play(step.then, signal) : TIMEOUT;
    }
    if ('fail' in step) {
      const failed: AdapterResult = { ok: false, code: step.fail, vendorStatus: step.vendorStatus ?? null };
      return step.usage ? { ...failed, usage: step.usage } : failed;
    }
    return { ok: true, output: step.reply, usage: step.usage ?? { inputTokens: 0, outputTokens: 0 } };
  }
}
