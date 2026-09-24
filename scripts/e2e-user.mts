import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

/**
 * Creates or rotates the end-to-end test account. `npm run e2e:user`.
 *
 * Supabase Auth is hosted and there is no local stack here, so the e2e suite
 * signs in for real. It does that as a DEDICATED account rather than as a
 * person: the display-name test renames whoever it logs in as, and doing that
 * to a colleague's profile during a test run is not a trade worth making.
 *
 * The password is generated here and never leaves `.env.local`. Rotate it by
 * running this again; delete the account in the Supabase dashboard when the
 * suite is retired.
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

console.info('\nPut these in .env.local (and nowhere else):\n');
console.info(`E2E_EMAIL=${EMAIL}`);
console.info(`E2E_PASSWORD=${password}`);
console.info(`E2E_USER_ID=${id}`);
