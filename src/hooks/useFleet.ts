'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import type { FleetRow } from '@/server/fleet-query';

/**
 * The brief puts client polling at 15–30s. 20s against our own database keeps
 * worst-case staleness around 50s once the worker's own 30s Samsara poll is
 * added on top.
 */
export const FLEET_POLL_MS = 20_000;

export interface FleetResponse {
  fleet: FleetRow[];
  fetchedAt: string;
  /** §5.9: the client withdraws schedule colour fleet-wide when this is true. */
  feedStale: boolean;
  feedNewestAt: string | null;
}

async function fetchFleet(): Promise<FleetResponse> {
  const response = await fetch('/api/fleet', { cache: 'no-store' });
  // Carries the status, so `retry` can tell a blip from a 429 (see providers).
  if (!response.ok) throw await httpErrorFrom(response);
  return (await response.json()) as FleetResponse;
}

export function useFleet(initial: FleetResponse) {
  return useQuery({
    queryKey: ['fleet'],
    queryFn: fetchFleet,
    refetchInterval: FLEET_POLL_MS,
    // Just under the interval, so returning to the tab does not fire a second
    // request on top of the one about to run.
    staleTime: FLEET_POLL_MS - 1_000,
    initialData: initial,
    // Keeps the last good fleet on screen while a refetch is in flight. A
    // console that blanks every 20 seconds is unusable on a night shift.
    placeholderData: (previous) => previous,
    // Object identity survives for rows whose values did not change, so
    // memoised list rows do not re-render on every poll.
    structuralSharing: true,
  });
}
