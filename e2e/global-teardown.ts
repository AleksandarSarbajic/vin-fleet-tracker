import { existsSync, readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
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

export default async function globalTeardown(): Promise<void> {
  loadEnv({ path: '.env.local' });
  const result = await runTeardown(process.env, () =>
    existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as unknown) : null,
  );
  if (!result.done) {
    throw new Error(`e2e teardown: the e2e account was NOT signed out. ${result.reason}`);
  }
  console.info(
    `e2e: signed the e2e account (${result.userId.slice(0, 8)}…) out everywhere, via its ${result.via}`,
  );
}
