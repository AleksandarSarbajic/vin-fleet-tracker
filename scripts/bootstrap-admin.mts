import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '@/db/connection';

/**
 * Gives an existing auth user a profile with a role. `npm run bootstrap:admin`.
 *
 * The signup trigger (migration 0001) writes a profile on INSERT to
 * auth.users, with role 'viewer'. It cannot help in two cases:
 *
 *   - a user that already existed when the profile went missing, because the
 *     trigger fires on insert and that insert is long past;
 *   - the FIRST admin on any deployment, because 'viewer' is the only role
 *     the trigger ever assigns and promotion is meant to be a deliberate act
 *     by an admin — which requires an admin to exist.
 *
 * The second is a real chicken-and-egg that phase 6 hits on a fresh database.
 * This is the deliberate act, run by whoever owns the deployment.
 *
 *   npm run bootstrap:admin -- <email> [admin|dispatcher|viewer]
 */
loadEnv({ path: '.env.local' });

const email = process.argv[2];
const role = process.argv[3] ?? 'admin';

if (!email) {
  console.error('usage: npm run bootstrap:admin -- <email> [admin|dispatcher|viewer]');
  process.exitCode = 1;
} else if (!['admin', 'dispatcher', 'viewer'].includes(role)) {
  console.error(`role must be admin, dispatcher or viewer — got ${role}`);
  process.exitCode = 1;
} else {
  const { client, db } = createDirectDb(process.env.DIRECT_URL!, 1);
  try {
    /**
     * full_name is derived exactly as the signup trigger derives it, so a
     * bootstrapped profile is indistinguishable from one the trigger wrote.
     */
    const rows = (await db.execute(sql`
      insert into public.profiles (id, full_name, role)
      select u.id,
             coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                      split_part(u.email, '@', 1)),
             ${role}::user_role
      from auth.users u
      where u.email = ${email}
      on conflict (id) do update set role = excluded.role
      returning id, full_name, role
    `)) as unknown as { id: string; full_name: string; role: string }[];

    if (rows.length === 0) {
      console.error(`no auth.users row for ${email} — sign up first, then run this.`);
      process.exitCode = 1;
    } else {
      const row = rows[0]!;
      console.info(`profile ${row.id}  ${row.full_name}  role=${row.role}`);
    }
  } finally {
    await client.end();
  }
}
