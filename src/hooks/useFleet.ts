'use client';

import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import { editingAllowedNow } from '@/lib/editing';
import type { FleetRow } from '@/server/fleet-query';

/**
 * The brief puts client polling at 15–30s. 20s against our own database keeps
 * worst-case staleness around 50s once the worker's own 30s Samsara poll is
 * added on top.
 */
export const FLEET_POLL_MS = 20_000;

/**
 * §12.164, phase 3bx (QoL 5). A hidden tab polls about once a minute (Alex, 2026-11-15), so the
 * tab's title, read while the tab is hidden, is not frozen on what it said when the dispatcher
 * left. Before, the poll stopped while hidden (`queryObserver`'s interval asks `isFocused`).
 * About 60 `/api/fleet` calls an hour per hidden tab, against 180 visible; browsers may throttle
 * a hidden tab's timers further (Chrome aligns them to the minute after five minutes hidden).
 */
export const FLEET_HIDDEN_POLL_MS = 60_000;

/**
 * The interval, asked whenever the query's options are set (every render of the console, which
 * re-renders when the tab hides or shows, `usePageVisible`) and after each fetch. Below the
 * editing width nothing new is offered (§12.94): a hidden phone tab stops, as it always did.
 */
export function fleetPollInterval(): number | false {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return FLEET_POLL_MS;
  return editingAllowedNow() ? FLEET_HIDDEN_POLL_MS : false;
}

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
    refetchInterval: fleetPollInterval,
    // §12.164: on while hidden too, at the hidden rate the interval gives.
    refetchIntervalInBackground: true,
    // Just under the interval, so returning to the tab does not fire a second
    // request on top of the one about to run. Back from a hidden tab (whose
    // answer can be up to a minute old) the focus refetch and the resume
    // refetch (`useResumeRefetch`, `cancelRefetch: false`) join: one request.
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
