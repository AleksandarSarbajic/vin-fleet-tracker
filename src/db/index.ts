import 'server-only';
import type postgres from 'postgres';
import { serverEnv } from '@/env/server';
import { createPooledDb, schema } from './connection';

/**
 * The app's database handle: DATABASE_URL, the transaction pooler (6543).
 *
 * The session pooler (5432, DIRECT_URL) is not the app's to hold. Migrations
 * reach it through `db/migrate.ts` and the worker through `createDirectDb`;
 * the `openDirect()` that used to sit here was never called, and was the only
 * reason the app demanded DIRECT_URL at all (§12.75).
 */

declare global {
  // Next's dev server re-evaluates modules on every edit; without this the
  // pool count climbs until Supabase starts refusing connections.
  // `declare global` only accepts `var` — let/const are not valid here.
  // eslint-disable-next-line no-var
  var __ftPooled:
    { client: postgres.Sql; db: ReturnType<typeof createPooledDb>['db'] } | undefined;
}

const pooled = globalThis.__ftPooled ?? createPooledDb(serverEnv.DATABASE_URL);
if (serverEnv.NODE_ENV !== 'production') globalThis.__ftPooled = pooled;

export const db = pooled.db;

export { schema };
