import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/**
 * §12.86. Scrubs the e2e account's password out of a run's artifacts.
 *
 * Playwright has no way to mask a typed value, and a failed sign-in records
 * it in four places: the aria snapshot in `error-context.md` (which prints an
 * input's value, password fields included), the trace's `fill` step, the
 * trace's DOM snapshot, and the `POST /login` body in the trace's network
 * resources — plus a copy of `error-context.md` attached inside the trace.
 * Since §12.84 keeps twenty runs of these, each failed sign-in left the
 * password on disk for a day or more.
 *
 * So the redaction is after the fact and exhaustive rather than per-site:
 * every file in the run folder, and every entry inside every zip, is
 * rewritten, then scanned again. Anything left fails the run.
 */

export const REDACTED = '[REDACTED]';

/**
 * The secrets to scrub, from the environment. Only non-trivial values: a
 * short or empty one would "redact" ordinary text all over the trace.
 */
export function secretsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const password = env['E2E_PASSWORD'];
  return password && password.length >= 8 ? [password] : [];
}

/**
 * Each secret as it can appear: typed (raw), as a form field
 * (percent-encoded), and base64 — the trace stores some bodies that way.
 * Base64 only matches when the secret starts on a 3-byte boundary of the
 * encoded blob; a body that happens to misalign is not caught, which the
 * raw and encoded forms still cover for every body seen so far.
 */
function forms(secrets: string[]): Buffer[] {
  const out = new Set<string>();
  for (const s of secrets) {
    out.add(s);
    out.add(encodeURIComponent(s));
    out.add(Buffer.from(s).toString('base64'));
  }
  return [...out].map((f) => Buffer.from(f));
}

function replaceAll(buf: Buffer, needle: Buffer, replacement: Buffer): { buf: Buffer; count: number } {
  let count = 0;
  const parts: Buffer[] = [];
  let from = 0;
  for (let at = buf.indexOf(needle, from); at !== -1; at = buf.indexOf(needle, from)) {
    parts.push(buf.subarray(from, at), replacement);
    from = at + needle.length;
    count += 1;
  }
  if (count === 0) return { buf, count };
  parts.push(buf.subarray(from));
  return { buf: Buffer.concat(parts), count };
}

export function redactBuffer(buf: Buffer, secrets: string[]): { buf: Buffer; count: number } {
  let out = buf;
  let count = 0;
  for (const needle of forms(secrets)) {
    const r = replaceAll(out, needle, Buffer.from(REDACTED));
    out = r.buf;
    count += r.count;
  }
  return { buf: out, count };
}

function containsAny(buf: Buffer, secrets: string[]): boolean {
  return forms(secrets).some((needle) => buf.includes(needle));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * A zip is unpacked, scrubbed and repacked with the system `unzip`/`zip` —
 * Playwright's own zip code is internal to its bundle. The entry names are
 * preserved exactly, which is all the trace viewer reads.
 */
function redactZip(path: string, secrets: string[]): number {
  const scratch = mkdtempSync(join(tmpdir(), 'e2e-redact-'));
  try {
    execFileSync('unzip', ['-q', '-o', path, '-d', scratch]);
    let count = 0;
    for (const file of walk(scratch)) {
      const r = redactBuffer(readFileSync(file), secrets);
      if (r.count > 0) {
        writeFileSync(file, r.buf);
        count += r.count;
      }
    }
    if (count > 0) {
      rmSync(path);
      const entries = walk(scratch).map((f) => relative(scratch, f));
      execFileSync('zip', ['-q', '-X', path, ...entries], { cwd: scratch });
    }
    return count;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function zipEntriesContain(path: string, secrets: string[]): boolean {
  const names = execFileSync('unzip', ['-Z1', path]).toString().split('\n').filter(Boolean);
  return names.some((entry) =>
    containsAny(execFileSync('unzip', ['-p', path, entry], { maxBuffer: 1 << 28 }), secrets),
  );
}

export interface RedactReport {
  /** Occurrences replaced. */
  replaced: number;
  /** Files (zips counted once) that contained a secret. */
  files: string[];
  /** Files still containing a secret after the pass. Must be empty. */
  remaining: string[];
}

export function redactTree(root: string, secrets: string[]): RedactReport {
  const report: RedactReport = { replaced: 0, files: [], remaining: [] };
  if (secrets.length === 0) return report;
  let paths: string[];
  try {
    paths = walk(root);
  } catch {
    return report; // No folder: the run produced no artifacts.
  }
  for (const path of paths) {
    const n = path.endsWith('.zip')
      ? redactZip(path, secrets)
      : (() => {
          const r = redactBuffer(readFileSync(path), secrets);
          if (r.count > 0) writeFileSync(path, r.buf);
          return r.count;
        })();
    if (n > 0) {
      report.replaced += n;
      report.files.push(path);
    }
  }
  // Scanned again, zips entry by entry: the claim is "none left", not
  // "we replaced some".
  for (const path of walk(root)) {
    const leaks = path.endsWith('.zip')
      ? zipEntriesContain(path, secrets) || containsAny(readFileSync(path), secrets)
      : containsAny(readFileSync(path), secrets);
    if (leaks) report.remaining.push(path);
  }
  return report;
}

/**
 * Every project's output folder, scrubbed — one report for the run. Called
 * from the global teardown, which runs whatever reporters a run was given
 * (§12.96), and again from the redact reporter when it is in the list.
 */
export function redactRun(outputDirs: string[], secrets: string[]): RedactReport {
  const total: RedactReport = { replaced: 0, files: [], remaining: [] };
  for (const dir of new Set(outputDirs)) {
    const r = redactTree(dir, secrets);
    total.replaced += r.replaced;
    total.files.push(...r.files);
    total.remaining.push(...r.remaining);
  }
  return total;
}
