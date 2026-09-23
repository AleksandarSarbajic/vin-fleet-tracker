import { expect, it } from 'vitest';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import { loadFleetHealth } from './health';
import type { Tx } from './audit';

/**
 * §14 feature 8, against the real database, inside transactions that always
 * roll back.
 *
 * The rule sounds like one line — "stops done today, on time vs late" — and
 * has five edges a query gets wrong quietly: the day boundary belongs to the
 * dispatch zone rather than UTC or the stop's; the deadline is the END of the
 * window; a stop with no appointment cannot be late; a stop due yesterday and
 * arrived today counts as done today and not as due today; and an inactive
 * truck is not on the board at all.
 */

const TZ = 'America/Chicago';

/** Today in the dispatch zone, at a given local hour, as a UTC instant. */
function todayAt(hour: number, minute = 0): Date {
  const now = new Date();
  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // Derived, never pasted: the offset is whatever the zone database says it
  // is on THIS date, so the test survives both sides of a DST change.
  const naive = Date.parse(
    `${localDay}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
  const offset =
    Date.parse(new Date(naive).toLocaleString('en-US', { timeZone: 'UTC' })) -
    Date.parse(new Date(naive).toLocaleString('en-US', { timeZone: TZ }));
  return new Date(naive + offset);
}

interface Leg {
  seq: number;
  apptStart?: Date | null;
  apptEnd?: Date | null;
  arrivedAt?: Date | null;
  departedAt?: Date | null;
}

async function addLoad(tx: Tx, truckId: string, legs: Leg[]) {
  const [load] = await tx
    .insert(loads)
    .values({ truckId, loadNumber: `H-${Math.random().toString(36).slice(2, 9)}` })
    .returning({ id: loads.id });
  for (const leg of legs) {
    await tx.insert(stops).values({
      loadId: load!.id,
      type: leg.seq === 1 ? 'PU' : 'DEL',
      sequence: leg.seq,
      city: 'Joliet',
      state: 'IL',
      appointmentStartUtc: leg.apptStart ?? null,
      appointmentEndUtc: leg.apptEnd ?? null,
      appointmentTz: leg.apptStart ? TZ : null,
      appointmentType: 'APPT',
      arrivedAt: leg.arrivedAt ?? null,
      // §12.57: the pair is enforced by a check constraint, both ways.
      arrivedSource: leg.arrivedAt ? ('detected' as const) : null,
      departedAt: leg.departedAt ?? null,
    });
  }
}

/**
 * Totals for a fleet built inside this transaction alone. The database is
 * empty between runs (§12.32), so nothing else contributes.
 */
const health = (tx: Tx) => loadFleetHealth(tx, TZ);

describeDb('the day’s outcome (§14 feature 8)', () => {
  it('counts nothing when nothing has happened', async () => {
    await rolledBack(async (tx) => {
      await makeTruck(tx);
      expect(await health(tx)).toMatchObject({
        onTime: 0,
        late: 0,
        unscheduled: 0,
        remaining: 0,
      });
    });
  });

  it('splits today’s arrivals on the deadline', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, [
        { seq: 1, apptStart: todayAt(8), arrivedAt: todayAt(7, 50) },
        { seq: 2, apptStart: todayAt(13), arrivedAt: todayAt(14, 20) },
      ]);
      expect(await health(tx)).toMatchObject({ onTime: 1, late: 1 });
    });
  });

  /**
   * §12.1: "the deadline is the end of the window, and the window is the
   * grace." A stop arriving inside its ± window is on time, and judging it
   * against the START would report a late delivery that the dispatcher,
   * the row and the engine all call on time.
   */
  it('judges against the end of the window, not its start', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, [
        {
          seq: 1,
          apptStart: todayAt(8),
          apptEnd: todayAt(10),
          arrivedAt: todayAt(9, 30),
        },
      ]);
      expect(await health(tx)).toMatchObject({ onTime: 1, late: 0 });
    });
  });

  it('treats arriving exactly on the deadline as on time', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const deadline = todayAt(11);
      await addLoad(tx, truck.id, [{ seq: 1, apptStart: deadline, arrivedAt: deadline }]);
      expect(await health(tx)).toMatchObject({ onTime: 1, late: 0 });
    });
  });

  /**
   * Counted, never folded into `onTime`. A stop nobody could be late for is
   * not the same achievement as one made on the hour, and quietly scoring it
   * as a win is how a health strip starts flattering the board.
   */
  it('keeps an arrival with no appointment out of both columns', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, [{ seq: 1, arrivedAt: todayAt(9) }]);
      expect(await health(tx)).toMatchObject({ onTime: 0, late: 0, unscheduled: 1 });
    });
  });

  it('counts what is still due today, and not what is already done', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, [
        { seq: 1, apptStart: todayAt(9), arrivedAt: todayAt(9) },
        { seq: 2, apptStart: todayAt(17) },
      ]);
      expect(await health(tx)).toMatchObject({ onTime: 1, remaining: 1 });
    });
  });

  /**
   * The one asymmetry worth stating: `remaining` is keyed off the
   * APPOINTMENT's day and `done` off the ARRIVAL's. A stop due yesterday and
   * arrived this morning belongs in exactly one of them — the second.
   */
  it('counts yesterday’s stop as done today when it was arrived at today', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const yesterday = new Date(todayAt(14).getTime() - 24 * 3_600_000);
      await addLoad(tx, truck.id, [
        { seq: 1, apptStart: yesterday, arrivedAt: todayAt(7) },
      ]);
      expect(await health(tx)).toMatchObject({ late: 1, remaining: 0 });
    });
  });

  it('ignores a departed stop that was never marked arrived', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, [
        { seq: 1, apptStart: todayAt(9), arrivedAt: todayAt(9), departedAt: todayAt(10) },
      ]);
      expect((await health(tx)).remaining).toBe(0);
    });
  });

  /** The board shows active trucks unless asked otherwise (§12.9). */
  it('leaves an inactive truck out entirely', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      await addLoad(tx, truck.id, [
        { seq: 1, apptStart: todayAt(8), arrivedAt: todayAt(12) },
        { seq: 2, apptStart: todayAt(18) },
      ]);
      expect(await health(tx)).toMatchObject({ onTime: 0, late: 0, remaining: 0 });
    });
  });

  it('reports the dispatch day it counted', async () => {
    await rolledBack(async (tx) => {
      const expected = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      expect((await health(tx)).day).toBe(expected);
    });
  });
});
