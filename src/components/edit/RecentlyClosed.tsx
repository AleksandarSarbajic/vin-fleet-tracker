'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { httpErrorFrom } from '@/lib/http-error';
import { recentlyClosedLine, type RecentlyClosed as Closed } from '@/lib/reopen-load';
import { ReopenConfirm } from './ReopenConfirm';

/**
 * §12.107 — "Recently closed on this truck", in the Edit Stop modal: the
 * truck's loads closed in the last 7 days, each with Reopen…. Drawn only
 * when there is one. The modal never opens on a phone (§12.94), so neither
 * does this.
 *
 * A viewer sees the rows with Reopen disabled and the reason (§12.14); the
 * route refuses them whatever the page drew.
 */
async function fetchClosed(truckId: string): Promise<Closed[]> {
  const response = await fetch(`/api/stops/reopen?truckId=${encodeURIComponent(truckId)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw await httpErrorFrom(response);
  const body = (await response.json()) as { loads?: Closed[] };
  return body.loads ?? [];
}

export function RecentlyClosed({
  truckId,
  truckName,
  dispatchTz,
  mayEdit,
  lockedReason,
  onReopened,
}: {
  truckId: string;
  truckName: string;
  dispatchTz: string;
  mayEdit: boolean;
  lockedReason: string;
  onReopened: () => void;
}) {
  const query = useQuery({
    queryKey: ['recently-closed', truckId],
    queryFn: () => fetchClosed(truckId),
    staleTime: 0,
  });
  const [confirming, setConfirming] = useState<Closed | null>(null);
  const [now] = useState(() => new Date());

  if (query.isError) {
    return (
      <p className="mt-4 text-small text-text-mutedOnOverlay" data-recently-closed-error>
        Recently closed loads could not be read.
      </p>
    );
  }
  const closed = query.data ?? [];
  if (closed.length === 0) return null;

  return (
    <details className="mt-4 border border-line-hair" data-recently-closed>
      <summary className="cursor-pointer px-3 py-2 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
        Recently closed on this truck · {closed.length}
      </summary>
      <ul className="border-t border-line-soft">
        {closed.map((load) => (
          <li
            key={load.loadId}
            data-closed-load={load.loadId}
            className="flex items-center justify-between gap-3 px-3 py-1.5 text-body text-text"
          >
            <span className="min-w-0 truncate tabular-nums">
              {recentlyClosedLine(load, dispatchTz, now)}
            </span>
            <button
              type="button"
              disabled={!mayEdit}
              title={mayEdit ? undefined : lockedReason}
              onClick={() => setConfirming(load)}
              className="h-8 shrink-0 border border-line-hair px-3 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover disabled:opacity-45 disabled:hover:bg-transparent"
            >
              Reopen…
            </button>
          </li>
        ))}
      </ul>
      {confirming ? (
        <ReopenConfirm
          truckId={truckId}
          truckName={truckName}
          load={confirming}
          dispatchTz={dispatchTz}
          onBack={() => setConfirming(null)}
          onReopened={onReopened}
        />
      ) : null}
    </details>
  );
}
