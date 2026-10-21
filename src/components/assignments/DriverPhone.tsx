'use client';

import { useState } from 'react';
import { useEditingAllowed } from '@/hooks/useEditingAllowed';
import { formatPhone, normalizePhone } from '@/lib/dial';
import { ND_FOCUS } from './nightDesk';

/**
 * §12.106. A driver's phone on the assignment board: read, and for a
 * dispatcher on a desktop, set, changed or cleared in place.
 *
 * - A viewer sees the control disabled with the reason, never hidden
 *   (§12.14).
 * - Below 768px the number is read-only (§12.94): editing is a desktop job.
 * - Checked here with the same rule the server applies (`normalizePhone`), so
 *   a refusal is said before the request, in the same words.
 * - Nothing is sent to the driver. Saving a number stores it; that is all.
 * - §12.136. Drawn in Night desk, the assignment page's look: only that page
 *   renders this component, so its classes change here directly, with no
 *   `look` prop. The number is in IBM Plex Mono.
 */
export function DriverPhone({
  driverId,
  driverName,
  phone,
  mayEdit,
  lockedReason,
  onSaved,
}: {
  driverId: string;
  driverName: string;
  phone: string | null;
  mayEdit: boolean;
  lockedReason: string;
  onSaved: () => void;
}) {
  const editingAllowed = useEditingAllowed();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = phone ? formatPhone(phone) : null;

  if (!editing || !editingAllowed) {
    return (
      <span className="flex min-w-0 items-center gap-0.5" data-driver-phone={driverId}>
        <span
          data-driver-phone-value=""
          className={`truncate text-nightDesk-body ${
            shown ? 'font-nightDesk-mono text-nightDesk-inkSecondary' : 'text-nightDesk-muted'
          }`}
        >
          {shown ?? 'No phone'}
        </span>
        {editingAllowed ? (
          <button
            type="button"
            disabled={!mayEdit}
            title={mayEdit ? undefined : lockedReason}
            aria-label={`${shown ? 'Change' : 'Add'} the phone for ${driverName}`}
            onClick={() => {
              setTyped(shown ?? '');
              setError(null);
              setEditing(true);
            }}
            // A 28px-tall target. Disabled (a viewer) stays readable: muted
            // ink at 6.46:1, the not-allowed cursor and the title say why.
            className={`inline-flex h-7 shrink-0 items-center rounded-md px-1.5 text-nightDesk-small text-nightDesk-muted hover:enabled:text-nightDesk-ink disabled:cursor-not-allowed ${ND_FOCUS}`}
          >
            {shown ? 'Edit' : 'Add'}
          </button>
        ) : null}
      </span>
    );
  }

  const save = async () => {
    const checked = normalizePhone(typed);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'phone', driverId, phone: typed }),
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        setError(
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'The phone could not be saved.',
        );
        return;
      }
      setEditing(false);
      onSaved();
    } catch (cause: unknown) {
      // The cause only: the request body, and so the number, is not logged.
      console.error(
        'driver phone save failed',
        cause instanceof Error ? cause.message : 'unknown',
      );
      setError('The phone could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="flex min-w-0 flex-col gap-1" data-driver-phone={driverId}>
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="708-555-0123"
          aria-label={`Phone for ${driverName}`}
          aria-invalid={error !== null}
          className={`h-8 min-w-0 flex-1 rounded-md border bg-nightDesk-ground px-2 font-nightDesk-mono text-nightDesk-body text-nightDesk-ink ${
            error === null ? 'border-nightDesk-control' : 'border-nightDesk-negative'
          } ${ND_FOCUS}`}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className={`h-8 shrink-0 rounded-full bg-nightDesk-accent px-3 text-nightDesk-small font-semibold text-nightDesk-onAccent hover:enabled:bg-nightDesk-accentHover disabled:opacity-45 ${ND_FOCUS}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setEditing(false)}
          className={`h-8 shrink-0 rounded-full border border-nightDesk-control px-3 text-nightDesk-small text-nightDesk-inkSecondary hover:text-nightDesk-ink ${ND_FOCUS}`}
        >
          Cancel
        </button>
      </span>
      {error ? (
        <span role="alert" className="text-nightDesk-small text-nightDesk-negative">
          {error}
        </span>
      ) : (
        <span className="text-nightDesk-small text-nightDesk-muted">Blank clears the number.</span>
      )}
    </span>
  );
}
