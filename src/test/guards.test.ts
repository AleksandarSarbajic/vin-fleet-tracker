import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { trucks } from '@/db/schema';
import { TEST_DATABASE_URL, refuseUnlessDisposable } from './url';
import { describeDb, rolledBack, rolledBackAlone, tablesHoldingRows } from './db';
import { makeTruck } from './fleet';

/**
 * The guards themselves (§12.32).
 *
 * Four separate faults in one session came from tests reading the state of
 * the world rather than their own setup, and every one was found by accident.
 * These assert that the machinery preventing a fifth is actually in force —
 * so that removing a guard fails the suite rather than quietly restoring the
 * conditions for the bug.
 */

describe('guard 1 — production credentials do not exist in this process', () => {
  it('points DATABASE_URL at the local test cluster', () => {
    expect(process.env.DATABASE_URL).toBe(TEST_DATABASE_URL);
    expect(new URL(process.env.DATABASE_URL!).hostname).toBe('127.0.0.1');
  });

  it('leaves no credential a test could reach a live service with', () => {
    // Deleted, not blanked: an empty string is a value a `??` would keep.
    for (const key of [
      'DIRECT_URL',
      'SUPABASE_SECRET_KEY',
      'WORKER_SUPABASE_SECRET_KEY',
      'SAMSARA_API_TOKEN',
      // §12.59. `MAPBOX_DIRECTIONS_TOKEN` is kept on this list although the
      // variable is gone: the point of the guard is that a test can never
      // reach a live service, and a stale token still sitting in somebody's
      // `.env.local` is exactly the credential it exists to strip.
      'MAPBOX_DIRECTIONS_TOKEN',
      'HERE_API_KEY',
      // Phase 2b: the reader's key, and what Anthropic's SDK would pick up by itself.
      'LLM_READER_API_KEY',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
    ]) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  it('never names a supabase host', () => {
    expect(process.env.DATABASE_URL).not.toContain('supabase');
  });
});

describeDb('guard 2 — the database starts empty', () => {
  it('holds no rows a test did not create', async () => {
    const dirty = await rolledBack(async (tx) => {
      // Inside a transaction that has written nothing yet, so anything here
      // was committed by something else.
      return tablesHoldingRows(tx);
    });
    expect(dirty).toEqual([]);
  });

  it('makes `select … limit 1` return nothing rather than somebody else’s row', async () => {
    const found = await rolledBack(async (tx) =>
      tx.query.trucks.findFirst({ columns: { id: true } }),
    );
    // This is the line six fixtures opened with. Against a shared database it
    // silently picked whichever truck existed; here there is nothing to pick.
    expect(found).toBeUndefined();
  });
});

describeDb('guard 3 — a test that commits is named', () => {
  it('detects rows the transaction is holding', async () => {
    const dirty = await rolledBack(async (tx) => {
      await makeTruck(tx);
      // The detector reports its caller's own uncommitted rows, so this proves
      // it without leaking: after the rollback there is nothing to clean up.
      return tablesHoldingRows(tx);
    });
    expect(dirty.map((d) => d.t)).toContain('trucks');
  });
});

/**
 * HANDOFF 3ae. A test that changed a table's definition inside its
 * transaction deadlocked against the files running beside it, one run in
 * three. The test lock makes such a test run alone, and these hold the lock
 * and its enforcement in place.
 */
describeDb('the test lock — no table lock beside another test', () => {
  it('refuses DDL inside rolledBack, as it is issued, and names the fix', async () => {
    // Refused before it takes its lock, so nothing here waits on anyone.
    const said = await rolledBack((tx) =>
      tx.execute(sql`alter table route_shadow disable trigger route_shadow_closed`),
    ).then(
      () => 'NOT REFUSED',
      // Drizzle wraps the driver's error; Postgres's own message is the cause.
      (error: unknown) => String((error as { cause?: Error }).cause?.message ?? error),
    );
    expect(said).toMatch(/^ALTER TABLE inside rolledBack\(\).*rolledBackAlone\(\)/);
  });

  it('allows it inside rolledBackAlone', async () => {
    const done = await rolledBackAlone(async (tx) => {
      await tx.execute(sql`alter table route_shadow disable trigger route_shadow_closed`);
      return 'altered';
    });
    expect(done).toBe('altered');
  });

  it('fails a test whose transaction ends holding any other table lock', async () => {
    // A mode no test's row writes conflict with, so this waits on nobody.
    await expect(
      rolledBack((tx) => tx.execute(sql`lock table route_shadow in share update exclusive mode`)),
    ).rejects.toThrow(/took a table lock inside rolledBack\(\): route_shadow \(ShareUpdateExclusiveLock\)/);
  });

  it('refuses a test transaction opened inside another, which would hang', async () => {
    await expect(rolledBack(() => rolledBack(async () => 1))).rejects.toThrow(/inside another one/);
    await expect(rolledBackAlone(() => rolledBack(async () => 1))).rejects.toThrow(/inside another one/);
  });

  it('starts a rolledBackAlone only once the tests already running have finished', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let opened!: () => void;
    const isOpen = new Promise<void>((resolve) => (opened = resolve));
    const running = rolledBack(async () => {
      opened();
      await gate;
    });
    await isOpen;
    const alone = rolledBackAlone(async () => {
      order.push('alone ran');
    });
    // Long enough for a lock that did not exclude to have let it run.
    await new Promise((resolve) => setTimeout(resolve, 300));
    order.push('running test ended');
    release();
    await Promise.all([running, alone]);
    expect(order).toEqual(['running test ended', 'alone ran']);
  });

  it('gives fixture keys this worker, so parallel files do not collide on them', async () => {
    const id = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const [row] = await tx
        .select({ id: trucks.samsaraVehicleId })
        .from(trucks)
        .where(sql`${trucks.id} = ${truck.id}`);
      return row!.id;
    });
    expect(id).toMatch(new RegExp(`^vitest-vehicle-${process.env['VITEST_POOL_ID']}-\\d+$`));
  });
});

describe('guard 4 — the network is not the state of the world either', () => {
  it('refuses a real call to a live service', async () => {
    await expect(
      fetch('https://geocoding.geo.census.gov/geocoder/locations/address'),
    ).rejects.toThrow(/real network call/);
  });

  it('refuses the routing provider too, whatever the path', async () => {
    await expect(
      fetch('https://router.hereapi.com/v8/routes?transportMode=truck'),
    ).rejects.toThrow(/real network call/);
  });

  it('still allows a local server, so a test can stand one up', async () => {
    // Nothing is listening on this port; the point is the REASON it fails.
    // A guard rejection says "real network call"; a refused connection does not.
    await expect(fetch('http://127.0.0.1:1/')).rejects.not.toThrow(/real network call/);
  });
});

describe('the refusal runs before the truncate, not after it', () => {
  /**
   * The ordering bug that cost a production database.
   *
   * This check lived in `vitest.setup.ts`, which runs in the test worker.
   * `globalSetup` runs BEFORE the workers, so its truncate had already
   * happened by the time the worker refused — and the refusal printed after
   * the damage, reading exactly like one that had prevented it.
   *
   * So the function is imported from globalSetup, where it now runs, and
   * these assert what it refuses. A guard in the wrong process is not a guard.
   */
  const PRODUCTION =
    'postgresql://postgres.abc:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres';
  const LOCAL = 'postgres://postgres@127.0.0.1:55432/fleet_test';

  it('refuses a host that is not this machine', () => {
    expect(() =>
      refuseUnlessDisposable('postgres://u@db.example.com:5432/x', null),
    ).toThrow(/not on this machine/);
  });

  it('refuses the database DATABASE_URL names, whatever the port', () => {
    // The two Supabase URLs differ only in port, which is why the comparison
    // is by host and database name rather than by string.
    const sessionPooler = PRODUCTION.replace(':6543', ':5432');
    expect(() => refuseUnlessDisposable(PRODUCTION, sessionPooler)).toThrow(
      /same database/,
    );
  });

  it('allows a local cluster', () => {
    expect(() => refuseUnlessDisposable(LOCAL, PRODUCTION)).not.toThrow();
  });

  it('refuses something that is not a URL rather than guessing', () => {
    expect(() => refuseUnlessDisposable('fleet_test', null)).toThrow(/not a URL/);
  });
});
