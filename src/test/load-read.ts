import type { FleetRow } from '@/server/fleet-query';
import type { LoadForEdit } from '@/server/load-read';

type StopRead = LoadForEdit['stops'][number];

/**
 * §12.119. What `GET /api/loads/:id` answers for the load a fleet row shows,
 * for component tests: the row's next stop as the load's one stop, and the
 * version the row carries — the same md5 the server computes for both.
 *
 * `extra` adds stops around it, in sequence order, for the multi-stop suites.
 */
export function loadReadFor(
  row: FleetRow,
  extra: { before?: Partial<StopRead>[]; after?: Partial<StopRead>[] } = {},
): LoadForEdit | null {
  const s = row.nextStop;
  if (!s) return null;
  const next: StopRead = {
    stopId: s.stopId,
    sequence: 1,
    type: s.type,
    addressLine: s.addressLine ?? null,
    city: s.city ?? null,
    state: s.state ?? null,
    zip: s.zip ?? null,
    apptStartUtc: s.apptStartUtc ?? null,
    apptEndUtc: s.apptEndUtc ?? null,
    apptTz: s.apptTz ?? null,
    apptType: s.apptType ?? 'APPT',
    dispatcherNote: s.dispatcherNote ?? null,
    arrivedAt: s.arrivedAt ?? null,
    arrivedSource: s.arrivedSource ?? null,
    departedAt: null,
    departedSource: null,
    precision: s.precision ?? null,
    accuracyMiles: s.accuracyMiles ?? null,
    override: row.override
      ? {
          id: '55555555-5555-4555-8555-555555555555',
          forcedStatus: row.override.forcedStatus,
          reason: row.override.reason,
          reasonNote: row.override.reasonNote ?? null,
          expiresAtUtc: row.override.expiresAtUtc,
        }
      : null,
  };
  const fill = (over: Partial<StopRead>, i: number): StopRead => ({
    ...next,
    stopId: `66666666-6666-4666-8666-${String(i).padStart(12, '0')}`,
    arrivedAt: null,
    arrivedSource: null,
    override: null,
    ...over,
  });
  const before = (extra.before ?? []).map((o, i) => fill(o, i + 1));
  const after = (extra.after ?? []).map((o, i) => fill(o, i + 101));
  const stops = [...before, next, ...after].map((stop, i) => ({ ...stop, sequence: i + 1 }));
  return {
    loadId: s.loadId,
    truckId: row.id,
    loadNumber: s.loadNumber ?? null,
    status: s.loadStatus,
    assignment: null,
    stops,
    version: s.loadVersion ?? '0123456789abcdef0123456789abcdef',
  };
}
