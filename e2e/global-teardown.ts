import { existsSync, readFileSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { redactRun, secretsFromEnv, type RedactReport } from './redact';
import { runSleepReport } from './run-clock';
import {
  envFromProcess,
  signOutE2eAccount,
  storedSession,
  type SignOutResult,
} from './sign-out';

/**
 * Runs once after every run, passed or failed: signs the e2e account out of
 * production Supabase auth everywhere, so its sessions stop piling up (100 of
 * them by 2026-10-01). See `sign-out.ts` for why it can only ever act on
 * `E2E_USER_ID`.
 *
 * A refusal or a failed sign-out FAILS the run rather than passing quietly:
 * either the suite is pointed at the wrong account, or sessions are about to
 * start accumulating again, and both are worth a red run.
 *
 * FIRST it scrubs the e2e password out of every project's output folder
 * (§12.86, §12.96). The redact reporter did that alone until a run with its
 * own `--reporter` dropped it and left the password in a trace. The teardown
 * runs whatever the reporters are, after every test has written its
 * artifacts, so the scrub lives here; a password still on disk afterwards
 * fails the run too. The sign-out runs either way.
 */
const STATE = 'e2e/.auth/dispatcher.json';

export async function runTeardown(
  env: Record<string, string | undefined>,
  readState: () => unknown,
  fetchImpl?: typeof fetch,
): Promise<SignOutResult> {
  return signOutE2eAccount(envFromProcess(env), {
    stored: storedSession(readState()),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

/** Every project's output folder, scrubbed of the e2e password. */
export function redactOutputs(
  config: { projects: ReadonlyArray<{ outputDir: string }> },
  env: Record<string, string | undefined>,
): RedactReport {
  return redactRun(
    config.projects.map((p) => p.outputDir),
    secretsFromEnv(env),
  );
}

export default async function globalTeardown(config: FullConfig): Promise<void> {
  loadEnv({ path: '.env.local' });
  const problems: string[] = [];

  const redaction = redactOutputs(config, process.env);
  if (redaction.replaced > 0) {
    console.info(
      `e2e: teardown redacted the e2e password (${redaction.replaced}×) from ${redaction.files.length} artifact(s)`,
    );
  }
  if (redaction.remaining.length > 0) {
    problems.push(`the e2e password is STILL in: ${redaction.remaining.join(', ')}.`);
  }

  const result = await runTeardown(process.env, () =>
    existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as unknown) : null,
  );
  if (result.done) {
    console.info(
      `e2e: signed the e2e account (${result.userId.slice(0, 8)}…) out everywhere, via its ${result.via}`,
    );
  } else {
    problems.push(`the e2e account was NOT signed out. ${result.reason}`);
  }

  // Said before anything can throw below it, so a failed run still says whether the machine slept.
  console.info(runSleepReport());

  if (problems.length > 0) throw new Error(`e2e teardown: ${problems.join(' ')}`);
}
