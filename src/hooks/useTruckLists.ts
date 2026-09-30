'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import type { TruckList } from '@/lib/truck-lists';
import { FLEET_POLL_MS } from './useFleet';

/**
 * §12.90. Shared lists, on the fleet's own cadence: a list someone else
 * changed — or deleted — reaches every open console within one poll, 20 s.
 *
 * Its own request beside `/api/fleet` rather than folded into it: the fleet
 * payload is the hot path every tab renders from, and lists change a few
 * times a week. It spends the `read` budget, which four tabs polling this and
 * the health strip use about 13% of (rate-limit.test.ts replays it).
 */
export const LISTS_POLL_MS = FLEET_POLL_MS;
export const LISTS_KEY = ['truck-lists'] as const;

export function useTruckLists(initial: TruckList[]) {
  return useQuery({
    queryKey: LISTS_KEY,
    queryFn: async (): Promise<TruckList[]> => {
      const response = await fetch('/api/truck-lists', { cache: 'no-store' });
      if (!response.ok) throw await httpErrorFrom(response);
      return ((await response.json()) as { lists: TruckList[] }).lists;
    },
    initialData: initial,
    refetchInterval: LISTS_POLL_MS,
    staleTime: LISTS_POLL_MS - 1_000,
    // A failed poll keeps the lists it had; it never empties the menu.
    placeholderData: (previous) => previous,
  });
}

export type ListWriteResult =
  | { ok: true; id: string | null; version: number | null; added: number | null }
  | { ok: false; message: string; kind: string; current: TruckList | null };

/**
 * Every list write, one shape back. A refusal carries the server's sentence —
 * the name clash, the cap, the version conflict, the viewer's role — to show
 * as it is, never replaced by a generic "failed".
 */
export async function writeList(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<ListWriteResult> {
  try {
    const response = await fetch('/api/truck-lists', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      kind?: string;
      current?: TruckList | null;
      reference?: string;
      id?: string;
      version?: number;
      added?: number;
    };
    if (response.ok) {
      return {
        ok: true,
        id: data.id ?? null,
        version: data.version ?? null,
        added: data.added ?? null,
      };
    }
    return {
      ok: false,
      message: `${data.error ?? 'The list could not be saved.'}${data.reference ? ` (${data.reference})` : ''}`,
      kind: data.kind ?? 'error',
      current: data.current ?? null,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The list could not be saved.',
      kind: 'network',
      current: null,
    };
  }
}
