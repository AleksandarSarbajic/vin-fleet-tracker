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
 * Requires the aliases `l` (loads) and `s` (stops), which all four call sites
 * already use.
 */
export const NEXT_STOP_ORDER = sql`
  order by min(s.appointment_start_utc) over (partition by l.id) asc nulls last,
           l.created_at asc,
           l.id asc,
           s.sequence asc
`;
