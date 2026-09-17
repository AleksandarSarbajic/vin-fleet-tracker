import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { drivers } from '@/db/schema';
import { applyPlaceholders } from '@/lib/placeholder-fleet';
import { LATEST_POSITION_SQL, parseFleetRows } from './fleet-query';

export type { FleetRow } from './fleet-query';

export async function loadFleet() {
  const [result, driverRows] = await Promise.all([
    db.execute(LATEST_POSITION_SQL),
    // Only needed by the phase-3 placeholder. TODO(phase 4): drop this read
    // once assignments carry real drivers.
    db
      .select({ name: drivers.name })
      .from(drivers)
      .where(eq(drivers.active, true))
      .orderBy(asc(drivers.name)),
  ]);

  // Validated at the boundary, exactly like every Samsara response.
  const rows = parseFleetRows(result);

  // ---------------------------------------------------------------------
  // The ONE call that fabricates data. Delete this line and every invented
  // status and driver name disappears from the app — nothing is hiding
  // behind a flag elsewhere.
  // TODO(phase 5): replace with the real engine from lib/status.ts.
  // TODO(phase 4): drop the driver half once assignments are written.
  // ---------------------------------------------------------------------
  return applyPlaceholders(
    rows,
    driverRows.map((d) => d.name),
  );
}
