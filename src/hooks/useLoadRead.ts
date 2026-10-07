'use client';

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { LoadForEdit } from '@/lib/load-read';
import type { FleetRow } from '@/server/fleet-query';

/**
 * §12.119. The load read the edit modal opens on (`GET /api/loads/:id`),
 * fetched BEFORE the modal is asked for: when a truck is selected — which is
 * also when its popup opens — so a click on Edit load finds it in hand.
 *
 * The key names everything the read can differ by, so a cached read is never
 * one the board has moved past:
 *
 *   version          what people edit (§12.117) — load, stops, assignment,
 *                    a hand arrival or departure, the live override
 *   next stop        a detected departure moves it on
 *   next arrival     a detected arrival on it
 *
 * The worker writes nothing else on a load: it watches the board's next stop
 * only. A read under the key the row shows now is therefore the load as the
 * row shows it, however long ago it was fetched.
 */

export const LOAD_READ_SETTLE_MS = 250;

/**
 * How long a read nobody is looking at is kept. React Query's default is five
 * minutes; a dispatcher who selects a truck, takes a phone call and THEN
 * clicks Edit load should still find it in hand. A read is a few kilobytes,
 * and its key moves whenever the load does, so keeping it costs nothing.
 */
export const LOAD_READ_GC_MS = 30 * 60_000;

export function loadReadKey(row: FleetRow): readonly unknown[] | null {
  const s = row.nextStop;
  if (!s) return null;
  return ['load', s.loadId, s.loadVersion, s.stopId, s.arrivedAt] as const;
}

export async function fetchLoadRead(loadId: string): Promise<LoadForEdit> {
  const response = await fetch(`/api/loads/${loadId}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'This load could not be read.');
  }
  return LoadForEdit.parse(await response.json());
}

/** Fetches the read for this row unless it is already in hand. */
export function prefetchLoadRead(client: QueryClient, row: FleetRow): Promise<void> | null {
  const key = loadReadKey(row);
  const loadId = row.nextStop?.loadId;
  if (!key || !loadId || client.getQueryData(key) !== undefined) return null;
  return client.prefetchQuery({
    queryKey: key,
    queryFn: () => fetchLoadRead(loadId),
    staleTime: Infinity,
    gcTime: LOAD_READ_GC_MS,
  });
}

/**
 * The Console's half: the selected truck's load, fetched once the selection
 * has settled. Arrowing down the list selects a row every keystroke; reading
 * every one would spend the `read` rate limit (60, refilling 2 a second) on
 * loads nobody opened.
 */
export function usePrefetchLoadRead(row: FleetRow | null): void {
  const client = useQueryClient();
  const key = row ? loadReadKey(row) : null;
  const keyText = key ? JSON.stringify(key) : null;
  useEffect(() => {
    if (!row || !keyText) return;
    const timer = setTimeout(() => {
      // `prefetchQuery` never rejects: a failed prefetch leaves nothing in
      // the cache, the modal reads again when it opens, and says so there if
      // that fails too.
      void prefetchLoadRead(client, row);
    }, LOAD_READ_SETTLE_MS);
    return () => clearTimeout(timer);
    // The key, not the row object: the row is a new object every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, keyText]);
}
