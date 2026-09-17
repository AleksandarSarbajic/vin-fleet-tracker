import { z } from 'zod';

/**
 * The driver-truck mapping. Shared by the client and the server; the server
 * re-validates everything regardless of what the UI allowed.
 *
 * Samsara returns `data: null` for driver-vehicle assignments in this org
 * (docs/samsara.md §6), so this app is the ONLY place the mapping exists.
 * There is nothing to seed from and 23 pairs to enter on day one, which is
 * what the bulk screen is for.
 */

export const AssignmentChange = z
  .object({
    truckId: z.string().uuid(),
    /** Null clears the truck's driver. */
    driverId: z.string().uuid().nullable(),
  })
  .strict();
export type AssignmentChange = z.infer<typeof AssignmentChange>;

export const BulkAssignmentSave = z
  .object({ changes: z.array(AssignmentChange).min(1).max(500) })
  .strict();
export type BulkAssignmentSave = z.infer<typeof BulkAssignmentSave>;

/**
 * Why a row was refused. A bulk save reports EVERY conflict, never the first:
 * being told about row 14 and then row 17 on the next attempt is how a
 * dispatcher loses a shift to a data-entry screen.
 */
export const CONFLICT_REASONS = [
  'DRIVER_ON_TWO_TRUCKS',
  'UNKNOWN_TRUCK',
  'INACTIVE_TRUCK',
  'UNKNOWN_DRIVER',
  'INACTIVE_DRIVER',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

export interface AssignmentConflict {
  reason: ConflictReason;
  /** Every truck the conflict touches — a driver on two trucks names both. */
  truckIds: string[];
  /** Ready to read: "Truck 1147 and truck 1088 both take R. Nowak." */
  message: string;
}

export const CONFLICT_HEADLINE: Record<ConflictReason, string> = {
  DRIVER_ON_TWO_TRUCKS: 'One driver, two trucks',
  UNKNOWN_TRUCK: 'No such truck',
  INACTIVE_TRUCK: 'Truck is inactive',
  UNKNOWN_DRIVER: 'No such driver',
  INACTIVE_DRIVER: 'Driver is inactive',
};

/** What a successful save reports back. */
export interface AssignmentSaveResult {
  assigned: number;
  cleared: number;
  unchanged: number;
  /** Shared by every audit row this save wrote. */
  batchId: string;
}
