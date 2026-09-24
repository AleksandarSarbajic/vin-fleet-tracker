'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import { FLEET_POLL_MS } from './useFleet';
import type { TrailPoint } from '@/lib/trail';

/**
 * §14 feature 9. The selected truck's last half hour.
 *
 * Nothing is fetched while nothing is selected — the trail is selected-only
 * (§14.3), and a query that ran anyway would be one request per poll for a
 * layer that is not on screen.
 *
 * The fleet's own interval, because the trail's newest dot and the marker it
 * sits behind come from the same readings. On a slower interval the head of
 * the trail would lag the marker it is supposed to be attached to.
 */
export function useTrail(truckId: string | null) {
  return useQuery({
    queryKey: ['trail', truckId],
    queryFn: async (): Promise<TrailPoint[]> => {
      const response = await fetch(`/api/trail?truck=${truckId!}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw await httpErrorFrom(response);
      return ((await response.json()) as { points: TrailPoint[] }).points;
    },
    enabled: truckId !== null,
    refetchInterval: FLEET_POLL_MS,
    staleTime: FLEET_POLL_MS - 1_000,
    /*
     * No `placeholderData`, on purpose and unlike every other query here.
     * Selecting a different truck must not carry the old truck's trail across
     * while the new one loads: a trail behind the wrong marker is a claim
     * about where THAT truck has been. The key carries the id, so each truck
     * has its own cache entry and nothing bridges them.
     */
  });
}
