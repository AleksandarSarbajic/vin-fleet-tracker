import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_REPLY } from '@/test/model-read-fixtures';

/**
 * The live wiring of the reader (docs/llm-reader-design.md §4): which
 * settings the route runs with, whether the strip offers "Read with AI", and
 * the fake's script for e2e and local runs. Loads the REAL `@/env/server`.
 */

vi.mock('server-only', () => ({}));
// The pooled connection is never opened by these tests; the module must load.
vi.mock('@/db', () => ({ db: {} }));

const BASE = { DATABASE_URL: 'postgres://postgres@127.0.0.1:55432/fleet_test' };
const dirs: string[] = [];

async function live(vars: Record<string, string>) {
  vi.resetModules();
  for (const key of ['LLM_READER_ENABLED', 'LLM_READER_VENDOR', 'LLM_READER_FAKE_SCRIPT', 'VERCEL_ENV']) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries({ ...BASE, ...vars })) vi.stubEnv(key, value);
  return import('./live');
}
const script = (content: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-script-'));
  dirs.push(dir);
  const file = join(dir, 'steps.json');
  writeFileSync(file, content);
  return file;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('whether the strip offers "Read with AI"', () => {
  it('only with the flag on, a vendor set, and a dispatcher or admin', async () => {
    const on = await live({ LLM_READER_ENABLED: 'true', LLM_READER_VENDOR: 'fake' });
    expect([on.readerOffered('dispatcher'), on.readerOffered('admin'), on.readerOffered('viewer')]).toEqual([true, true, false]);
  });

  it('not with the flag off, whatever else is set', async () => {
    expect((await live({ LLM_READER_VENDOR: 'fake' })).readerOffered('admin')).toBe(false);
  });

  it('not with the flag on and no vendor', async () => {
    expect((await live({ LLM_READER_ENABLED: 'true' })).readerOffered('admin')).toBe(false);
  });
});

describe('the settings the route runs with', () => {
  it('the caps from the env, the dispatch zone, a 25 s timeout', async () => {
    const m = await live({ LLM_READER_ENABLED: '1', LLM_READER_VENDOR: 'fake', LLM_READER_USER_DAILY_CAP: '4', DISPATCH_TZ: 'America/Denver' });
    const deps = m.liveReadDeps();
    expect(deps.settings).toEqual({ enabled: true, vendor: 'fake', userCap: 4, dailyCap: 100, tz: 'America/Denver' });
    expect(deps.timeoutMs).toBe(25_000);
  });
});

describe("the fake's script", () => {
  it('none set: a fake with no steps, which says unavailable', async () => {
    const adapter = (await live({ LLM_READER_ENABLED: 'true', LLM_READER_VENDOR: 'fake' })).liveReadDeps().adapter();
    expect(await adapter.read({ lines: [{ n: 1, text: 'x' }], today: '2026-10-13' }, new AbortController().signal)).toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });

  it('a file of steps: played in order, a fresh copy for every read', async () => {
    const file = script(JSON.stringify([{ reply: MODEL_REPLY }, { fail: 'refused' }]));
    const deps = (await live({ LLM_READER_ENABLED: 'true', LLM_READER_VENDOR: 'fake', LLM_READER_FAKE_SCRIPT: file })).liveReadDeps();
    const request = { lines: [{ n: 1, text: 'x' }], today: '2026-10-13' };
    expect(await deps.adapter().read(request, new AbortController().signal)).toMatchObject({ ok: true, output: MODEL_REPLY });
    expect(await deps.adapter().read(request, new AbortController().signal)).toMatchObject({ ok: true, output: MODEL_REPLY });
  });

  it('a file that is not a list of steps fails the read loudly, with a message that quotes nothing from it', async () => {
    const file = script(JSON.stringify({ not: 'steps', secret: 'qqfileqq' }));
    const deps = (await live({ LLM_READER_ENABLED: 'true', LLM_READER_VENDOR: 'fake', LLM_READER_FAKE_SCRIPT: file })).liveReadDeps();
    expect(() => deps.adapter()).toThrow(/LLM_READER_FAKE_SCRIPT/);
    expect(() => deps.adapter()).not.toThrow(/qqfileqq/);
  });
});
