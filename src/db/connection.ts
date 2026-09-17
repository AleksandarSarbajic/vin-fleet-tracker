import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Plain connection factories — no `server-only`, so standalone Node
 * processes (migrations, and the phase-2 ingestion worker) can use them.
 * The `server-only` guard lives on the Next-facing barrel in ./index.ts.
 */

/**
 * TRANSACTION pooler (6543). Route handlers only.
 * `prepare: false` is mandatory — transaction mode does not support
 * prepared statements. Removing it is the bug.
 */
export function createPooledDb(url: string) {
  const client = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { client, db: drizzle(client, { schema }) };
}

/**
 * SESSION pooler (5432). Migrations and the worker. Persistent connection,
 * prepared statements fine. Caller owns the client and must close it.
 */
export function createDirectDb(url: string, max = 1) {
  const client = postgres(url, { max, connect_timeout: 10 });
  return { client, db: drizzle(client, { schema }) };
}

export { schema };
