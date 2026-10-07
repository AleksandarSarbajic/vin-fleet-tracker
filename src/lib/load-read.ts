import { z } from 'zod';
import { LOAD_STATUSES } from './loads';
import { ARRIVAL_SOURCES } from './status';

/**
 * §12.117. What `GET /api/loads/:id` answers: the load, the truck's open
 * assignment, every stop in sequence order with its live override, and the
 * version of exactly that. The query is `server/load-read.ts`; the shape is
 * here, so the edit modal checks the answer with the same schema the server
 * wrote it against (§12.119).
 */
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const Override = z.object({
  id: z.string().uuid(),
  forcedStatus: z.string(),
  reason: z.string(),
  reasonNote: z.string().nullable(),
  expiresAtUtc: ISO,
});

const Stop = z.object({
  stopId: z.string().uuid(),
  sequence: z.number().int(),
  type: z.enum(['PU', 'DEL']),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  apptStartUtc: ISO.nullable(),
  apptEndUtc: ISO.nullable(),
  apptTz: z.string().nullable(),
  apptType: z.enum(['APPT', 'FCFS']),
  dispatcherNote: z.string().nullable(),
  arrivedAt: ISO.nullable(),
  arrivedSource: z.enum(ARRIVAL_SOURCES).nullable(),
  departedAt: ISO.nullable(),
  /** §12.118. */
  departedSource: z.enum(['detected', 'dispatcher']).nullable(),
  precision: z.enum(['street', 'block', 'zip']).nullable(),
  accuracyMiles: z.number().nullable(),
  override: Override.nullable(),
});

export const LoadForEdit = z.object({
  loadId: z.string().uuid(),
  truckId: z.string().uuid().nullable(),
  loadNumber: z.string().nullable(),
  status: z.enum(LOAD_STATUSES),
  assignment: z.object({ id: z.string().uuid(), driverId: z.string().uuid() }).nullable(),
  stops: z.array(Stop),
  version: z.string().regex(/^[0-9a-f]{32}$/),
});

export type LoadForEdit = z.infer<typeof LoadForEdit>;
