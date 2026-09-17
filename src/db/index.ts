import 'server-only';
import type postgres from 'postgres';
import { serverEnv } from '@/env/server';
import { createDirectDb, createPooledDb, schema } from './connection';

/**
 * The app's database handle. Two connections exist and using the wrong one
 * produces intermittent failures under load that look like application bugs:
 *
 *   db        DATABASE_URL — transaction pooler, 6543. Route handlers.
 *   openDirect DIRECT_URL  — session pooler, 5432. Migrations, worker.
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

/** One-shot session-pooler connection. Caller must close `client`. */
export function openDirect(max = 1) {
  return createDirectDb(serverEnv.DIRECT_URL, max);
}

export { schema };
