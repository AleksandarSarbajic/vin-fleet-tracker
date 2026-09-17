import { config as loadEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ServerEnv, report } from '@/env/schema';
import { createDirectDb } from './connection';

/**
 * Applies ./drizzle over the SESSION pooler. `npm run db:migrate`.
 *
 * Standalone Node, so it loads .env.local and parses the env itself rather
 * than importing the Next-facing modules, which are `server-only`.
 */
loadEnv({ path: '.env.local' });

const parsed = ServerEnv.safeParse(process.env);
if (!parsed.success) throw new Error(report('server', parsed.error));

async function main() {
  const { client, db } = createDirectDb(parsed.data!.DIRECT_URL, 1);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.info('migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('migration failed:', error);
  process.exitCode = 1;
});
