import { readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '@/db/connection';
import { TEST_DATABASE_URL } from '@/test/url';

/**
 * Brings the local test cluster up to the same schema as production.
 *
 * Runs the prelude (the Supabase objects our migrations assume), then applies
 * ./drizzle unmodified — the same files, recorded by the same hashes, so a
 * migration that applies here is the one that applied there.
 */
async function main() {
  const { client, db } = createDirectDb(TEST_DATABASE_URL, 1);
  try {
    await db.execute(sql.raw(readFileSync('./scripts/test-db-prelude.sql', 'utf8')));
    await migrate(db, { migrationsFolder: './drizzle' });
    const [{ count }] = (await db.execute<{ count: string }>(
      sql`select count(*)::text as count from information_schema.tables where table_schema = 'public'`,
    )) as unknown as [{ count: string }];
    console.info(`test database migrated — ${count} tables in public`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('test migration failed:', error);
  process.exitCode = 1;
});
