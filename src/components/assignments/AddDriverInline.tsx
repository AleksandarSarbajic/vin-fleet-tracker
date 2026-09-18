'use client';

import { useState } from 'react';
import { DriverCreate } from '@/lib/driver';

/**
 * "+ Add driver", inline at the bottom of the driver picker (§12.37).
 *
 * Placed HERE rather than as a button on the board because this is the moment
 * the need is felt: a dispatcher types a surname, does not find them, and the
 * answer is directly under the empty result. A separate control elsewhere is
 * something you have to already know exists.
 *
 * Name and optional phone, nothing else — a required field a dispatcher
 * cannot fill at 6am is a required field they will fake.
 *
 * On success it hands the new driver's id back so the picker can SELECT them,
 * and the dispatcher carries on rather than starting over.
 */
export function AddDriverInline({
  suggestedName,
  assignToTruckId,
  onCreated,
  onCancel,
}: {
  /** Whatever they typed into the search, which is almost always the name. */
  suggestedName: string;
  /**
   * §12.38. Present when the truck is EMPTY, so the driver can be created and
   * assigned in one transaction. Absent when it already has a driver: that is
   * a reassignment and belongs to the confirm path, so the button says what it
   * can actually do instead.
   */
  assignToTruckId: string | null;
  onCreated: (driverId: string, name: string, assignedTruckId: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = DriverCreate.safeParse({ name, phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          driver: parsed.data,
          ...(assignToTruckId !== null ? { truckId: assignToTruckId } : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'The driver could not be saved.';
        setError(message);
        return;
      }
      const { driverId, assignedTruckId } = body as {
        driverId: string;
        assignedTruckId: string | null;
      };
      onCreated(driverId, parsed.data.name, assignedTruckId ?? null);
    } catch {
      setError('The driver could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="border-t border-line-hair bg-surface-sunken p-2.5"
      // The picker closes on outside mousedown; this is inside it, but the
      // keyboard handlers on the input above must not steal these keys.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p className="mb-2 font-cond text-micro uppercase tracking-[.09em] text-text-muted">
        Add a driver
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        aria-label="New driver name"
        className="mb-1.5 h-9 w-full border border-line-hair bg-surface-raised px-2 text-body text-text"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        aria-label="New driver phone"
        className="mb-1.5 h-9 w-full border border-line-hair bg-surface-raised px-2 text-body text-text"
      />
      {/**
       * Said plainly, because it is the reason this driver looks different
       * everywhere else on the board.
       */}
      <p className="mb-2 text-small text-text-muted">
        No ELD — this driver is not in Samsara, so the truck&rsquo;s position
        still comes from the vehicle.
        {assignToTruckId === null
          ? ' This truck already has a driver, so the change is confirmed when you save.'
          : ''}
      </p>
      {error ? (
        <p className="mb-2 text-small text-status-late-fg" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || name.trim() === ''}
          className="h-9 flex-1 border border-line-hair bg-surface-raised font-cond text-micro uppercase tracking-[.09em] text-text disabled:text-text-muted"
        >
          {/**
           * The label matches what the button can do. On an occupied truck it
           * can only create — the assignment is a reassignment and goes
           * through the existing confirm on Save — so it must not promise one.
           */}
          {saving ? 'Adding…' : assignToTruckId !== null ? 'Add and assign' : 'Add driver'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 border border-line-hair px-3 font-cond text-micro uppercase tracking-[.09em] text-text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
