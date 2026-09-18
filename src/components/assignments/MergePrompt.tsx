'use client';

import { useCallback, useEffect, useState } from 'react';
import { can, type Role } from '@/lib/roles';
import type { OpenMergeCandidate } from '@/server/drivers';

/**
 * "Samsara now has a driver with this name. Is this the one you added?"
 * (§12.35, §12.37)
 *
 * On the assignment board, because that is where a dispatcher is already
 * thinking about who is on what.
 *
 * This is the surface the detect-and-offer design depends on. The worker
 * records a candidate every poll and acts on none of them, so **an unshown
 * candidate is worse than an undetected one** — the data claims the question
 * was asked, and nobody was asked anything. Without this the duplicate sits
 * there silently while assignment history accrues against the wrong row.
 */
export function MergePrompt({ role }: { role: Role }) {
  const [candidates, setCandidates] = useState<OpenMergeCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/drivers', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { candidates: OpenMergeCandidate[] };
      setCandidates(body.candidates);
    } catch {
      // A prompt that cannot load is not worth an error on the board.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, id: string) => {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failed = (await response.json()) as { error?: string };
        setError(failed.error ?? 'That could not be completed.');
        return;
      }
      await load();
    } catch {
      setError('That could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  if (candidates.length === 0) return null;

  // Linking rewrites which driver row past assignments point at, so it is
  // admin-only. Saying "not the same person" destroys nothing, so it is not.
  const mayLink = can(role, 'admin');

  return (
    <div className="mb-4 border border-status-risk-bd bg-status-risk-bg p-3">
      <h2 className="mb-2 font-cond text-micro uppercase tracking-[.11em] text-status-risk-fg">
        Possible duplicate {candidates.length === 1 ? 'driver' : 'drivers'}
      </h2>
      {error ? (
        <p className="mb-2 text-small text-status-late-fg" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="text-body text-text">
            <p className="mb-1.5">
              Samsara now has a driver called{' '}
              <strong>{candidate.samsaraDriverName}</strong>. Is this the one
              added here on{' '}
              {new Date(candidate.appDriverCreatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
              ?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy !== null || !mayLink}
                title={
                  mayLink
                    ? 'Moves this driver’s assignment history onto the Samsara record.'
                    : `Your role is ${role}. Linking needs admin.`
                }
                onClick={() =>
                  void act(
                    {
                      action: 'link',
                      appDriverId: candidate.appDriverId,
                      samsaraDriverId: candidate.samsaraDriverId,
                    },
                    candidate.id,
                  )
                }
                className="h-8 border border-line-hair bg-surface-raised px-3 font-cond text-micro uppercase tracking-[.09em] text-text disabled:text-text-muted"
              >
                Same person — link
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act({ action: 'dismiss', candidateId: candidate.id }, candidate.id)
                }
                className="h-8 border border-line-hair px-3 font-cond text-micro uppercase tracking-[.09em] text-text-muted"
              >
                Different people
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
