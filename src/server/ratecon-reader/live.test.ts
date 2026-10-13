import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
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
  for (const key of [
    'LLM_READER_ENABLED',
    'LLM_READER_VENDOR',
    'LLM_READER_FAKE_SCRIPT',
    'LLM_READER_API_KEY',
    'LLM_READER_MODEL',
    'LLM_READER_USER_DAILY_CAP',
    'LLM_READER_DAILY_CAP',
    'VERCEL_ENV',
  ]) {
    vi.stubEnv(key, undefined);
  }
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

const KEY = 'sk-ant-api03-INVENTED-live-test-key';
const ANTHROPIC = { LLM_READER_ENABLED: 'true', LLM_READER_VENDOR: 'anthropic', LLM_READER_API_KEY: KEY, LLM_READER_MODEL: 'claude-haiku-5-5' };

describe('Anthropic, wired from the env', () => {
  it('offered, and the route runs with vendor anthropic, when the key and the model are set', async () => {
    const m = await live(ANTHROPIC);
    expect(m.readerOffered('dispatcher')).toBe(true);
    expect(m.liveReadDeps().settings.vendor).toBe('anthropic');
  });

  it('the model and the key the env names are the ones that go out', async () => {
    const deps = (await live({ ...ANTHROPIC, LLM_READER_MODEL: 'claude-sonnet-5-5' })).liveReadDeps();
    const sent: { body: { model?: unknown }; key: string | null }[] = [];
    // Guard 4 is replaced for this one adapter by a recorder: still no network.
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ body: JSON.parse(String(init?.body)) as { model?: unknown }, key: new Headers(init?.headers).get('x-api-key') });
      return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 });
    }) as typeof fetch;
    const adapter = deps.adapter();
    expect([adapter.vendor, adapter.model]).toEqual(['anthropic', 'claude-sonnet-5-5']);
    expect(await adapter.read({ lines: [{ n: 1, text: 'x' }], today: '2026-10-13' }, new AbortController().signal)).toEqual({
      ok: false,
      code: 'unavailable',
      vendorStatus: 529,
    });
    expect(sent).toEqual([{ body: expect.objectContaining({ model: 'claude-sonnet-5-5' }), key: KEY }]);
  });
});

describe('misconfigured, the reader FAILS CLOSED: off, said once by setting name, and the app still loads', () => {
  let errors: MockInstance;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it.each([
    ['no vendor', { LLM_READER_VENDOR: '' }, [['LLM_READER_VENDOR', 'missing']]],
    ['an unknown vendor', { LLM_READER_VENDOR: 'some-vendor' }, [['LLM_READER_VENDOR', 'invalid']]],
    ['the fake in production', { LLM_READER_VENDOR: 'fake', VERCEL_ENV: 'production' }, [['LLM_READER_VENDOR', 'refused in production']]],
    ['no key', { LLM_READER_API_KEY: '' }, [['LLM_READER_API_KEY', 'missing']]],
    ['no model', { LLM_READER_MODEL: '' }, [['LLM_READER_MODEL', 'missing']]],
    ['a model outside the allow-list', { LLM_READER_MODEL: 'claude-opus-5-5' }, [['LLM_READER_MODEL', 'not allowed']]],
    ['an invalid cap', { LLM_READER_DAILY_CAP: 'lots' }, [['LLM_READER_DAILY_CAP', 'invalid']]],
    ['a flag that is neither on nor off', { LLM_READER_ENABLED: 'yes please' }, [['LLM_READER_ENABLED', 'invalid']]],
  ] as const)('%s: not offered, the route says disabled, one log line names it', async (_, over, problems) => {
    const m = await live({ ...ANTHROPIC, ...over });
    expect(m.readerOffered('admin')).toBe(false);
    expect(m.liveReadDeps().settings).toMatchObject({ enabled: false, vendor: null });
    m.readerOffered('dispatcher');
    expect(errors.mock.calls).toEqual([
      ['ratecon reader is off: its settings have problems', { problems: problems.map(([setting, fault]) => ({ setting, fault })) }],
    ]);
    // Never a value: not the key, not the model, not the cap.
    for (const value of [KEY, 'claude-opus-5-5', 'some-vendor', 'lots', 'yes please']) {
      expect(JSON.stringify(errors.mock.calls)).not.toContain(value);
    }
  });

  it('a blank cap is its default: on, nothing said', async () => {
    const m = await live({ ...ANTHROPIC, LLM_READER_USER_DAILY_CAP: '', LLM_READER_DAILY_CAP: '' });
    expect(m.liveReadDeps().settings).toMatchObject({ enabled: true, vendor: 'anthropic', userCap: 25, dailyCap: 100 });
    expect(errors).not.toHaveBeenCalled();
  });

  it('with the flag off, a missing key is not a fault, and nothing is said', async () => {
    const m = await live({ ...ANTHROPIC, LLM_READER_ENABLED: 'false', LLM_READER_API_KEY: '' });
    expect(m.readerOffered('admin')).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });
});
