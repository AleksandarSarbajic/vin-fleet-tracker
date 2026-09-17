'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/roles';
import { can } from '@/lib/roles';
import { CONFLICT_HEADLINE, type AssignmentConflict } from '@/lib/assignments';
import type { AssignmentBoard as Board } from '@/server/assignments';
import { DriverSelect } from './DriverSelect';

/**
 * Day-one data entry, and the screen a dispatcher returns to whenever the
 * board drifts.
 *
 * Samsara returns `data: null` for driver-vehicle assignments in this org, so
 * nothing can be seeded: all 23 pairs are typed here once. Both sides are on
 * screen — trucks without drivers and drivers without trucks — because the
 * gaps are the whole point.
 *
 * Not in the design document. It exists because the data does not.
 */

interface Props {
  board: Board;
  role: Role;
}

const label = (t: Board['trucks'][number]) =>
  t.truckNumber === null ? t.samsaraName : String(t.truckNumber);

export function AssignmentBoard({ board, role }: Props) {
  const router = useRouter();
  const mayEdit = can(role, 'dispatcher');
  const lockedReason = `Your role is ${role}. Assignments need dispatcher.`;

  const initial = useMemo(
    () => new Map(board.trucks.map((t) => [t.id, t.driverId])),
    [board.trucks],
  );
  const [draft, setDraft] = useState<Map<string, string | null>>(initial);
  const [conflicts, setConflicts] = useState<AssignmentConflict[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => setDraft(initial), [initial]);

  const changed = useMemo(
    () => board.trucks.filter((t) => (draft.get(t.id) ?? null) !== t.driverId),
    [board.trucks, draft],
  );
  const dirty = changed.length > 0;

  /** Dirty-state guard. A closed tab is a lost shift of data entry. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Which truck each driver is on IN THE DRAFT — shown inside the picker. */
  const claimedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const truck of board.trucks) {
      const driverId = draft.get(truck.id) ?? null;
      if (driverId) map.set(driverId, label(truck));
    }
    return map;
  }, [board.trucks, draft]);

  /** The same rule the server enforces, run early so Save can refuse first. */
  const doubleBooked = useMemo(() => {
    const byDriver = new Map<string, string[]>();
    for (const truck of board.trucks) {
      const driverId = draft.get(truck.id) ?? null;
      if (!driverId) continue;
      byDriver.set(driverId, [...(byDriver.get(driverId) ?? []), truck.id]);
    }
    return new Set(
      [...byDriver.values()].filter((ids) => ids.length > 1).flat(),
    );
  }, [board.trucks, draft]);

  const conflictedTrucks = useMemo(
    () => new Set([...doubleBooked, ...conflicts.flatMap((c) => c.truckIds)]),
    [doubleBooked, conflicts],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setFailure(null);
    setSaved(null);
    setConflicts([]);
    try {
      const response = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: changed.map((t) => ({
            truckId: t.id,
            driverId: draft.get(t.id) ?? null,
          })),
        }),
      });

      if (response.status === 409) {
        const body = (await response.json()) as { conflicts: AssignmentConflict[] };
        // Nothing was written. Every conflict, not the first.
        setConflicts(body.conflicts);
        return;
      }
      if (!response.ok) {
        const body = (await response.json()) as { error?: string; reference?: string };
        setFailure(
          `${body.error ?? 'The save failed.'}${body.reference ? ` (${body.reference})` : ''}`,
        );
        return;
      }

      const result = (await response.json()) as {
        assigned: number;
        cleared: number;
        unchanged: number;
      };
      setSaved(
        `Saved — ${result.assigned} assigned, ${result.cleared} cleared` +
          `${result.unchanged ? `, ${result.unchanged} unchanged` : ''}.`,
      );
      router.refresh();
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : 'The save failed.');
    } finally {
      setSaving(false);
    }
  }, [changed, draft, router]);

  /** Cmd/Ctrl+Enter saves, as everywhere else that writes (§8.1). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && dirty && mayEdit && !saving) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, mayEdit, saving, save]);

  const driversWithoutTruck = board.drivers.filter((d) => !claimedBy.has(d.id));
  const trucksWithoutDriver = board.trucks.filter((t) => !(draft.get(t.id) ?? null));

  return (
    <main className="flex min-h-dvh flex-col bg-surface-base">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line-hair bg-surface-raised px-[18px]">
        <div className="flex items-baseline gap-4">
          <h1 className="font-cond text-header font-semibold uppercase tracking-[.14em] text-text">
            Assignments
          </h1>
          <span className="text-body text-text-secondary">
            {board.trucks.length} active trucks · {board.drivers.length} active drivers
          </span>
        </div>
        <Link
          href="/"
          className="border border-line-hair px-3 py-1.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover"
        >
          Back to console
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 gap-5 overflow-auto p-5">
        <section className="min-w-0 flex-1">
          <div className="grid grid-cols-[92px_1fr_200px] items-center gap-x-4 border-b border-line-hair pb-2 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
            <span>Truck</span>
            <span>Driver</span>
            <span>Currently</span>
          </div>

          {board.trucks.map((truck) => {
            const value = draft.get(truck.id) ?? null;
            const isChanged = value !== truck.driverId;
            const isConflicted = conflictedTrucks.has(truck.id);
            return (
              <div
                key={truck.id}
                className={`grid grid-cols-[92px_1fr_200px] items-center gap-x-4 border-b border-line-soft py-2 ${
                  isConflicted ? 'bg-status-late-bg' : isChanged ? 'bg-row-selected' : ''
                }`}
              >
                <span className="font-sans text-data font-bold tabular-nums text-text">
                  {label(truck)}
                </span>
                <DriverSelect
                  drivers={board.drivers}
                  value={value}
                  claimedBy={claimedBy}
                  truckLabel={label(truck)}
                  disabled={!mayEdit || saving}
                  disabledReason={mayEdit ? undefined : lockedReason}
                  onChange={(driverId) =>
                    setDraft((d) => new Map(d).set(truck.id, driverId))
                  }
                />
                <span className="truncate text-body text-text-muted">
                  {truck.driverName ?? 'Unassigned'}
                </span>
              </div>
            );
          })}
        </section>

        <aside className="w-[260px] shrink-0 space-y-5">
          <Panel
            title={`Drivers with no truck (${driversWithoutTruck.length})`}
            empty="Every active driver has a truck."
            items={driversWithoutTruck.map((d) => d.name)}
          />
          <Panel
            title={`Trucks with no driver (${trucksWithoutDriver.length})`}
            empty="Every active truck has a driver."
            items={trucksWithoutDriver.map(label)}
          />
        </aside>
      </div>

      <footer className="shrink-0 border-t border-line-hair bg-surface-bar px-5 py-3">
        {conflicts.length > 0 ? (
          <ul className="mb-3 border border-status-late-bd bg-status-late-bg px-3 py-2">
            <li className="mb-1 font-cond text-micro uppercase tracking-[.11em] text-status-late-fg">
              Nothing was saved — {conflicts.length} conflict
              {conflicts.length === 1 ? '' : 's'}
            </li>
            {conflicts.map((conflict, i) => (
              <li key={i} className="text-body text-text">
                <span className="font-semibold">{CONFLICT_HEADLINE[conflict.reason]}:</span>{' '}
                {conflict.message}
              </li>
            ))}
          </ul>
        ) : null}

        {failure ? (
          <p className="mb-3 border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg">
            {failure}
          </p>
        ) : null}

        <div className="flex items-center justify-between">
          <span className="text-body text-text-secondary">
            {dirty
              ? `${changed.length} row${changed.length === 1 ? '' : 's'} changed${
                  doubleBooked.size > 0 ? ' · a driver is on two trucks' : ''
                }`
              : (saved ?? 'No changes.')}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(initial);
                setConflicts([]);
              }}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary disabled:opacity-45"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={!mayEdit || !dirty || saving || doubleBooked.size > 0}
              title={mayEdit ? undefined : lockedReason}
              onClick={() => void save()}
              className="h-10 bg-accent px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover disabled:opacity-45"
            >
              {saving ? 'Saving…' : 'Save assignments'}
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Panel({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="border border-line-hair bg-surface-raised p-3">
      <h2 className="mb-2 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-body text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className="truncate text-body text-text-secondary">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
