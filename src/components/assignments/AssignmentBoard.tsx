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
import { DriverPhone } from './DriverPhone';
import { ND_FOCUS } from './nightDesk';

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

/**
 * The table's columns, shared by its header and every row (§12.131, §12.135).
 *
 * Truck, driver, the driver's phone, Currently. The phone sits beside the
 * driver it belongs to (§12.106: the number is the picker's driver's): with
 * Currently between them, empty on every row at rest (§12.130), the eye
 * crossed 240px of nothing from a name to its number. Currently is last and
 * takes the slack. Minimums unchanged: 64 + 240 + 220 + 150 = 674. The phone
 * keeps 220px for its inline editor (field, Save, Cancel).
 *
 * 3al settled the widths on screen: a flexible picker ran 845px wide at
 * 1920, so it is capped at 360; and from 1100px up the whole table is capped
 * (the section's `max-w`, §12.136: 940px) so its rows stop where their
 * content does.
 */
const COLUMNS = 'grid-cols-[64px_minmax(240px,360px)_minmax(220px,260px)_minmax(150px,1fr)]';

/**
 * §12.136. The gaps and the side padding inside the rows' card, shared by the
 * header row (which sits outside the card, so 1px more) and every row.
 *
 * Tighter below 1024px so the board still closes at 768: 674 + 3 × 12 gaps +
 * 2 × 6 padding + 2 × 1 border = 724, inside 768 − 2 × 20 = 728. From 1024
 * up, 16px gaps and 16px padding, as the mockup.
 */
const ROW_GAPS = 'gap-x-3 px-1.5 lg:gap-x-4 lg:px-4';
const HEAD_GAPS = 'gap-x-3 px-[7px] lg:gap-x-4 lg:px-[17px]';

/**
 * §12.136. One column for the header, the board and the footer, so they share
 * one left and one right edge, centred from 1100px up: the 940px board, a
 * 24px gap, the 260px panels and 32px each side = 1288.
 */
const FRAME = 'mx-auto w-full max-w-[1288px] px-5 lg:px-8';

/** "124 and 130", "124, 130 and 138". */
function listed(labels: string[]): string {
  return labels.length < 2
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

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

  /**
   * The same rule the server enforces, run early so Save can refuse first.
   * Grouped by driver, so the footer can say WHICH trucks share one: "a
   * driver is on two trucks" sent the dispatcher hunting down 22 rows.
   */
  const doubleBookedGroups = useMemo(() => {
    const byDriver = new Map<string, Board['trucks']>();
    for (const truck of board.trucks) {
      const driverId = draft.get(truck.id) ?? null;
      if (!driverId) continue;
      byDriver.set(driverId, [...(byDriver.get(driverId) ?? []), truck]);
    }
    return [...byDriver.values()].filter((trucks) => trucks.length > 1);
  }, [board.trucks, draft]);
  const doubleBooked = useMemo(
    () => new Set(doubleBookedGroups.flat().map((t) => t.id)),
    [doubleBookedGroups],
  );

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
  const driversById = useMemo(
    () => new Map(board.drivers.map((d) => [d.id, d])),
    [board.drivers],
  );
  const phoneLockedReason = `Your role is ${role}. Phone numbers need dispatcher.`;
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
    /**
     * §12.131. The window's height, not at least it: the header and the
     * footer stay put and only the board between them scrolls. It was
     * `min-h-dvh`, so the page itself scrolled and Save, Discard and the
     * count of changes sat under the last of 22 rows.
     */
    /**
     * §12.136. The page's own look, Night desk (HANDOFF 3an): its ground, its
     * face (Public Sans, loaded by this route's layout), its ink. Nothing
     * outside this page uses these tokens.
     */
    <main className="flex h-dvh flex-col bg-nightDesk-ground font-nightDesk text-nightDesk-body text-nightDesk-ink">
      {/*
        §12.106. Assignments are a desktop job (§12.94), and this page has no
        phone layout: nothing on the phone view links here, and an address
        typed on a phone gets this instead of a board it cannot use. CSS, not
        a width read, so the server's first paint is already the right one.
      */}
      <div
        data-assignments-desktop-only=""
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center md:hidden"
      >
        <p className="text-nightDesk-body text-nightDesk-ink">Assignments are on the desktop console.</p>
        <Link
          href="/"
          className={`inline-flex h-11 items-center rounded-full border border-nightDesk-control px-5 font-medium text-nightDesk-ink ${ND_FOCUS}`}
        >
          Back to the board
        </Link>
      </div>
      <header className="shrink-0 border-b border-nightDesk-border max-md:hidden">
        <div className={`${FRAME} flex min-h-16 items-center justify-between gap-6`}>
          <div className="flex min-w-0 items-baseline gap-4">
            <h1 className="text-nightDesk-title font-semibold text-nightDesk-ink">Assignments</h1>
            <span className="text-nightDesk-body text-nightDesk-muted">
              {board.trucks.length} active trucks · {board.drivers.length} active drivers
            </span>
          </div>
          <Link
            href="/"
            className={`inline-flex h-8 shrink-0 items-center rounded-full border border-nightDesk-control px-4 font-medium text-nightDesk-inkSecondary hover:border-nightDesk-controlHover hover:text-nightDesk-ink ${ND_FOCUS}`}
          >
            Back to console
          </Link>
        </div>
      </header>

      {/*
        No top padding here: a sticky child sticks inside the scroll region's
        padding, so with `p-5` a scrolled row showed through the 20px above
        the column headers. The 20px is the sticky things' own `pt-5` instead.

        §12.132. Below 1100px the two panels sit above the table, side by side,
        instead of beside it. The four columns need 722px at their minimums,
        and beside the 260px aside that leaves nothing for the picker under
        about 1042px; at 1100 it gets about 270px. The DOM order (table, then
        panels) is kept, so the keyboard reaches the pickers first.

        The region scrolls at the window's full width (its scrollbar at the
        window's edge); its content is the centred FRAME (§12.136).
      */}
      <div className="min-h-0 flex-1 overflow-auto max-md:hidden">
        <div
          className={`${FRAME} flex flex-col pb-8 min-[1100px]:flex-row min-[1100px]:items-start min-[1100px]:gap-6`}
        >
          {/*
            §12.135, §12.136. From 1100px up the table stops at 940px and the
            panels follow it, the two centred together. At 1000px Currently,
            empty on every unchanged row (§12.130), left a band about 270px wide;
            at 940 it is about 174.
          */}
          <section className="min-w-0 min-[1100px]:max-w-[940px] min-[1100px]:flex-1">
            {/* §12.37: above the board, where a dispatcher is already thinking
                about who is on what. Renders nothing when there is nothing to
                ask. */}
            <div className="pt-6 empty:hidden">
              <MergePrompt role={role} />
            </div>
            {/* Sticky, so a dispatcher 15 rows down still knows which name is the picker's. */}
            <div
              className={`sticky top-0 z-10 grid ${COLUMNS} ${HEAD_GAPS} items-center bg-nightDesk-ground pb-2 pt-6 text-nightDesk-small text-nightDesk-muted`}
            >
              <span>Truck</span>
              {/* Over the name, not the field's edge: at rest the field has no box (§12.134). */}
              <span className="pl-[9px]">Driver</span>
              <span>Driver&rsquo;s phone</span>
              <span>Currently</span>
            </div>

            {/* §12.136. The rows on one card, darker than the ground. */}
            <div className="rounded-nightDesk border border-nightDesk-border bg-nightDesk-surface">
              {board.trucks.map((truck) => {
                const value = draft.get(truck.id) ?? null;
                const isChanged = value !== truck.driverId;
                const isConflicted = conflictedTrucks.has(truck.id);
                /** §12.106. The phone of the driver in the picker — the number is theirs, not the truck's. */
                const driver = value === null ? null : (driversById.get(value) ?? null);
                return (
                  <div
                    key={truck.id}
                    /**
                     * §12.136. Night desk's 42px row, at least: a row with the
                     * phone editor open grows to fit it.
                     *
                     * A changed row is one step lighter with a 1px accent line on
                     * its left edge (Night desk marks every selection with that
                     * line); a double-booked one is on the negative ground with the
                     * line in the negative. An empty truck needs no ground of its
                     * own: its field is the dashed empty slot.
                     */
                    className={`relative grid ${COLUMNS} ${ROW_GAPS} min-h-row-nightDesk items-center border-t border-nightDesk-rule py-1 first:rounded-t-nightDesk first:border-t-0 last:rounded-b-nightDesk ${
                      isConflicted
                        ? 'bg-nightDesk-negativeBg before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-nightDesk-negative'
                        : isChanged
                          ? 'bg-nightDesk-raised before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-nightDesk-accent'
                          : 'hover:bg-nightDesk-rowHover'
                    }`}
                  >
                    {/* A truck with no number shows its Samsara name, which can be long. */}
                    <span
                      title={label(truck)}
                      className={`truncate font-nightDesk-mono text-nightDesk-data font-medium ${
                        isConflicted
                          ? 'text-nightDesk-negative'
                          : value === null
                            ? 'text-nightDesk-muted'
                            : 'text-nightDesk-ink'
                      }`}
                    >
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
                      quiet
                      size="row"
                      look="nightDesk"
                      /**
                       * §12.37: the board refreshes BEFORE the select points at
                       * the new driver, so `board.drivers` already contains them.
                       * Only passed where a refresh is possible — a picker that
                       * offered "+ Add driver" and then could not show the result
                       * would look broken.
                       */
                      /**
                       * §12.38: only when the truck is EMPTY. On an occupied
                       * truck the driver is only created and selected here; the
                       * change of driver is then a row in this board's draft like
                       * any other, and goes out with Save in the batch. There is
                       * no two-sided confirm on this screen: the board's batch
                       * save is its own confirmation (HANDOFF 3ai, answered
                       * 2026-10-19). §9.10's confirm and its preview token are
                       * the edit modal's.
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
                    {driver ? (
                      <DriverPhone
                        key={driver.id}
                        driverId={driver.id}
                        driverName={driver.name}
                        phone={driver.phone}
                        mayEdit={mayEdit}
                        lockedReason={phoneLockedReason}
                        onSaved={() => router.refresh()}
                      />
                    ) : (
                      <span />
                    )}
                    {/**
                     * §12.130. Only on a row changed in the draft: what the truck
                     * had before, struck through, as §9.10 writes the losing side
                     * — including its "—" for a truck that had nobody. On an
                     * unchanged row this repeated the picker's name, so every
                     * assigned row said one name twice, and an empty truck said
                     * "Unassigned" twice (§12.18). The row's No ELD tag is beside
                     * the picker now (§12.37's table), so nothing is lost.
                     */}
                    {isChanged ? (
                      <span
                        data-was=""
                        className="flex min-w-0 items-center gap-1.5 text-nightDesk-muted"
                      >
                        <span className="shrink-0">was</span>
                        {/* §12.133: the name struck, not its No ELD tag. The name
                            truncates first, so the tag is never the part cut off. */}
                        <DriverName
                          name={truck.driverName}
                          source={truck.driverSource}
                          samsaraDriverId={truck.driverSamsaraId}
                          fallback="—"
                          struck
                          look="nightDesk"
                          className="text-nightDesk-inkSecondary"
                        />
                      </span>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Beside the table, sticky: the gaps stay in view while the board scrolls past them. */}
          <aside className="order-first grid grid-cols-2 gap-6 pt-6 min-[1100px]:sticky min-[1100px]:top-0 min-[1100px]:order-none min-[1100px]:block min-[1100px]:w-[260px] min-[1100px]:shrink-0 min-[1100px]:space-y-6 min-[1100px]:self-start">
            <Panel
              title={`Drivers with no truck (${driversWithoutTruck.length})`}
              empty="Every active driver has a truck."
              items={driversWithoutTruck.map((d) => ({
                key: d.id,
                node: (
                  /**
                   * §12.132. Below 1100px the panel is about 480px wide, so the
                   * entry is one line: name, phone, Retire. It was two lines
                   * there too, which made this panel the taller of the two and
                   * left a 50px hole under the trucks panel stretched beside it.
                   *
                   * From 1100 up, in the 260px column, the name has the whole
                   * first line and Retire sits beside the phone under it
                   * (§12.136, Alex 2026-10-21): beside Retire, a name of normal
                   * length and its tag did not fit and the name was cut off. A
                   * truly long one still truncates, whole in its title.
                   */
                  <span
                    data-free-driver=""
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 min-[1100px]:grid-cols-[minmax(0,1fr)_auto] min-[1100px]:gap-y-0.5"
                  >
                    <DriverName
                      name={d.name}
                      source={d.source}
                      samsaraDriverId={d.samsaraDriverId}
                      look="nightDesk"
                      className="col-start-1 row-start-1 font-medium text-nightDesk-ink min-[1100px]:col-span-2"
                    />
                    <span className="col-start-2 row-start-1 min-w-0 min-[1100px]:col-start-1 min-[1100px]:row-start-2">
                      <DriverPhone
                        driverId={d.id}
                        driverName={d.name}
                        phone={d.phone}
                        mayEdit={mayEdit}
                        lockedReason={phoneLockedReason}
                        onSaved={() => router.refresh()}
                      />
                    </span>
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
                        className={`col-start-3 row-start-1 -mr-1.5 inline-flex h-7 shrink-0 items-center rounded-md px-1.5 text-nightDesk-small text-nightDesk-muted hover:text-nightDesk-negative min-[1100px]:col-start-2 min-[1100px]:row-start-2 ${ND_FOCUS}`}
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
              inline
            />
          </aside>
        </div>
      </div>

      <footer className="shrink-0 border-t border-line-hair bg-surface-bar px-5 py-3 max-md:hidden">
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
          {/* While rows are changed, this is the sentence that matters: primary ink. */}
          <span className={`text-body ${dirty ? 'text-text' : 'text-text-secondary'}`}>
            {dirty
              ? `${changed.length} row${changed.length === 1 ? '' : 's'} changed${doubleBookedGroups
                  .map((trucks) => ` · a driver is on trucks ${listed(trucks.map(label))}`)
                  .join('')}`
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
  inline = false,
}: {
  title: string;
  /**
   * Nodes, not strings — the drivers panel renders a name plus its `No ELD`
   * tag (§12.37), and a string list could only have shown the name.
   */
  items: { key: string; node: React.ReactNode }[];
  empty: string;
  /**
   * One wrapping line instead of one item per line: the truck numbers, which
   * stacked five tall in a 260px box (§12.132).
   */
  inline?: boolean;
}) {
  return (
    <div className="rounded-nightDesk border border-nightDesk-border bg-nightDesk-surface p-4">
      <h2 className="mb-2.5 text-nightDesk-data font-semibold text-nightDesk-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="text-nightDesk-body text-nightDesk-muted">{empty}</p>
      ) : (
        <ul className={inline ? 'flex flex-wrap gap-x-4 gap-y-1' : 'space-y-1.5'}>
          {items.map((item) => (
            /**
             * Not `truncate`: its `nowrap` reached the phone editor inside the
             * drivers panel, so "Blank clears the number." and a refusal could
             * not wrap in 236px and were cut. The name truncates on its own.
             */
            <li
              key={item.key}
              /**
               * §12.136. The no-driver trucks are truck numbers, so Plex Mono,
               * at the size that makes them the panel's answer.
               */
              className={
                inline
                  ? 'whitespace-nowrap font-nightDesk-mono text-nightDesk-gap font-medium text-nightDesk-ink'
                  : 'min-w-0 text-nightDesk-body text-nightDesk-inkSecondary'
              }
            >
              {item.node}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
