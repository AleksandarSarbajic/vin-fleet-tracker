'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_EXPIRY,
  EXPIRY_LABEL,
  EXPIRY_PRESETS,
  OVERRIDE_REASON_LABEL,
} from '@/lib/override';
import { FORCED_STATUSES, OVERRIDE_REASONS, STATUS_LABEL } from '@/lib/status';
import type { FleetRow } from '@/server/fleet-query';
import { useFocusTrap, useReturnFocus } from '@/components/edit/useModalChrome';

/**
 * The confirm for a bulk override or a bulk note (§14, feature 2).
 *
 * **Interpretation — no screen was drawn.** 5b shows the bar's two buttons
 * and nothing behind them, so this follows the edit modal's conventions and
 * §9.5's rules for what an override must collect.
 *
 * Two decisions worth naming:
 *
 * 1. **The trucks are listed, not counted.** A bulk status write is a claim
 *    about every truck in it, and "4 trucks" is not a claim anyone can check.
 * 2. **No CUSTOM expiry here.** The presets cover the bulk case and a
 *    per-stop datetime in a dialog acting on many stops invites one time to
 *    be wrong for most of them. A custom expiry stays available one truck at
 *    a time, where the dispatcher can see the appointment it relates to.
 */
export function BulkActionModal({
  action,
  rows,
  checked,
  onDone,
  onClose,
}: {
  action: 'status' | 'note';
  rows: FleetRow[];
  checked: ReadonlySet<string>;
  onDone: () => void;
  onClose: () => void;
}) {
  const picked = rows.filter((r) => checked.has(r.id) && r.nextStop);
  const trap = useFocusTrap(true);
  useReturnFocus(true);
  const queryClient = useQueryClient();

  const [forcedStatus, setForcedStatus] = useState<(typeof FORCED_STATUSES)[number]>('LATE');
  const [reason, setReason] = useState<(typeof OVERRIDE_REASONS)[number]>(OVERRIDE_REASONS[0]);
  const [reasonNote, setReasonNote] = useState('');
  const [expiry, setExpiry] = useState<(typeof EXPIRY_PRESETS)[number]>(DEFAULT_EXPIRY);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = picked
    .map((r) => (r.truckNumber === null ? r.samsaraName : String(r.truckNumber)))
    .join(' · ');

  /**
   * Stops, not trucks. The override attaches to the stop the truck is working
   * — a truck with no next stop has nothing to override, and is dropped here
   * rather than failing the whole act server-side.
   */
  const stopIds = picked.map((r) => r.nextStop!.stopId);
  const dropped = checked.size - picked.length;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body =
        action === 'status'
          ? {
              action: 'override' as const,
              override: {
                stopIds,
                forcedStatus,
                reason,
                reasonNote: reasonNote.trim() === '' ? null : reasonNote.trim(),
                expiry,
                customExpiry: null,
              },
            }
          : { action: 'note' as const, note: { stopIds, note: note.trim() } };

      const response = await fetch('/api/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        // The server refuses the whole act, so the message says so rather
        // than leaving the dispatcher to guess how many landed.
        setError(payload.error ?? 'Nothing was changed.');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
      onDone();
    } catch {
      setError('Nothing was changed — the request did not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    stopIds.length > 0 &&
    !busy &&
    (action === 'note'
      ? note.trim().length > 0
      : reason !== 'OTHER' || reasonNote.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label={action === 'status' ? 'Force status on several trucks' : 'Add a note to several trucks'}
    >
      <div
        ref={trap}
        className="w-[520px] max-w-full border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            {action === 'status' ? 'Force status' : 'Add note'}
          </h2>
          <p className="mt-0.5 text-small text-text-mutedOnOverlay">
            {picked.length} {picked.length === 1 ? 'truck' : 'trucks'} · {labels}
          </p>
          {dropped > 0 ? (
            <p className="mt-1 text-small text-status-risk-fg">
              {dropped} of the checked {dropped === 1 ? 'truck has' : 'trucks have'} no
              next stop, so {dropped === 1 ? 'it is' : 'they are'} not included.
            </p>
          ) : null}
        </div>

        <div className="space-y-3 px-4 py-3">
          {action === 'status' ? (
            <>
              <Field label="Show as">
                <select
                  value={forcedStatus}
                  onChange={(e) =>
                    setForcedStatus(e.target.value as (typeof FORCED_STATUSES)[number])
                  }
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                >
                  {FORCED_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Reason">
                <select
                  value={reason}
                  onChange={(e) =>
                    setReason(e.target.value as (typeof OVERRIDE_REASONS)[number])
                  }
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                >
                  {OVERRIDE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {OVERRIDE_REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Note"
                help={
                  reason === 'OTHER'
                    ? 'Required for "Other" — this note is the only record of it (§9.5).'
                    : 'Optional.'
                }
              >
                <input
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                />
              </Field>

              <Field label="Expires">
                <div className="flex gap-1.5">
                  {EXPIRY_PRESETS.filter((p) => p !== 'CUSTOM').map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={expiry === p}
                      onClick={() => setExpiry(p)}
                      className={`h-9 flex-1 border px-2 font-cond text-micro uppercase tracking-[.09em] ${
                        expiry === p
                          ? 'border-accent bg-surface-overlay text-text'
                          : 'border-line-soft text-text-mutedOnOverlay hover:bg-row-hover'
                      }`}
                    >
                      {EXPIRY_LABEL[p]}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : (
            <Field label="Note" help="Replaces the dispatcher note on every stop listed above.">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-20 w-full border border-line-hair bg-surface-sunken p-2 text-[13px] leading-[1.5] text-text"
              />
            </Field>
          )}

          {error ? (
            <p className="border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-line-hair bg-surface-raised px-4 py-3">
          <span className="text-small text-text-muted">
            All of them, or none — this lands in one transaction.
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="h-10 border border-accent bg-accent px-4 font-cond text-micro uppercase tracking-[.09em] text-text-inverse disabled:opacity-40"
            >
              {busy ? 'Applying…' : `Apply to ${picked.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-small text-text-secondary">{label}</span>
      {children}
      {help ? (
        <span className="mt-1 block text-small text-text-mutedOnOverlay">{help}</span>
      ) : null}
    </label>
  );
}
