import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * §12.74. The deploy's verification, run for real against stub commands.
 *
 * Twice now this step has shown evidence that was not true: the FIRST poll in
 * the journal under "most recent poll" (grep -m1), and then "no poll in the
 * last 3 minutes" while a poll existed, because shell quoting broke on the way
 * to the droplet. Both read as a worker that is not polling. These run the
 * actual remote script with a journal whose poll lines look like real ones —
 * JSON, full of spaces and quotes — and check what it says.
 */

const REMOTE = join(process.cwd(), 'scripts/deploy-verify.remote.sh');
const DEPLOY = join(process.cwd(), 'scripts/deploy.sh');
const SERVICE = 'vin-fleet-worker.service';

const poll = (t: string) =>
  `{"t":"${t}","level":"info","msg":"poll: ingested","vehicles":13,"inserted":61,"breaker":"closed"}`;

let dir: string;

function stub(name: string, body: string): void {
  const path = join(dir, 'bin', name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/** Runs the remote script; `secondExit` is what the second worker exits with. */
function verify(journal: string[], secondExit = 1): { code: number; out: string } {
  writeFileSync(join(dir, 'journal'), journal.join('\n') + (journal.length ? '\n' : ''));
  try {
    const out = execFileSync('bash', [REMOTE, join(dir, 'app'), SERVICE, join(dir, 'worker.env')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Stubs first, so `sudo`, `systemctl` and `journalctl` are ours.
        PATH: `${join(dir, 'bin')}:${process.env['PATH'] ?? ''}`,
        JOURNAL: join(dir, 'journal'),
        SECOND_EXIT: String(secondExit),
      },
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deploy-verify-'));
  execFileSync('mkdir', ['-p', join(dir, 'bin'), join(dir, 'app')]);
  writeFileSync(join(dir, 'worker.env'), '# comment\nDIRECT_URL=postgres://x\nSENTRY_RELEASE=abc\n');
  // `sudo -u vinfleet git rev-parse HEAD`, and the second worker instance.
  stub('sudo', [
    'if [[ " $* " == *" git "* ]]; then echo 77868b8; exit 0; fi',
    'echo \'{"level":"error","msg":"another worker is already running"}\'',
    'exit "$SECOND_EXIT"',
  ].join('\n'));
  stub('systemctl', 'echo 0');
  stub('journalctl', 'cat "$JOURNAL"');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the deploy verification (§12.74)', () => {
  it('shows the MOST RECENT poll, intact, when there are several', () => {
    const { code, out } = verify([
      poll('2026-09-25T14:01:04.000Z'),
      '{"level":"info","msg":"arrival sweep","considered":0}',
      poll('2026-09-25T14:02:04.417Z'),
    ]);
    expect(code).toBe(0);
    expect(out).toContain('--- most recent poll ---');
    expect(out).toContain(poll('2026-09-25T14:02:04.417Z'));
    expect(out).not.toContain('14:01:04');
    expect(out).not.toContain('no poll in the last 3 minutes');
    expect(out).not.toMatch(/binary operator|usage: grep/i);
  });

  it('says there is no poll when there is none, and does not abort', () => {
    const { code, out } = verify(['{"level":"info","msg":"singleton lock acquired"}']);
    expect(code).toBe(0);
    expect(out).toContain('(no poll in the last 3 minutes');
  });

  it('reports the commit, the restarts, and the refused second instance', () => {
    const { out } = verify([poll('2026-09-25T14:02:04.417Z')]);
    expect(out).toContain('running commit: 77868b8');
    expect(out).toContain('restarts since start: 0');
    expect(out).toContain('another worker is already running');
  });

  it('fails the deploy when a second instance is allowed to start', () => {
    const { code, out } = verify([poll('2026-09-25T14:02:04.417Z')], 0);
    expect(code).toBe(1);
    expect(out).toContain('THE SECOND INSTANCE STARTED');
  });

  /**
   * The structural half. The bug lived in a double-quoted string that this
   * laptop's shell expanded before ssh sent it; the script is now sent as a
   * file on stdin, and the old string must not come back.
   */
  it('deploy.sh sends the script as a file, not as an expanded string', () => {
    const deploy = readFileSync(DEPLOY, 'utf8');
    expect(deploy).toMatch(
      /ssh "\$HOST" bash -s -- "\$APP_DIR" "\$SERVICE" "\$ENV_FILE" \\\n\s+< "\$\(dirname "\$0"\)\/deploy-verify\.remote\.sh"/,
    );
    expect(deploy).not.toContain('most recent poll');
    execFileSync('bash', ['-n', DEPLOY]);
    execFileSync('bash', ['-n', REMOTE]);
  });
});
