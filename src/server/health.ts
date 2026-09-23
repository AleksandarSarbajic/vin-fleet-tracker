import { sql } from 'drizzle-orm';
import type { Db, Tx } from './audit';

/**
 * §14 feature 8 — the fleet health strip.
 *
 * ## What it is allowed to say
 *
 * §14.3 settled the relationship before anything was drawn: **the chips stay
 * the filter and the only live count, and the strip prints nothing a chip
 * already prints.** It shows the day's OUTCOME — stops done, on time vs late
 * — which no chip can express, because an `Arrived` chip counts trucks on
 * site *now*, not deliveries made. A truck that delivered at 06:10 and has
 * been driving since is invisible to every chip on the board and is the whole
 * point of this strip.
 *
 * ## Why it is a separate query
 *
 * §14.6: the strip "derives it in a separate read-only query. It does not
 * touch the routing or status modules, which are frozen while the §12.61
 * shadow run collects." That constraint turned out to be the right shape
 * anyway — this is an aggregate over history and `fleet-query` is a
 * one-row-per-truck lateral over the present. Bolting a day's totals onto it
 * would make every console poll pay for a scan it uses once.
 *
 * ## The lateness rule is `status.ts`'s, restated, not reinvented
 *
 * `computeStatus` step 5: the deadline is `apptEndUtc ?? apptStartUtc`, and
 * the window IS the grace (§12.1) — there is no separate tolerance to apply.
 * A stop is late here exactly when it was arrived at after that instant. The
 * engine is READ for the rule and not imported: it evaluates a live truck
 * against `now`, and this evaluates a finished stop against its own
 * appointment, which is a different question with the same threshold.
 *
 * `status.ts` is not modified, imported or executed by any of this.
 */

export interface FleetHealth {
  /** The dispatch day these totals are about, `YYYY-MM-DD`. */
  day: string;
  /** Arrived today, at or before the deadline. */
  onTime: number;
  /** Arrived today, after it. */
  late: number;
  /**
   * Arrived today with no appointment to be judged against — an FCFS stop
   * with no receiving hours on file, or a stop saved before one was set.
   * Counted, never folded into `onTime`: a stop nobody could be late for is
   * not the same achievement as one that was made on the hour.
   */
  unscheduled: number;
  /** Due today and not arrived yet. The bar's hollow remainder. */
  remaining: number;
}

/**
 * Today's stops, on active trucks, in the DISPATCH zone.
 *
 * The zone is the dispatch one and not the stop's, matching §12.1's TOMORROW
 * rule — "measured in THIS zone. Not the stop's, not the browser's." A board
 * whose day rolls over at three different times because three stops sit in
 * three zones is not a day anyone can plan against.
 *
 * `remaining` is keyed off the APPOINTMENT's day and `done` off the ARRIVAL's,
 * which is deliberate and not a mismatch: they answer "what was due today" and
 * "what got finished today", and a stop that was due yesterday and arrived
 * this morning belongs in exactly one of them — the second.
 */
export async function loadFleetHealth(
  db: Db | Tx,
  dispatchTz: string,
): Promise<FleetHealth> {
  /**
   * Each stop is classified ONCE, in the CTE, and the totals are counted off
   * that label. The first draft repeated the four date predicates inside four
   * `count(*) filter (...)` clauses, which is the shape where a stop ends up
   * in two buckets or none and no test notices, because the numbers still add
   * up to something plausible.
   */
  const rows = (await db.execute(sql`
    with day as (select (now() at time zone ${dispatchTz})::date as d),
    classified as (
      select case
        when s.arrived_at is not null
             and (s.arrived_at at time zone ${dispatchTz})::date = (select d from day)
        then case
          when coalesce(s.appointment_end_utc, s.appointment_start_utc) is null
            then 'unscheduled'
          when s.arrived_at <= coalesce(s.appointment_end_utc, s.appointment_start_utc)
            then 'on_time'
          else 'late'
        end
        when s.arrived_at is null
             and s.departed_at is null
             and s.appointment_start_utc is not null
             and (s.appointment_start_utc at time zone ${dispatchTz})::date = (select d from day)
        then 'remaining'
        else null
      end as bucket
      from stops s
      join loads l on l.id = s.load_id
      join trucks t on t.id = l.truck_id
      where t.active
    )
    select (select to_char(d, 'YYYY-MM-DD') from day) as day,
           count(*) filter (where bucket = 'on_time')::int     as on_time,
           count(*) filter (where bucket = 'late')::int        as late,
           count(*) filter (where bucket = 'unscheduled')::int as unscheduled,
           count(*) filter (where bucket = 'remaining')::int   as remaining
    from classified
  `)) as unknown as {
    day: string;
    on_time: number;
    late: number;
    unscheduled: number;
    remaining: number;
  }[];

  const row = rows[0];
  return {
    day: row?.day ?? '',
    onTime: row?.on_time ?? 0,
    late: row?.late ?? 0,
    unscheduled: row?.unscheduled ?? 0,
    remaining: row?.remaining ?? 0,
  };
}
