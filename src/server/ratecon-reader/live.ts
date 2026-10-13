import 'server-only';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { db } from '@/db';
import type { ReaderModel } from '@/env/schema';
import { serverEnv } from '@/env/server';
import { rankOf, type Role } from '@/lib/roles';
import type { ReaderAdapter } from './adapter';
import { AnthropicReaderAdapter } from './anthropic';
import { FakeReaderAdapter, type FakeStep } from './fake';
import type { ReadDeps, ReadSettings } from './handle-read';
import { logReaderMisconfigured } from './log';

/**
 * The language-model reader, wired to the live app (docs/llm-reader-design.md
 * §4): the env's settings, the pooled database, the adapter the env names —
 * `fake` (a script) or `anthropic`.
 */

/** The server's own limit on a vendor call; the route's maxDuration (30 s) sits above it. */
const READ_TIMEOUT_MS = 25_000;

/** Which adapter the env can actually run. `anthropic` carries its key and model, so none is looked up twice. */
export type ReaderWiring =
  | { vendor: null }
  | { vendor: 'fake' }
  | { vendor: 'anthropic'; apiKey: string; model: ReaderModel };

export type MissingSetting = 'LLM_READER_API_KEY' | 'LLM_READER_MODEL';

/**
 * FAILS CLOSED. The flag on and `anthropic` named, but no key or no model:
 * the reader is off — no button, the route says `disabled` — and `missing`
 * names what to set. Never a crash: the console does not depend on the
 * reader. (A model id outside the allow-list is refused at boot instead, by
 * the env schema, as an unknown vendor is.)
 */
export function readerWiring(env: {
  LLM_READER_ENABLED: boolean;
  LLM_READER_VENDOR?: 'fake' | 'anthropic' | undefined;
  LLM_READER_API_KEY?: string | undefined;
  LLM_READER_MODEL?: ReaderModel | undefined;
}): { wiring: ReaderWiring; missing: MissingSetting[] } {
  const vendor = env.LLM_READER_VENDOR;
  if (vendor === undefined) return { wiring: { vendor: null }, missing: [] };
  if (vendor === 'fake') return { wiring: { vendor: 'fake' }, missing: [] };
  const { LLM_READER_API_KEY: apiKey, LLM_READER_MODEL: model } = env;
  if (apiKey !== undefined && model !== undefined) return { wiring: { vendor, apiKey, model }, missing: [] };
  const missing: MissingSetting[] = [];
  if (apiKey === undefined) missing.push('LLM_READER_API_KEY');
  if (model === undefined) missing.push('LLM_READER_MODEL');
  return { wiring: { vendor: null }, missing: env.LLM_READER_ENABLED ? missing : [] };
}

/** Said once per server instance, not on every page and every read. */
let misconfigurationLogged = false;

function liveWiring(): ReaderWiring {
  const { wiring, missing } = readerWiring(serverEnv);
  if (missing.length > 0 && !misconfigurationLogged) {
    misconfigurationLogged = true;
    logReaderMisconfigured(missing);
  }
  return wiring;
}

function readerSettings(): ReadSettings {
  return {
    enabled: serverEnv.LLM_READER_ENABLED,
    vendor: liveWiring().vendor,
    userCap: serverEnv.LLM_READER_USER_DAILY_CAP,
    dailyCap: serverEnv.LLM_READER_DAILY_CAP,
    tz: serverEnv.DISPATCH_TZ,
  };
}

/** Whether the strip offers "Read with AI" to this user: the flag, a vendor, a dispatcher or admin. */
export function readerOffered(role: Role): boolean {
  const s = readerSettings();
  return s.enabled && s.vendor !== null && rankOf(role) >= rankOf('dispatcher');
}

const Usage = z.strictObject({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) });

const Step: z.ZodType<FakeStep> = z.lazy(() =>
  z.union([
    z.strictObject({ reply: z.unknown(), usage: Usage.optional() }),
    z.strictObject({
      fail: z.enum(['timeout', 'unavailable', 'refused', 'malformed', 'vendor_capped']),
      vendorStatus: z.number().int().nullable().optional(),
      usage: Usage.optional(),
    }),
    z.strictObject({ delayMs: z.number().int().min(0), then: Step }),
  ]),
) as z.ZodType<FakeStep>;

/** The fake's steps, from the file the env names; none when it names none. Read for every read, so a fresh copy each time. */
function fakeSteps(): FakeStep[] {
  const path = serverEnv.LLM_READER_FAKE_SCRIPT;
  if (!path) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Named, not quoted: the error can carry the file's text.
    throw new Error('LLM_READER_FAKE_SCRIPT could not be read as JSON.');
  }
  const steps = z.array(Step).safeParse(parsed);
  if (!steps.success) throw new Error('LLM_READER_FAKE_SCRIPT is not a list of fake steps.');
  return steps.data;
}

function liveAdapter(): ReaderAdapter {
  const wiring = liveWiring();
  if (wiring.vendor === 'anthropic') return new AnthropicReaderAdapter({ apiKey: wiring.apiKey, model: wiring.model });
  if (wiring.vendor === 'fake') return new FakeReaderAdapter(fakeSteps());
  // Unreachable — the route answers `disabled` first — and if it were not,
  // a fake with no steps: every read `unavailable`, never a script, no network.
  return new FakeReaderAdapter([]);
}

export function liveReadDeps(): ReadDeps {
  return { db, settings: readerSettings(), adapter: liveAdapter, timeoutMs: READ_TIMEOUT_MS, now: () => new Date() };
}
