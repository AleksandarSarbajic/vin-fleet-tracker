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
  /**
   * Whether the CHECK ran, separately from what it found (§12.43).
   *
   * These were one thing, and the one thing was `candidates.length === 0`.
   * Both a clean roster and a failed request rendered null, so the component
   * that exists to make sure the question gets asked answered it silently in
   * the negative whenever it could not ask.
   */
  const [checked, setChecked] = useState<'loading' | 'ready' | 'failed'>('loading');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/drivers', { cache: 'no-store' });
      // A refusal is a failure to check, not an absence of candidates. This
      // used to `return` into the same silence as the catch below.
      if (!response.ok) throw new Error(`/api/drivers returned ${response.status}`);
      const body = (await response.json()) as { candidates?: OpenMergeCandidate[] };
      // `{}` from a route handler is not "no candidates" either.
      if (!Array.isArray(body.candidates)) throw new Error('/api/drivers returned no candidate list');
      setCandidates(body.candidates);
      setChecked('ready');
    } catch (cause: unknown) {
      /**
       * Surfaced twice, deliberately: on the board for the dispatcher, who
       * needs to know the check is not running, and in the console for
       * whoever has to find out why. Neither one alone is a handler.
       */
      console.error('merge candidate check failed', cause);
      setChecked('failed');
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
    } catch (cause: unknown) {
      // Told to the dispatcher AND to whoever has to debug it. The message
      // alone is not a handler; it says what, never why.
      console.error('merge action failed', cause);
      setError('That could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * The check could not run. Neutral, not alarming: nothing is wrong with the
   * fleet and there may well be nothing to merge — we simply do not know, and
   * "do not know" is what the neutral token means everywhere else on the
   * console.
   */
  if (checked === 'failed') {
    return (
      <div
        role="status"
        className="mb-4 flex items-baseline justify-between gap-3 border border-status-neutral-bd bg-status-neutral-bg px-3 py-2"
      >
        <p className="text-small text-status-neutral-fg">
          Could not check for duplicate drivers. Any that Samsara has added are
          not being shown.
        </p>
        <button
          type="button"
          onClick={() => {
            setChecked('loading');
            void load();
          }}
          className="h-7 shrink-0 border border-line-hair px-2.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
        >
          Retry
        </button>
      </div>
    );
  }

  // Silence from here on is earned: the check ran and found nothing.
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
