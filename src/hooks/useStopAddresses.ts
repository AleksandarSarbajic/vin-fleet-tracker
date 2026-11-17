'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import { PastAddresses, type PastAddress } from '@/lib/past-address';

async function fetchPastAddresses(): Promise<PastAddress[]> {
  const response = await fetch('/api/stops/addresses', { cache: 'no-store' });
  if (!response.ok) throw await httpErrorFrom(response);
  return PastAddresses.parse(await response.json()).addresses;
}

/**
 * §12.164, phase 3bx (QoL 2). The company's past stop addresses, fetched ONCE per window open and
 * filtered in the browser as the dispatcher types (`matchAddresses`). Called by the edit window's
 * root, which lives exactly as long as the window: `staleTime: Infinity` asks nothing more while
 * it is open, through a reading panel and an editor opened again on a landed save, and
 * `gcTime: 0` drops the list when it closes, so the next window asks afresh. No cache layer
 * beyond that. A viewer, who cannot enter a stop, is not asked: the route would refuse.
 */
export function useStopAddresses(enabled: boolean): { addresses: readonly PastAddress[] | null; failed: boolean } {
  const query = useQuery({
    queryKey: ['stop-addresses'],
    queryFn: fetchPastAddresses,
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return { addresses: query.data ?? null, failed: query.isError };
}
