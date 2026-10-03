import { and, asc, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { assignments, drivers, loads, stops, trucks } from '@/db/schema';
import {
  buildHistoryWeek,
  type HistoryAssignment,
  type HistoryLoad,
  type HistoryWeekView,
} from '@/lib/history';
import { weekBounds, type IsoWeek } from '@/lib/history-week';
import type { Db } from './audit';

/**
 * §12.101 — the records behind one week of the driver history page.
 *
 * Read-only, and only `loads`, `stops`, `assignments`, `drivers` and `trucks`
 * — never `audit_log` (§12.15 defers reading it to the audit view). The rules
 * that turn these rows into the page live in `lib/history.ts`.
 *
 * The window is the week with two weeks either side. A pickup on Sunday whose
 * delivery is reached on Monday is one trip on Sunday, and the week after has
 * to see that pickup to know the Monday delivery is already shown.
 */
const MARGIN_MS = 14 * 86_400_000;

export async function loadHistoryWeek(db: Db, week: IsoWeek, timeZone: string): Promise<HistoryWeekView> {
  const { start, end } = weekBounds(week, timeZone);
  const from = new Date(start.getTime() - MARGIN_MS);
  const to = new Date(end.getTime() + MARGIN_MS);

  const reachedInWindow = db
    .select({ id: stops.loadId })
    .from(stops)
    // Raw SQL has no column to map a Date through: an ISO string, cast.
    .where(
      sql`coalesce(${stops.arrivedAt}, ${stops.departedAt}) >= ${from.toISOString()}::timestamptz
          and coalesce(${stops.arrivedAt}, ${stops.departedAt}) < ${to.toISOString()}::timestamptz`,
    );

  const loadRows = await db
    .select({
      id: loads.id,
      number: loads.loadNumber,
      status: loads.status,
      truckId: loads.truckId,
      truckNumber: trucks.truckNumber,
      samsaraName: trucks.samsaraName,
      createdAt: loads.createdAt,
    })
    .from(loads)
    .leftJoin(trucks, sql`${trucks.id} = ${loads.truckId}`)
    .where(
      or(
        inArray(loads.id, reachedInWindow),
        and(gte(loads.createdAt, start), lt(loads.createdAt, end)),
      ),
    );

  const ids = loadRows.map((l) => l.id);
  const stopRows = ids.length
    ? await db
        .select({
          loadId: stops.loadId,
          type: stops.type,
          sequence: stops.sequence,
          city: stops.city,
          state: stops.state,
          arrivedAt: stops.arrivedAt,
          departedAt: stops.departedAt,
        })
        .from(stops)
        .where(inArray(stops.loadId, ids))
        .orderBy(asc(stops.sequence))
    : [];

  const assignmentRows = await db
    .select({
      driverId: assignments.driverId,
      driverName: drivers.name,
      truckId: assignments.truckId,
      truckNumber: trucks.truckNumber,
      samsaraName: trucks.samsaraName,
      startedAt: assignments.startedAt,
      endedAt: assignments.endedAt,
    })
    .from(assignments)
    .innerJoin(drivers, sql`${drivers.id} = ${assignments.driverId}`)
    .innerJoin(trucks, sql`${trucks.id} = ${assignments.truckId}`)
    .where(
      and(
        lt(assignments.startedAt, to),
        or(isNull(assignments.endedAt), gte(assignments.endedAt, from)),
      ),
    );

  const label = (n: number | null, name: string | null) => (n !== null ? String(n) : name);

  const historyLoads: HistoryLoad[] = loadRows.map((l) => ({
    id: l.id,
    number: l.number,
    status: l.status,
    truckId: l.truckId,
    truckLabel: label(l.truckNumber, l.samsaraName),
    createdAt: l.createdAt.toISOString(),
    stops: stopRows
      .filter((s) => s.loadId === l.id)
      .map((s) => ({
        type: s.type,
        sequence: s.sequence,
        city: s.city,
        state: s.state,
        arrivedAt: s.arrivedAt?.toISOString() ?? null,
        departedAt: s.departedAt?.toISOString() ?? null,
      })),
  }));

  const historyAssignments: HistoryAssignment[] = assignmentRows.map((a) => ({
    driverId: a.driverId,
    driverName: a.driverName,
    truckId: a.truckId,
    truckLabel: label(a.truckNumber, a.samsaraName) ?? '—',
    startedAt: a.startedAt.toISOString(),
    endedAt: a.endedAt?.toISOString() ?? null,
  }));

  return buildHistoryWeek({ week, timeZone, loads: historyLoads, assignments: historyAssignments });
}
