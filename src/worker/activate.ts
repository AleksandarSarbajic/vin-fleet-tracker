import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { STOPPED_BELOW_MPH } from '@/lib/arrival';
import type { Db, Tx } from '@/server/audit';
import type { PendingPosition } from './ingest';
import { describe } from './eta-marks';

/**
 * §12.151. A truck nobody switched off comes back by itself when it drives.
 *
 * `trucks.active` had two writers: the day-one seed (`seedActiveFlags`, a
 * truck with no fix in 24 hours went inactive) and an admin's switch in the
 * edit window. The feed is barred from the flag (§12.14) so that an admin's
 * choice is never undone — which also meant the seed's guess was never undone.
 * On 2026-11-10 four trucks the seed had hidden on 2026-09-18 were on the road,
 * off the board, and skipped by routing, arrivals and the ETA logs.
 *
 * The rule, and only this rule (Alex, 2026-11-10):
 *
 *   - an INACTIVE truck that reports a fix faster than `STOPPED_BELOW_MPH`
 *     becomes active, with one audit row (`source 'worker'`, `reason
 *     'moving'`, the fix's speed and time), in one statement;
 *   - unless an admin switched it off: its newest truck audit row about the
 *     flag is the edit window's `active: false`;
 *   - nothing here, or anywhere else, ever turns a truck OFF.
 */

type Conn = Db | Tx;

/** One truck's fix that this poll carries, the newest of its moving ones. */
export interface MovingFix {
  truckId: string;
  speedMph: number;
  recordedAt: Date;
}

/**
 * This poll's moving fixes, one per truck: the newest faster than
 * `STOPPED_BELOW_MPH` — strictly faster, as the arrival sweep counts a truck
 * at the threshold as stopped. A fix with no speed is not moving. A vehicle
 * the roster does not know has no truck to switch on.
 */
export function movingFixes(
  pending: PendingPosition[],
  truckIdBySamsaraId: Map<string, string>,
): MovingFix[] {
  const newest = new Map<string, MovingFix>();
  for (const p of pending) {
    const truckId = truckIdBySamsaraId.get(p.samsaraVehicleId);
    if (!truckId || p.speedMph === null || !(p.speedMph > STOPPED_BELOW_MPH)) continue;
    const seen = newest.get(truckId);
    if (!seen || p.recordedAt > seen.recordedAt) {
      newest.set(truckId, { truckId, speedMph: p.speedMph, recordedAt: p.recordedAt });
    }
  }
  return [...newest.values()];
}

const Activated = z.object({ truck_id: z.string().uuid() });

/**
 * Switches on every inactive truck in `fixes` that no admin switched off, and
 * writes its audit row, in ONE statement: the update and the insert are one
 * data-modifying CTE, so a failure in either leaves neither. One statement
 * per poll, whatever the number of trucks.
 *
 * "An admin switched it off" (§12.151): the truck's newest `entity 'truck'`
 * audit row THAT CARRIES `after.active` has `active: false` and `source
 * 'edit-modal'`. Rows without `after.active` are not about the flag — the
 * bulk assignment window writes `entity 'truck'` rows for driver changes —
 * and must not hide an admin's switch-off behind a later driver change. An
 * advisor's or the worker's own row, or no row, is not an admin's choice.
 *
 * Rows written in one transaction share `created_at`; on a tie the admin's
 * switch-off wins, so the worker never decides a tie in its own favour.
 *
 * Times go in as ISO text inside the JSON, never as a JS Date inside sql``:
 * there a Date is serialised with toString(), which Postgres cannot parse.
 */
export async function activateMovingTrucks(db: Conn, fixes: MovingFix[]): Promise<string[]> {
  if (fixes.length === 0) return [];
  const json = JSON.stringify(
    fixes.map((f) => ({
      truck_id: f.truckId,
      speed_mph: f.speedMph,
      recorded_at: f.recordedAt.toISOString(),
    })),
  );

  const rows = await db.execute(sql`
    with fixes as (
      select f.truck_id, f.speed_mph, f.recorded_at
      from jsonb_to_recordset(${json}::jsonb)
        as f(truck_id uuid, speed_mph double precision, recorded_at text)
    ),
    eligible as (
      select f.*
      from fixes f
      join trucks t on t.id = f.truck_id
      where t.active = false
        and not coalesce((
          select a.after ->> 'source' = 'edit-modal' and a.after ->> 'active' = 'false'
          from audit_log a
          where a.entity = 'truck'
            and a.entity_id = t.id
            and a.after -> 'active' is not null
          order by a.created_at desc,
            (a.after ->> 'source' = 'edit-modal' and a.after ->> 'active' = 'false') desc
          limit 1
        ), false)
    ),
    flipped as (
      update trucks t
      set active = true
      from eligible e
      where t.id = e.truck_id and t.active = false
      returning t.id
    )
    insert into audit_log (actor_user_id, entity, entity_id, before, after)
    select
      null,
      'truck',
      e.truck_id,
      jsonb_build_object('active', false),
      jsonb_build_object(
        'active', true,
        'source', 'worker',
        'reason', 'moving',
        'speedMph', e.speed_mph,
        'fixAt', e.recorded_at
      )
    from eligible e
    join flipped f on f.id = e.truck_id
    returning entity_id as truck_id
  `);
  return z.array(Activated).parse(rows).map((r) => r.truck_id);
}

export interface ActivationLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * The poll's call: never throws, never silent. A failure is logged as an
 * error (the statement is atomic, so it leaves no flag without its row) and
 * costs one poll — the truck is still moving at the next one, which tries
 * again. It must not stall the cursor: a rule about a few hidden trucks is
 * not worth the whole fleet's feed.
 */
export async function runActivation(
  db: Conn,
  logger: ActivationLogger,
  pending: PendingPosition[],
  truckIdBySamsaraId: Map<string, string>,
): Promise<number> {
  const fixes = movingFixes(pending, truckIdBySamsaraId);
  try {
    const activated = await activateMovingTrucks(db, fixes);
    if (activated.length > 0) {
      logger.info('inactive trucks switched on: moving', { trucks: activated.length });
    }
    return activated.length;
  } catch (error: unknown) {
    logger.error('truck activation failed', { cause: error, error: describe(error) });
    return 0;
  }
}
