import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REDACTED, redactBuffer, redactTree, secretsFromEnv } from '../../e2e/redact';
import { redactOutputs } from '../../e2e/global-teardown';

/**
 * §12.86. The e2e password left on disk by a failed sign-in, and the pass
 * that removes it. A fake secret throughout — the real one never enters a
 * test.
 */

const SECRET = 'e2e-FakeSecretForRedaction9';
let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('secretsFromEnv', () => {
  it('takes the e2e password, and ignores one too short to scrub safely', () => {
    expect(secretsFromEnv({ E2E_PASSWORD: SECRET })).toEqual([SECRET]);
    expect(secretsFromEnv({ E2E_PASSWORD: 'abc' })).toEqual([]);
    expect(secretsFromEnv({})).toEqual([]);
  });
});

describe('redactBuffer', () => {
  it('replaces the raw, form-encoded and base64 forms, and nothing else', () => {
    const text = [
      `- textbox "Password" [ref=e12]: ${SECRET}`,
      `password=${encodeURIComponent(SECRET)}&email=e2e%40x.test`,
      `"postData":"${Buffer.from(SECRET).toString('base64')}"`,
    ].join('\n');
    const r = redactBuffer(Buffer.from(text), [SECRET]);
    expect(r.count).toBe(3);
    const out = r.buf.toString();
    expect(out).not.toContain(SECRET);
    expect(out).toContain(`[ref=e12]: ${REDACTED}`);
    expect(out).toContain('email=e2e%40x.test');
  });
});

describe('redactTree', () => {
  /** The shape of a failed sign-in's folder: error-context.md and a trace. */
  function failedRun(): string {
    dir = mkdtempSync(join(tmpdir(), 'redact-test-'));
    const test = join(dir, 'auth.setup.ts-sign-in');
    mkdirSync(join(test, 'trace', 'resources'), { recursive: true });
    writeFileSync(join(test, 'error-context.md'), `textbox "Password": ${SECRET}\n`);
    writeFileSync(join(test, 'test-failed-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(test, 'trace', 'test.trace'), `{"method":"fill","params":{"value":"${SECRET}"}}\n`);
    writeFileSync(join(test, 'trace', 'resources', 'body.dat'), `password=${SECRET}`);
    writeFileSync(join(test, 'trace', 'resources', 'clean.dat'), 'nothing here');
    execFileSync('zip', ['-q', '-r', '-X', join(test, 'trace.zip'), '.'], {
      cwd: join(test, 'trace'),
    });
    rmSync(join(test, 'trace'), { recursive: true });
    return test;
  }

  it('leaves no copy on disk, in a file or inside a zip', () => {
    const test = failedRun();
    const report = redactTree(dir!, [SECRET]);

    expect(report.remaining).toEqual([]);
    expect(report.replaced).toBe(3);
    expect(report.files.map((f) => f.slice(test.length + 1)).sort()).toEqual([
      'error-context.md',
      'trace.zip',
    ]);
    expect(readFileSync(join(test, 'error-context.md'), 'utf8')).toContain(REDACTED);
    // Every entry is still in the trace, under the same name.
    const entries = execFileSync('unzip', ['-Z1', join(test, 'trace.zip')])
      .toString()
      .split('\n')
      .filter((n) => n && !n.endsWith('/'))
      .sort();
    expect(entries).toEqual(['resources/body.dat', 'resources/clean.dat', 'test.trace']);
    const body = execFileSync('unzip', ['-p', join(test, 'trace.zip'), 'resources/body.dat']);
    expect(body.toString()).toBe(`password=${REDACTED}`);
  });

  it('is a no-op on a clean run, and on a folder that does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'redact-test-'));
    writeFileSync(join(dir, 'a.md'), 'clean');
    expect(redactTree(dir, [SECRET])).toEqual({ replaced: 0, files: [], remaining: [] });
    expect(redactTree(join(dir, 'missing'), [SECRET]).remaining).toEqual([]);
  });
});

/**
 * §12.96. The teardown's pass, which runs whatever reporters a run was given:
 * a run with its own `--reporter` dropped the redact reporter and kept the
 * password in a trace.
 */
describe('the global teardown scrubs every project folder', () => {
  it('leaves no copy in any project, and says what it scrubbed', () => {
    dir = mkdtempSync(join(tmpdir(), 'redact-test-'));
    const a = join(dir, 'chromium');
    const b = join(dir, 'phone-signout');
    mkdirSync(join(a, 'one-test'), { recursive: true });
    mkdirSync(join(b, 'other-test'), { recursive: true });
    writeFileSync(join(a, 'one-test', 'error-context.md'), `textbox "Password": ${SECRET}\n`);
    writeFileSync(join(b, 'other-test', 'note.txt'), `password=${encodeURIComponent(SECRET)}`);

    const report = redactOutputs(
      // Two projects sharing a folder count it once.
      { projects: [{ outputDir: a }, { outputDir: b }, { outputDir: a }] },
      { E2E_PASSWORD: SECRET },
    );

    expect(report.remaining).toEqual([]);
    expect(report.replaced).toBe(2);
    expect(readFileSync(join(a, 'one-test', 'error-context.md'), 'utf8')).not.toContain(SECRET);
    expect(readFileSync(join(b, 'other-test', 'note.txt'), 'utf8')).toBe(`password=${REDACTED}`);
  });

  it('does nothing without a password to look for', () => {
    dir = mkdtempSync(join(tmpdir(), 'redact-test-'));
    writeFileSync(join(dir, 'a.md'), SECRET);
    const report = redactOutputs({ projects: [{ outputDir: dir }] }, {});
    expect(report).toEqual({ replaced: 0, files: [], remaining: [] });
  });
});
