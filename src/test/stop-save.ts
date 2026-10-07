import { eq } from 'drizzle-orm';
import { stops } from '@/db/schema';
import { LoadEdit, loadEditFromStop, singleStopField } from '@/lib/load-edit';
import type { StopEdit } from '@/lib/stop-edit';
import type { Db, Tx } from '@/server/audit';
import { readLoadVersion } from '@/server/load-version';
import { AtStopError, saveLoadEdit, StopEditError, type SaveWarning } from '@/server/stop-edit';
import type { ReassignPreview } from '@/server/reassign';
import type { ResolvedAppointment } from '@/server/appointment';

/**
 * §12.117. The single-stop save the suites were written against, run through
 * the load save the modal now uses — exactly as the modal does: one stop, the
 * load it is on, and the version as it stands when the "modal" opens, which
 * here is the moment of the call.
 *
 * So every rule those suites pin down — notes, arrivals, anchors, the
 * reached-stop question, previous loads, overrides — is asserted through the
 * new path rather than beside it. Errors come back as they always did: a
 * stop's error unwrapped, with its bare field name.
 */
export async function saveStopEdit(
  db: Db | Tx,
  input: {
    actorUserId: string | null;
    edit: StopEdit;
    dispatchTz: string;
    fetchImpl?: typeof fetch;
  },
): Promise<{
  stopId: string;
  loadId: string;
  appointment: ResolvedAppointment | null;
  reassignment: ReassignPreview | null;
  warnings: SaveWarning[];
}> {
  let loadId: string | null = null;
  let version: string | undefined;
  if (input.edit.stopId) {
    const [row] = await db
      .select({ loadId: stops.loadId })
      .from(stops)
      .where(eq(stops.id, input.edit.stopId))
      .limit(1);
    if (!row) throw new StopEditError('That stop no longer exists.', 'stopId');
    loadId = row.loadId;
    version = (await readLoadVersion(db, loadId)) ?? undefined;
  }

  try {
    const result = await saveLoadEdit(db as Db, {
      actorUserId: input.actorUserId,
      dispatchTz: input.dispatchTz,
      edit: LoadEdit.parse(loadEditFromStop(input.edit, { loadId, version })),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    return {
      stopId: result.stops[0]!.stopId,
      loadId: result.loadId,
      appointment: result.stops[0]!.appointment,
      reassignment: result.reassignment,
      warnings: result.warnings.map((w) => ({ ...w, field: singleStopField(w.field) })),
    };
  } catch (error: unknown) {
    if (error instanceof AtStopError) throw error.error;
    throw error;
  }
}
