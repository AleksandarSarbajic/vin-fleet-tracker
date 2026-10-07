import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { sql as drizzleSql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createDirectDb } from './src/db/connection';
import { COMMIT_DATABASE_URL, TEST_DATABASE_URL, refuseUnlessDisposable } from './src/test/url';

// globalSetup runs in its own process and gets no setup file, so DATABASE_URL
// has to be loaded here for the refusal below to have anything to compare to.
loadEnv({ path: '.env.local' });

export async function setup() {
  refuseUnlessDisposable();
  refuseUnlessDisposable(COMMIT_DATABASE_URL);
  await emptied(TEST_DATABASE_URL);
  await prepareCommitDatabase();
}

/**
 * §12.119. `fleet_commit`, for the tests that must commit: brought to the
 * same migrations as `fleet_test` — by the same prelude and the same files —
 * then emptied, so each run starts it clean whatever the last one left.
 */
async function prepareCommitDatabase() {
  const { client, db } = createDirectDb(COMMIT_DATABASE_URL, 1);
  try {
    await db.execute(drizzleSql.raw(readFileSync('./scripts/test-db-prelude.sql', 'utf8')));
    await migrate(db, { migrationsFolder: './drizzle' });
  } catch (error) {
    if (error instanceof Error && /database "fleet_commit" does not exist/.test(error.message)) {
      throw new Error(`No fleet_commit database in the test cluster.\n  scripts/test-db.sh up`);
    }
    throw error;
  } finally {
    await client.end();
  }
  await emptied(COMMIT_DATABASE_URL);
}

async function emptied(url: string) {
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const tables = await sql<{ name: string }[]>`
      select tablename as name from pg_tables where schemaname = 'public'
    `;
    if (tables.length === 0) {
      throw new Error(
        `The test database at ${url} has no tables.\n` +
          `  scripts/test-db.sh up && npm run test:db:migrate`,
      );
    }
    // Names come from pg_tables, but they are still quoted and checked: this
    // string is interpolated into a TRUNCATE.
    const list = tables
      .map((t) => t.name)
      .filter((n) => /^[a-z_][a-z0-9_]*$/.test(n))
      .map((n) => `public."${n}"`)
      .join(', ');
    await sql.unsafe(`truncate table ${list} restart identity cascade`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') {
      throw new Error(
        `No test database listening at ${url}.\n` +
          `  scripts/test-db.sh up\n` +
          `(Tests never run against production — see vitest.setup.ts, guard 1.)`,
      );
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
