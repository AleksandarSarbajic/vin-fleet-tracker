import 'server-only';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { db } from '@/db';
import { serverEnv } from '@/env/server';
import { rankOf, type Role } from '@/lib/roles';
import type { ReaderAdapter } from './adapter';
import { FakeReaderAdapter, type FakeStep } from './fake';
import type { ReadDeps, ReadSettings } from './handle-read';

/**
 * The language-model reader, wired to the live app (docs/llm-reader-design.md
 * §4): the env's settings, the pooled database, the adapter the env names.
 * Only `fake` exists until a vendor is chosen.
 */

/** The server's own limit on a vendor call; the route's maxDuration (30 s) sits above it. */
const READ_TIMEOUT_MS = 25_000;

function readerSettings(): ReadSettings {
  return {
    enabled: serverEnv.LLM_READER_ENABLED,
    vendor: serverEnv.LLM_READER_VENDOR ?? null,
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

const Step: z.ZodType<FakeStep> = z.lazy(() =>
  z.union([
    z.strictObject({
      reply: z.unknown(),
      usage: z.strictObject({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) }).optional(),
    }),
    z.strictObject({
      fail: z.enum(['timeout', 'unavailable', 'refused', 'malformed']),
      vendorStatus: z.number().int().nullable().optional(),
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
  return new FakeReaderAdapter(fakeSteps());
}

export function liveReadDeps(): ReadDeps {
  return { db, settings: readerSettings(), adapter: liveAdapter, timeoutMs: READ_TIMEOUT_MS, now: () => new Date() };
}
