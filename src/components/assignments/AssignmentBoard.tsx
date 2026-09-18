'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/roles';
import { can } from '@/lib/roles';
import { CONFLICT_HEADLINE, type AssignmentConflict } from '@/lib/assignments';
import type { AssignmentBoard as Board } from '@/server/assignments';
import { DriverSelect } from './DriverSelect';
import { DriverName } from '@/components/DriverName';
import { MergePrompt } from './MergePrompt';

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

  /**
   * Which trucks the dispatcher has touched since the last save (§12.38).
   *
   * A ref, not state: it must not itself trigger the rebase below, and it is
   * read at the moment new server data arrives rather than rendered.
   */
  const edited = useRef<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<AssignmentConflict[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * REBASE, not reset (§12.38).
   *
   * This was `setDraft(initial)`, which threw away every local edit whenever
   * new server data arrived — and `router.refresh()` resolves BEFORE the new
   * props land, so anything edited in that gap was silently lost. It is how
   * "Add and assign" created a driver and left the truck empty, and the same
   * race sits behind every other refresh on this board: retiring a driver
   * refreshes, and would have wiped a half-finished set of assignments with
   * no warning and no error.
   *
   * So server data becomes the new base, and the dispatcher's own edits are
   * replayed on top. Their pending change wins over a concurrent one; the
   * save's conflict detection is what adjudicates that, not a silent
   * overwrite here.
   */
  useEffect(() => {
    setDraft((current) => {
      const next = new Map(initial);
      for (const truckId of edited.current) {
        // A truck that has left the board cannot be rebased onto it.
        if (next.has(truckId) && current.has(truckId)) {
          next.set(truckId, current.get(truckId) ?? null);
        }
      }
      return next;
    });
  }, [initial]);

  /** Every local edit goes through here, so the rebase knows what to keep. */
  const editDraft = useCallback((truckId: string, driverId: string | null) => {
    edited.current.add(truckId);
    setDraft((d) => new Map(d).set(truckId, driverId));
  }, []);

  /** After a save or a discard, the server IS the truth again. */
  const clearEdits = useCallback(() => {
    edited.current = new Set();
  }, []);

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
      // Saved, so the server is the truth again and the rebase has nothing
      // to preserve.
      clearEdits();
      router.refresh();
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : 'The save failed.');
    } finally {
      setSaving(false);
    }
  }, [changed, draft, router, clearEdits]);

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
  const canRetire = can(role, 'admin');

  /**
   * §12.37. Never a delete — `assignments.driver_id` is ON DELETE RESTRICT and
   * the history is the record of who drove what. Confirmed first, because it
   * is the one control here that removes something from the board.
   */
  const retire = async (driverId: string, name: string) => {
    if (!window.confirm(`Retire ${name}? Their assignment history is kept.`)) return;
    const response = await fetch('/api/drivers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'retire', driverId, retired: true }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      window.alert(body.error ?? 'That driver could not be retired.');
      return;
    }
    router.refresh();
  };
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
          {/* §12.37: above the board, where a dispatcher is already thinking
              about who is on what. Renders nothing when there is nothing to
              ask. */}
          <MergePrompt role={role} />
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
                  onChange={(driverId) => editDraft(truck.id, driverId)}
                  /**
                   * §12.37: the board refreshes BEFORE the select points at
                   * the new driver, so `board.drivers` already contains them.
                   * Only passed where a refresh is possible — a picker that
                   * offered "+ Add driver" and then could not show the result
                   * would look broken.
                   */
                  /**
                   * §12.38: only when the truck is EMPTY. An occupied truck
                   * makes this a reassignment, which has a two-sided confirm
                   * and a preview token — so the driver is created, selected
                   * here, and the existing confirm takes over on Save. The
                   * dispatcher learns no new path.
                   */
                  assignToTruckId={truck.driverId === null ? truck.id : null}
                  onDriverCreated={(_driverId, _name, assignedTruckId) => {
                    // Assigned server-side, so pull the new truth in. The
                    // draft rebases rather than resetting, so the selection
                    // and every other pending edit survive.
                    if (assignedTruckId !== null) clearEdits();
                    router.refresh();
                  }}
                />
                <span className="truncate text-body text-text-muted">
                  <DriverName
                    name={truck.driverName}
                    source={truck.driverSource}
                    samsaraDriverId={truck.driverSamsaraId}
                    fallback="Unassigned"
                  />
                </span>
              </div>
            );
          })}
        </section>

        <aside className="w-[260px] shrink-0 space-y-5">
          <Panel
            title={`Drivers with no truck (${driversWithoutTruck.length})`}
            empty="Every active driver has a truck."
            items={driversWithoutTruck.map((d) => ({
              key: d.id,
              node: (
                <span className="flex items-baseline justify-between gap-2">
                  <DriverName
                    name={d.name}
                    source={d.source}
                    samsaraDriverId={d.samsaraDriverId}
                  />
                  {/**
                   * §12.37: ADMIN only — it takes someone off the board.
                   * Offered only for a driver with no truck, because retiring
                   * one that is assigned is refused server-side anyway and a
                   * control that always errors is worse than no control.
                   */}
                  {canRetire ? (
                    <button
                      type="button"
                      onClick={() => void retire(d.id, d.name)}
                      title={`Retire ${d.name} — keeps their history, removes them from the board.`}
                      className="shrink-0 font-cond text-micro uppercase tracking-[.08em] text-text-muted hover:text-status-late-fg"
                    >
                      Retire
                    </button>
                  ) : null}
                </span>
              ),
            }))}
          />
          <Panel
            title={`Trucks with no driver (${trucksWithoutDriver.length})`}
            empty="Every active truck has a driver."
            items={trucksWithoutDriver.map((t) => ({ key: t.id, node: label(t) }))}
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
                clearEdits();
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
  /**
   * Nodes, not strings — the drivers panel renders a name plus its `No ELD`
   * tag (§12.37), and a string list could only have shown the name.
   */
  items: { key: string; node: React.ReactNode }[];
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
            <li key={item.key} className="truncate text-body text-text-secondary">
              {item.node}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
