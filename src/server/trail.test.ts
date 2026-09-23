import { expect, it } from 'vitest';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck, makePosition } from '@/test/fleet';
import { TRAIL_WINDOW_MS } from '@/lib/trail';
import { loadTrail } from './trail';

/**
 * §14 feature 9, against the real database.
 *
 * The one thing only a database test can prove: the feed returns several
 * readings per vehicle per poll — one truck carried five, five seconds apart
 * — and the query has to cap that without the console knowing or caring.
 */

const NOW = new Date('2026-09-23T18:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describeDb('the trail query (§14 feature 9)', () => {
  it('returns nothing for a truck with no history', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      expect(await loadTrail(tx, truck.id, NOW)).toEqual([]);
    });
  });

  it('returns the half hour and nothing older', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      for (const minutes of [2, 10, 29, 31, 90]) {
        await makePosition(tx, truck.id, {
          lat: 41 + minutes / 100,
          lng: -87,
          recordedAt: ago(minutes),
        });
      }
      const points = await loadTrail(tx, truck.id, NOW);
      const ages = points.map((p) =>
        Math.round((NOW.getTime() - Date.parse(p.recordedAt)) / 60_000),
      );
      expect(ages.sort((a, b) => a - b)).toEqual([2, 10, 29]);
      for (const age of ages) expect(age * 60_000).toBeLessThanOrEqual(TRAIL_WINDOW_MS);
    });
  });

  /**
   * The cap. Five readings inside one minute become one, so half an hour is
   * at most thirty rows whatever the vendor sends.
   */
  it('collapses several readings in the same minute to the newest', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      for (const seconds of [0, 5, 10, 15, 20]) {
        await makePosition(tx, truck.id, {
          lat: 41 + seconds / 1000,
          lng: -87,
          recordedAt: new Date(ago(5).getTime() + seconds * 1000),
        });
      }
      const points = await loadTrail(tx, truck.id, NOW);
      expect(points).toHaveLength(1);
      // The NEWEST of the five, not whichever one the scan reached first.
      expect(points[0]!.lat).toBeCloseTo(41.02, 5);
    });
  });

  it('keeps a reading per minute rather than one per truck', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      for (const minutes of [1, 2, 3, 4, 5]) {
        await makePosition(tx, truck.id, {
          lat: 41 + minutes / 100,
          lng: -87,
          recordedAt: ago(minutes),
        });
      }
      expect(await loadTrail(tx, truck.id, NOW)).toHaveLength(5);
    });
  });

  /** A trail behind the wrong marker is a claim about where THAT truck was. */
  it('never returns another truck’s positions', async () => {
    await rolledBack(async (tx) => {
      const mine = await makeTruck(tx);
      const theirs = await makeTruck(tx);
      await makePosition(tx, theirs.id, { lat: 30, lng: -90, recordedAt: ago(3) });
      await makePosition(tx, mine.id, { lat: 41, lng: -87, recordedAt: ago(3) });
      const points = await loadTrail(tx, mine.id, NOW);
      expect(points).toHaveLength(1);
      expect(points[0]!.lat).toBe(41);
    });
  });
});
