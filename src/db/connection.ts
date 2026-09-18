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
  const client = postgres(url, {
    max,
    connect_timeout: 10,
    /**
     * EVERY timeout stated, because the defaults cost 5.5 hours of a day
     * (§12.39).
     *
     * `connect_timeout` covers connecting and nothing else. There was no
     * query timeout at all, so a statement issued on a socket that had gone
     * away waited for TCP to give up — 26 to 51 minutes, eleven times in one
     * day, during which the worker ingested nothing, detected no arrivals and
     * routed nothing. The failure surfaced only when it finally threw, so the
     * log line marked the END of the outage and looked like a single bad
     * query.
     */

    /**
     * Postgres kills the statement itself, so the socket cannot be the thing
     * we are waiting on. A poll's heaviest statement is a bulk position
     * insert; 20 s is far beyond it and far below a poll interval.
     */
    connection: { statement_timeout: 20_000 },

    /**
     * postgres.js defaults this to `60 * (30 + Math.random() * 30)` — a
     * RANDOM 30 to 60 minutes per connection, which is what was recycling
     * connections under the worker. Stated explicitly so the recycling is a
     * decision rather than a surprise, and short enough that a connection is
     * replaced long before a pooler decides to drop it.
     */
    max_lifetime: 60 * 10,

    /** Idle connections are returned rather than held until they go stale. */
    idle_timeout: 60,
  });
  return { client, db: drizzle(client, { schema }) };
}

export { schema };
