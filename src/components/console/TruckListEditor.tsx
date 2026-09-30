'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LISTS_KEY, writeList } from '@/hooks/useTruckLists';
import {
  LIST_NAME_MAX,
  LIST_TRUCK_CAP,
  parseTruckNumbers,
  resolveNumbers,
  truckLabel,
  type FleetTruck,
  type TruckList,
} from '@/lib/truck-lists';
import { useFocusTrap } from '@/components/edit/useModalChrome';

/**
 * §12.90 — create or edit a shared truck list.
 *
 * The trucks are chips, each removable. New ones come from a paste box —
 * numbers separated by commas, spaces, periods — read as it is typed, or from
 * the rows checked in the console. What the paste box holds is included on
 * Save without a separate "Add" press, so "paste twelve numbers, Save" works.
 *
 * Warnings never block the save: a number not in the fleet is named and left
 * out (a list holds trucks, not numbers), junk and duplicates are named.
 *
 * An edit saves from the version it opened at. If someone else saved in
 * between, nothing is written; the dialog says who and when, and offers the
 * current list to start again from — it never merges silently.
 */
export type EditorMode =
  { kind: 'create'; initialIds: string[] } | { kind: 'edit'; list: TruckList };

export function TruckListEditor({
  mode,
  fleet,
  checkedIds,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: EditorMode;
  fleet: FleetTruck[];
  checkedIds: string[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (id: string, created: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const trap = useFocusTrap(true);
  const editing = mode.kind === 'edit' ? mode.list : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [members, setMembers] = useState<string[]>(
    editing ? editing.truckIds : mode.kind === 'create' ? mode.initialIds : [],
  );
  const [baseVersion, setBaseVersion] = useState(editing?.version ?? 0);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<TruckList | null>(null);
  const [gone, setGone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byId = useMemo(() => new Map(fleet.map((t) => [t.id, t])), [fleet]);

  /** The paste box, read live. */
  const parsed = useMemo(() => {
    const p = parseTruckNumbers(pasted);
    const { ids, unknown } = resolveNumbers(p.numbers, fleet);
    const fresh = ids.filter((id) => !members.includes(id));
    return { ...p, unknown, fresh, already: ids.length - fresh.length };
  }, [pasted, fleet, members]);

  const finalIds = useMemo(() => [...members, ...parsed.fresh], [members, parsed.fresh]);
  const checkedFresh = checkedIds.filter((id) => !finalIds.includes(id));

  const sorted = useMemo(
    () =>
      [...members].sort((a, b) =>
        labelOf(byId, a).localeCompare(labelOf(byId, b), 'en', { numeric: true }),
      ),
    [members, byId],
  );

  const overCap = finalIds.length > LIST_TRUCK_CAP;
  const nameEmpty = name.trim() === '';

  async function save() {
    if (!canEdit || busy || overCap || nameEmpty || gone) return;
    setBusy(true);
    setProblem(null);
    const result = editing
      ? await writeList('PATCH', {
          op: 'update',
          id: editing.id,
          expectedVersion: baseVersion,
          name,
          truckIds: finalIds,
        })
      : await writeList('POST', { name, truckIds: finalIds });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      if (result.kind === 'conflict') setConflict(result.current);
      if (result.kind === 'not-found') setGone(true);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: LISTS_KEY });
    onSaved(result.id ?? editing?.id ?? '', editing === null);
  }

  async function remove() {
    if (!editing || busy) return;
    setBusy(true);
    const result = await writeList('DELETE', {
      id: editing.id,
      expectedVersion: baseVersion,
    });
    setBusy(false);
    if (!result.ok) {
      setConfirmDelete(false);
      setProblem(result.message);
      if (result.kind === 'conflict') setConflict(result.current);
      if (result.kind === 'not-found') setGone(true);
      return;
    }
    onDeleted(editing.id);
    await queryClient.invalidateQueries({ queryKey: LISTS_KEY });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmDelete) setConfirmDelete(false);
      else onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirmDelete, onClose]);

  const title = editing ? `Edit list — ${editing.name}` : 'New list';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={trap}
        data-list-editor=""
        className="flex max-h-full w-[600px] max-w-full flex-col border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            {title}
          </h2>
          <p className="mt-0.5 text-small text-text-mutedOnOverlay">
            Shared — every dispatcher sees this list and can use it.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <label className="block">
            <span className="mb-1 block text-small text-text-secondary">Name</span>
            <input
              data-initial-focus=""
              value={name}
              maxLength={LIST_NAME_MAX}
              disabled={!canEdit}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder="Bob's trucks"
              aria-label="List name"
              className="h-10 w-full border border-line-hair bg-surface-sunken px-2.5 text-body text-text placeholder:text-text-muted"
            />
          </label>

          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-small text-text-secondary">Trucks</span>
              <span
                data-list-count=""
                className="font-sans text-small tabular-nums text-text"
              >
                {finalIds.length} {finalIds.length === 1 ? 'truck' : 'trucks'}
                {overCap ? ` — at most ${LIST_TRUCK_CAP}` : ''}
              </span>
            </div>
            {sorted.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Trucks in this list">
                {sorted.map((id) => {
                  const t = byId.get(id);
                  const label = labelOf(byId, id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-1 border border-line-hair bg-surface-raised py-0.5 pl-2 pr-1 font-sans text-small tabular-nums text-text"
                    >
                      {label}
                      {t && !t.active ? (
                        <span className="text-text-mutedOnOverlay"> · inactive</span>
                      ) : null}
                      <button
                        type="button"
                        disabled={!canEdit}
                        aria-label={`Remove truck ${label}`}
                        onClick={() => setMembers((m) => m.filter((x) => x !== id))}
                        className="px-1 text-text-muted hover:text-status-late-fg"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-small text-text-mutedOnOverlay">
                {parsed.fresh.length > 0
                  ? `The ${parsed.fresh.length} typed below are added when you save.`
                  : 'No trucks yet.'}
              </p>
            )}
          </div>

          {canEdit ? (
            <div className="mt-4">
              <label className="block">
                <span className="mb-1 block text-small text-text-secondary">
                  Add trucks by number — separated by commas, spaces or periods
                </span>
                <textarea
                  value={pasted}
                  onChange={(e) => {
                    setPasted(e.target.value);
                    setProblem(null);
                  }}
                  aria-label="Truck numbers to add"
                  placeholder="113, 116, 124"
                  className="h-16 w-full border border-line-hair bg-surface-sunken p-2 font-sans text-body tabular-nums text-text placeholder:text-text-muted"
                />
              </label>
              <PasteSummary parsed={parsed} />
              <div className="mt-2 flex gap-2">
                {parsed.fresh.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMembers((m) => [...m, ...parsed.fresh]);
                      setPasted('');
                    }}
                    className="h-8 border border-line-hair px-3 font-cond text-micro uppercase tracking-[.09em] text-accent hover:border-accent"
                  >
                    Add {parsed.fresh.length}
                  </button>
                ) : null}
                {checkedFresh.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMembers((m) => [...m, ...checkedFresh])}
                    className="h-8 border border-line-hair px-3 font-cond text-micro uppercase tracking-[.09em] text-accent hover:border-accent"
                  >
                    Add the {checkedFresh.length} checked{' '}
                    {checkedFresh.length === 1 ? 'row' : 'rows'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-small text-text-mutedOnOverlay">
              Only dispatchers and admins can change lists.
            </p>
          )}

          {problem ? (
            <div
              role="alert"
              className="mt-3 border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg"
            >
              {problem}
              {conflict ? (
                <button
                  type="button"
                  onClick={() => {
                    setName(conflict.name);
                    setMembers(conflict.truckIds);
                    setBaseVersion(conflict.version);
                    setPasted('');
                    setConflict(null);
                    setProblem(null);
                  }}
                  className="ml-2 underline"
                >
                  Reload the current list
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line-hair bg-surface-raised px-4 py-3">
          <div>
            {editing && canEdit ? (
              confirmDelete ? (
                <span className="flex items-center gap-2 text-body text-text">
                  Delete “{editing.name}” for everyone?
                  <button
                    type="button"
                    onClick={() => void remove()}
                    className="h-8 border border-status-late-bd bg-status-late-bg px-3 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg"
                  >
                    Delete list
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-8 px-2 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
                  >
                    Keep it
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={gone}
                  className="h-10 border border-status-late-bd px-4 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg hover:bg-status-late-bg disabled:opacity-45"
                >
                  Delete list…
                </button>
              )
            ) : null}
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canEdit || busy || overCap || nameEmpty || gone}
              className="h-10 bg-accent px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover disabled:opacity-45"
            >
              {busy ? 'Saving…' : editing ? 'Save list' : 'Create list'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelOf(byId: Map<string, FleetTruck>, id: string): string {
  const t = byId.get(id);
  return t ? truckLabel(t) : 'unknown truck';
}

/** What the paste box will add, and everything it will not — never silent. */
function PasteSummary({
  parsed,
}: {
  parsed: {
    fresh: string[];
    already: number;
    unknown: number[];
    junk: string[];
    duplicates: number[];
  };
}) {
  const parts: { text: string; warn: boolean }[] = [];
  if (parsed.fresh.length > 0) {
    parts.push({
      text: `adds ${parsed.fresh.length} ${parsed.fresh.length === 1 ? 'truck' : 'trucks'}`,
      warn: false,
    });
  }
  if (parsed.already > 0)
    parts.push({ text: `${parsed.already} already in the list`, warn: false });
  if (parsed.duplicates.length > 0) {
    parts.push({ text: `typed twice: ${parsed.duplicates.join(', ')}`, warn: false });
  }
  if (parsed.unknown.length > 0) {
    parts.push({
      text: `not in the fleet, left out: ${parsed.unknown.join(', ')}`,
      warn: true,
    });
  }
  if (parsed.junk.length > 0) {
    parts.push({ text: `not a truck number: ${parsed.junk.join(', ')}`, warn: true });
  }
  if (parts.length === 0) return null;
  return (
    <p data-list-warnings="" className="mt-1 text-small">
      {parts.map((p, i) => (
        <span
          key={p.text}
          className={p.warn ? 'text-status-risk-fg' : 'text-text-mutedOnOverlay'}
        >
          {i > 0 ? ' · ' : ''}
          {p.text}
        </span>
      ))}
    </p>
  );
}
