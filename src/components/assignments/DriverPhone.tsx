'use client';

import { useState } from 'react';
import { useEditingAllowed } from '@/hooks/useEditingAllowed';
import { formatPhone, normalizePhone } from '@/lib/dial';

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
      <span className="flex min-w-0 items-center gap-2" data-driver-phone={driverId}>
        <span
          data-driver-phone-value=""
          className={`truncate text-body tabular-nums ${shown ? 'text-text-secondary' : 'text-text-muted'}`}
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
            className="shrink-0 font-cond text-micro uppercase tracking-[.08em] text-text-muted hover:text-text disabled:opacity-45 disabled:hover:text-text-muted"
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
          className="h-8 min-w-0 flex-1 border border-line-hair bg-surface-raised px-2 text-body tabular-nums text-text"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="h-8 shrink-0 bg-accent px-2.5 font-cond text-micro font-semibold uppercase tracking-[.08em] text-text-inverse hover:bg-accent-hover disabled:opacity-45"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setEditing(false)}
          className="h-8 shrink-0 border border-line-hair px-2.5 font-cond text-micro uppercase tracking-[.08em] text-text-secondary"
        >
          Cancel
        </button>
      </span>
      {error ? (
        <span role="alert" className="text-small text-status-late-fg">
          {error}
        </span>
      ) : (
        <span className="text-small text-text-muted">Blank clears the number.</span>
      )}
    </span>
  );
}
