'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import type { FleetHealth } from '@/server/health';

/**
 * §14 feature 8.
 *
 * A minute, not the fleet's twenty seconds. The strip counts arrivals, and
 * the fleet completes a couple of runs a day — polling it three times a
 * minute would be three queries an hour that could change the number, and
 * fifty-seven that cannot.
 */
export const HEALTH_POLL_MS = 60_000;

async function fetchHealth(): Promise<FleetHealth> {
  const response = await fetch('/api/health', { cache: 'no-store' });
  if (!response.ok) throw await httpErrorFrom(response);
  return (await response.json()) as FleetHealth;
}

export function useFleetHealth(initial: FleetHealth) {
  return useQuery({
    queryKey: ['fleet-health'],
    queryFn: fetchHealth,
    refetchInterval: HEALTH_POLL_MS,
    staleTime: HEALTH_POLL_MS - 1_000,
    initialData: initial,
    /**
     * The strip keeps its last good totals through a failure rather than
     * blanking. It is secondary by §14.3, and a secondary surface that
     * disappears is more distracting than one that is a minute stale — the
     * fleet banner is already saying the console cannot reach the server.
     */
    placeholderData: (previous) => previous,
  });
}
