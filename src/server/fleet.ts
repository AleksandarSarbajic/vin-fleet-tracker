import 'server-only';
import { db } from '@/db';
import { applyPlaceholders } from '@/lib/placeholder-fleet';
import { LATEST_POSITION_SQL, parseFleetRows } from './fleet-query';

export type { FleetRow } from './fleet-query';

export async function loadFleet() {
  // Validated at the boundary, exactly like every Samsara response. Drivers
  // come from the lateral join's assignments row now — real ones, entered on
  // the bulk assignment screen.
  const rows = parseFleetRows(await db.execute(LATEST_POSITION_SQL));

  // ---------------------------------------------------------------------
  // The ONE call that fabricates data, down to status alone since phase 4.
  // Delete this line and every invented value disappears from the app.
  // TODO(phase 5): replace with the real engine from lib/status.ts.
  // ---------------------------------------------------------------------
  return applyPlaceholders(rows);
}
