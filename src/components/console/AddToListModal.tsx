'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LISTS_KEY, writeList } from '@/hooks/useTruckLists';
import {
  LIST_NAME_MAX,
  truckLabel,
  type FleetTruck,
  type TruckList,
} from '@/lib/truck-lists';
import { useFocusTrap } from '@/components/edit/useModalChrome';

/**
 * §12.90 — "Add to list…" from the bulk bar: the checked trucks into a list
 * that exists, or into a new one named here.
 *
 * Adding only ever adds, so there is no version check (§12.90): it cannot
 * overwrite anyone's edit. Trucks already in the chosen list are skipped and
 * the result says how many actually went in.
 */
export function AddToListModal({
  trucks,
  lists,
  onClose,
  onDone,
}: {
  /** The checked trucks, in board order. */
  trucks: FleetTruck[];
  lists: TruckList[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const trap = useFocusTrap(true);
  const [target, setTarget] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ids = trucks.map((t) => t.id);
  const labels = trucks.map(truckLabel).join(' · ');

  async function confirm() {
    if (busy || target === null) return;
    if (target === 'new' && name.trim() === '') {
      setProblem('Give the new list a name.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const list = lists.find((l) => l.id === target);
    const result =
      target === 'new'
        ? await writeList('POST', { name, truckIds: ids })
        : await writeList('PATCH', { op: 'add', id: target, truckIds: ids });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: LISTS_KEY });
    const added = target === 'new' ? ids.length : (result.added ?? 0);
    const skipped = ids.length - added;
    onDone(
      `${added} ${added === 1 ? 'truck' : 'trucks'} added to “${
        target === 'new' ? name.trim().replace(/\s+/g, ' ') : (list?.name ?? 'the list')
      }”${skipped > 0 ? ` · ${skipped} already in it` : ''}.`,
    );
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Add to list"
    >
      <div
        ref={trap}
        className="flex max-h-full w-[460px] max-w-full flex-col border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            Add {trucks.length} {trucks.length === 1 ? 'truck' : 'trucks'} to a list
          </h2>
          <p className="mt-0.5 truncate font-sans text-small tabular-nums text-text-mutedOnOverlay">
            {labels}
          </p>
        </div>

        <fieldset className="min-h-0 flex-1 overflow-auto border-0 p-4">
          <legend className="sr-only">Which list</legend>
          {lists.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-2 py-1 text-body text-text"
            >
              <input
                type="radio"
                name="add-to-list"
                checked={target === l.id}
                onChange={() => setTarget(l.id)}
              />
              <span className="truncate">{l.name}</span>
              <span className="shrink-0 text-small tabular-nums text-text-mutedOnOverlay">
                · {l.truckIds.length} {l.truckIds.length === 1 ? 'truck' : 'trucks'}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 py-1 text-body text-text">
            <input
              type="radio"
              name="add-to-list"
              checked={target === 'new'}
              onChange={() => setTarget('new')}
            />
            New list…
          </label>
          {target === 'new' ? (
            <input
              autoFocus
              value={name}
              maxLength={LIST_NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirm();
                }
              }}
              aria-label="New list name"
              placeholder="Name the new list"
              className="ml-6 mt-1 h-9 w-[calc(100%-1.5rem)] border border-line-hair bg-surface-sunken px-2 text-body text-text placeholder:text-text-muted"
            />
          ) : null}
          {problem ? (
            <p
              role="alert"
              className="mt-3 border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg"
            >
              {problem}
            </p>
          ) : null}
        </fieldset>

        <div className="flex justify-end gap-2.5 border-t border-line-hair bg-surface-raised px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={target === null || busy}
            onClick={() => void confirm()}
            className="h-10 bg-accent px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover disabled:opacity-45"
          >
            {busy ? 'Adding…' : 'Add to list'}
          </button>
        </div>
      </div>
    </div>
  );
}
