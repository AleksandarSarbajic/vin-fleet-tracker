import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, refuseUnlessDisposable } from './url';
import { describeDb, rolledBack, tablesHoldingRows } from './db';
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
      'MAPBOX_DIRECTIONS_TOKEN',
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

describe('guard 4 — the network is not the state of the world either', () => {
  it('refuses a real call to a live service', async () => {
    await expect(
      fetch('https://geocoding.geo.census.gov/geocoder/locations/address'),
    ).rejects.toThrow(/real network call/);
  });

  it('refuses Mapbox too, whatever the path', async () => {
    await expect(
      fetch('https://api.mapbox.com/directions/v5/mapbox/driving/x'),
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
