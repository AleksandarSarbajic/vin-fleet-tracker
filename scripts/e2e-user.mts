import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Creates or rotates the end-to-end test account. `npm run e2e:user`.
 *
 * Supabase Auth is hosted and there is no local stack here, so the e2e suite
 * signs in for real. It does that as a DEDICATED account rather than as a
 * person: the display-name test renames whoever it logs in as, and doing that
 * to a colleague's profile during a test run is not a trade worth making.
 *
 * The password is generated here and written straight into `.env.local`. It
 * is NEVER printed (§12.86): terminal scrollback and session transcripts are
 * artifacts too. Rotate it by running this again — which also signs the
 * account out EVERYWHERE, because a new password does not by itself revoke
 * the refresh tokens already issued, and old traces carry session cookies.
 * Delete the account in the Supabase dashboard when the suite is retired.
 *
 * The account is only half the story. Its `profiles` row — which carries the
 * ROLE, and which `getSessionUser` reads from our own database rather than
 * from any JWT claim — is created in the LOCAL test cluster by the Playwright
 * fixtures, not here. That split is the point: the session is real, the data
 * is disposable.
 */
loadEnv({ path: '.env.local' });

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@vinlogistics.test';

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const secret = process.env['SUPABASE_SECRET_KEY'];
if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: list, error: listError } = await admin.auth.admin.listUsers();
if (listError) throw listError;

const existing = list.users.find((u) => u.email === EMAIL);
const password = `e2e-${randomBytes(18).toString('base64url')}`;

const id = await (async () => {
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) throw error;
    console.info(`rotated the password for ${EMAIL}`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password,
    // No inbox exists for a .test address, so confirmation cannot arrive.
    email_confirm: true,
    user_metadata: { full_name: 'E2E Test Dispatcher' },
  });
  if (error) throw error;
  console.info(`created ${EMAIL}`);
  return data.user.id;
})();

/**
 * Written in place, BEFORE anything else can fail: the password has already
 * changed, and a sign-out that threw first would leave it known to nobody.
 * Each key replaced if present, appended if not.
 */
const ENV_FILE = '.env.local';
let env = readFileSync(ENV_FILE, 'utf8');
for (const [key, value] of [
  ['E2E_EMAIL', EMAIL],
  ['E2E_PASSWORD', password],
  ['E2E_USER_ID', id],
] as const) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  env = line.test(env)
    ? env.replace(line, () => `${key}=${value}`)
    : `${env.replace(/\n?$/, '\n')}${key}=${value}\n`;
}
writeFileSync(ENV_FILE, env);
console.info(`wrote E2E_EMAIL, E2E_PASSWORD and E2E_USER_ID to ${ENV_FILE} (password not shown)`);

/**
 * Every session, not just this one. Supabase keeps refresh tokens issued
 * under the old password alive; `scope: 'global'` revokes all of them, and
 * the one signed in here to make the call goes with them.
 */
const publishable = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
if (!publishable) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.');
const asUser = createClient(url, publishable, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error: signInError } = await asUser.auth.signInWithPassword({ email: EMAIL, password });
if (signInError) throw signInError;
const { error: signOutError } = await asUser.auth.signOut({ scope: 'global' });
if (signOutError) throw signOutError;
console.info(`signed ${EMAIL} out of every session`);
