import { sql } from 'drizzle-orm';

/**
 * §12.13's ordering, in one place, because four queries answer "which stop is
 * this truck working on next" and they must agree: the console row, the
 * reassign preview, the routing sweep, and the arrival sweep.
 *
 * The rule has two halves and the old one-line `order by
 * appointment_start_utc asc nulls last, sequence asc` only implemented the
 * second:
 *
 *   1. ACROSS loads, the earliest deadline wins. A truck holding two loads is
 *      driven by whichever has the nearer appointment.
 *   2. WITHIN a load, sequence is absolute. You cannot deliver stop 2 before
 *      stop 1, whatever the two appointment times say.
 *
 * Sorting every stop of every load into one list by appointment breaks (2)
 * whenever a later leg carries an earlier time. Truck 124 found it: one load,
 * seq 1 Joliet appointment 2026-09-22 05:01, seq 2 Fargo appointment
 * 2026-09-20 23:30 — two days earlier, so Fargo outranked Joliet and the
 * board showed the truck heading for its second stop while the first was
 * undelivered. The ETA, the map line and the arrival sweep's single candidate
 * all pointed at Fargo, which is also why that truck's Joliet arrival took 26
 * minutes to register when the same-sequence stops elsewhere took three.
 *
 * Bad appointment data is the trigger — a delivery dated before its pickup is
 * a typo — but nothing prevents it and the correct answer under it is still
 * "stop 1 first". A within-load order that depends on the appointment being
 * right is not an order.
 *
 * So: rank each LOAD by its earliest remaining deadline (a window function
 * over the rows that survive the WHERE, so a departed leg no longer speaks for
 * its load), then keep each load's legs in sequence.
 *
 * `l.created_at, l.id` breaks a tie between two loads with the same deadline —
 * or with none, where both mins are null. Without it the sort is unstable and
 * two loads' stops can interleave, which is the very thing this exists to
 * stop.
 *
 * Requires the aliases `l` (loads) and `s` (stops). Used directly by the
 * board's query and the reassign preview; the worker reaches it through
 * BOARD_NEXT_STOP below.
 */
export const NEXT_STOP_ORDER = sql`
  order by min(s.appointment_start_utc) over (partition by l.id) asc nulls last,
           l.created_at asc,
           l.id asc,
           s.sequence asc
`;

/**
 * The stop the BOARD shows for truck `t`, joined in as `s` — for the worker
 * queries that then decide whether they can act on it (§12.116).
 *
 * Agreeing on the ORDER was not enough. The arrival sweep, the routing sweep
 * and the ETA log each put their own conditions — coordinates, "not arrived" —
 * INSIDE the ordered lookup, so a stop that failed them was skipped and the
 * NEXT one chosen instead. On a one-stop load that only removed the stop. On
 * a two-stop load it moved the worker to stop 2 while the board still showed
 * stop 1: the delivery routed, logged in the ETA log and watched for an
 * arrival while the truck stood at an unlocated or arrived pickup. Truck 124's
 * bug, by another route.
 *
 * So the selection is made once, with only the board's conditions — an open
 * load, a stop not departed — and a caller filters the ONE stop it gets back
 * in its own WHERE. A stop the caller cannot use means no candidate for that
 * truck, never a different stop.
 *
 * The board's own query (`fleet-query.ts`) and the reassign preview keep
 * their lateral: they add no condition, and `next-stop.test.ts` holds all of
 * them to the same answer.
 *
 * Requires the alias `t` (trucks). Inner join: a truck with no next stop
 * yields no row.
 */
export const BOARD_NEXT_STOP = sql`
  join lateral (
    select s.id as board_stop_id
    from loads l
    join stops s on s.load_id = l.id
    where l.truck_id = t.id
      and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
      and s.departed_at is null
    ${NEXT_STOP_ORDER}
    limit 1
  ) bns on true
  join stops s on s.id = bns.board_stop_id
`;
