'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import type { TimelineStop } from '@/server/timeline';

/**
 * §14 feature 15.
 *
 * Nothing is fetched until the timeline is opened, and it does not poll. It
 * is a read of what has already happened, opened deliberately and closed
 * again — refreshing it under the reader's eyes would move the rows they are
 * in the middle of reading, for a change that arrives every twenty minutes at
 * best.
 */
export function useTruckTimeline(truckId: string | null) {
  return useQuery({
    queryKey: ['timeline', truckId],
    queryFn: async (): Promise<TimelineStop[]> => {
      const response = await fetch(`/api/timeline?truck=${truckId!}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw await httpErrorFrom(response);
      return ((await response.json()) as { stops: TimelineStop[] }).stops;
    },
    enabled: truckId !== null,
    // Long enough that reopening the same truck in one sitting is instant,
    // short enough that it is not yesterday's answer.
    staleTime: 60_000,
  });
}
