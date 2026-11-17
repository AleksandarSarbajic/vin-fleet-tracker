import { expect, it } from 'vitest';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import type { Tx } from './audit';
import { PAST_ADDRESS_CAP, pastAddresses } from './stop-addresses';

/**
 * Phase 3bx, QoL 2 (§12.164), against the real database: the company's past stop addresses,
 * distinct as a dispatcher reads them, newest first, capped. Read-only.
 */

const BASE = Date.UTC(2026, 9, 1, 12);
const hoursIn = (h: number) => new Date(BASE + h * 3_600_000);

async function load(tx: Tx, truckId: string, createdAt: Date, places: { line: string | null; city?: string; state?: string; zip?: string }[]) {
  const [row] = await tx.insert(loads).values({ truckId, status: 'DISPATCHED', createdAt }).returning({ id: loads.id });
  let sequence = 0;
  for (const place of places) {
    sequence += 1;
    await tx.insert(stops).values({
      loadId: row!.id,
      type: sequence === 1 ? 'PU' : 'DEL',
      sequence,
      addressLine: place.line,
      city: place.city ?? 'Joliet',
      state: place.state ?? 'IL',
      zip: place.zip ?? '60433',
    });
  }
}

describeDb('the past stop addresses (QoL 2)', () => {
  it('nothing when there are no stops', async () => {
    await rolledBack(async (tx) => {
      expect(await pastAddresses(tx)).toEqual([]);
    });
  });

  it('distinct without case or spaces, the newest spelling offered, every use counted, newest first', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await load(tx, truck.id, hoursIn(1), [{ line: '1200 mill rd', city: 'Bolingbrook', zip: '60440' }, { line: '77 Depot St', city: 'Tulsa', state: 'OK', zip: '74103' }]);
      await load(tx, truck.id, hoursIn(5), [{ line: '  1200 Mill Rd ', city: 'BOLINGBROOK', zip: '60440' }]);
      await load(tx, truck.id, hoursIn(3), [{ line: '1200 Mill Rd', city: 'Bolingbrook', zip: '60441' }]);

      expect(await pastAddresses(tx)).toEqual([
        { addressLine: '1200 Mill Rd', city: 'BOLINGBROOK', state: 'IL', zip: '60440', uses: 2, lastUsedAt: hoursIn(5).toISOString() },
        // Another ZIP is another place.
        { addressLine: '1200 Mill Rd', city: 'Bolingbrook', state: 'IL', zip: '60441', uses: 1, lastUsedAt: hoursIn(3).toISOString() },
        { addressLine: '77 Depot St', city: 'Tulsa', state: 'OK', zip: '74103', uses: 1, lastUsedAt: hoursIn(1).toISOString() },
      ]);
    });
  });

  it('a stop with no street is not an address to offer', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await load(tx, truck.id, hoursIn(1), [{ line: null }, { line: '   ' }, { line: '9 Real St' }]);
      expect((await pastAddresses(tx)).map((a) => a.addressLine)).toEqual(['9 Real St']);
    });
  });

  it(`the cap keeps the newest (${PAST_ADDRESS_CAP} in production), by the newest load that used each`, async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      for (let i = 1; i <= 6; i += 1) await load(tx, truck.id, hoursIn(i), [{ line: `${i} Cap St` }]);
      // The oldest is used again, newest of all: it comes back to the front.
      await load(tx, truck.id, hoursIn(10), [{ line: '1 Cap St' }]);
      expect((await pastAddresses(tx, 3)).map((a) => [a.addressLine, a.uses])).toEqual([
        ['1 Cap St', 2],
        ['6 Cap St', 1],
        ['5 Cap St', 1],
      ]);
    });
  });
});
