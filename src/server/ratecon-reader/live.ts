import 'server-only';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { db } from '@/db';
import type { ReaderConfig } from '@/env/schema';
import { readerEnv, serverEnv } from '@/env/server';
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

/** Said once per server instance, not on every page and every read. */
let problemsLogged = false;

/**
 * The reader's settings (`parseReaderEnv`). FAILS CLOSED: with any problem
 * the reader is off — no button, the route says `disabled` — and the
 * problems are logged once, by setting name, never by value.
 */
function liveConfig(): ReaderConfig {
  if (readerEnv.problems.length > 0 && !problemsLogged) {
    problemsLogged = true;
    logReaderMisconfigured(readerEnv.problems);
  }
  return readerEnv;
}

function readerSettings(): ReadSettings {
  const config = liveConfig();
  return {
    enabled: config.on,
    vendor: config.on ? config.vendor : null,
    userCap: config.userCap,
    dailyCap: config.dailyCap,
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
function fakeSteps(path: string | null): FakeStep[] {
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
  const config = liveConfig();
  if (config.on && config.vendor === 'anthropic') return new AnthropicReaderAdapter({ apiKey: config.apiKey, model: config.model });
  if (config.on && config.vendor === 'fake') return new FakeReaderAdapter(fakeSteps(config.fakeScript));
  // Unreachable — the route answers `disabled` first — and if it were not,
  // a fake with no steps: every read `unavailable`, never a script, no network.
  return new FakeReaderAdapter([]);
}

export function liveReadDeps(): ReadDeps {
  return { db, settings: readerSettings(), adapter: liveAdapter, timeoutMs: READ_TIMEOUT_MS, now: () => new Date() };
}
