import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { TEST_DATABASE_URL, refuseUnlessDisposable } from './src/test/url';

// globalSetup runs in its own process and gets no setup file, so DATABASE_URL
// has to be loaded here for the refusal below to have anything to compare to.
loadEnv({ path: '.env.local' });

export async function setup() {
  refuseUnlessDisposable();
  const sql = postgres(TEST_DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const tables = await sql<{ name: string }[]>`
      select tablename as name from pg_tables where schemaname = 'public'
    `;
    if (tables.length === 0) {
      throw new Error(
        `The test database at ${TEST_DATABASE_URL} has no tables.\n` +
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
        `No test database listening at ${TEST_DATABASE_URL}.\n` +
          `  scripts/test-db.sh up\n` +
          `(Tests never run against production — see vitest.setup.ts, guard 1.)`,
      );
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
