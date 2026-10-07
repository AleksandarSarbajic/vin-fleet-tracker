'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { etaDetails } from '@/lib/eta-basis';
import { can, type Role } from '@/lib/roles';
import { loadEditFromStops } from '@/lib/load-edit';
import type { LoadForEdit } from '@/lib/load-read';
import type { StopEdit } from '@/lib/stop-edit';
import type { FleetRow } from '@/server/fleet-query';
import type { BoardDriver } from '@/server/assignments';
import type { ReassignPreview } from '@/server/reassign';
import type { FleetResponse } from '@/hooks/useFleet';
import { LOAD_READ_GC_MS, fetchLoadRead, loadReadKey } from '@/hooks/useLoadRead';
import { OVERRIDE_REASON_LABEL, StopOverrideEdit } from '@/lib/override';
import { OverrideBlock, type OverrideDraft } from './OverrideBlock';
import { normalizeAddress } from '@/lib/address';
import { ReassignConfirm } from './ReassignConfirm';
import { ClearStopConfirm } from './ClearStopConfirm';
import { RecentlyClosed } from './RecentlyClosed';
import { PreviousLoadQuestion } from './PreviousLoadQuestion';
import { ReachedStopQuestion } from './ReachedStopQuestion';
import type { ReachedAnswer } from '@/lib/reached-stop';
import { useTruckTimeline } from '@/hooks/useTruckTimeline';
import {
  clearStopTitle,
  closesFor,
  newLoadSubtitle,
  previousLoadLine,
  previousLoads,
  type ClearStatus,
  type SaveAnswer,
} from '@/lib/clear-stop';
import { useFocusTrap } from './useModalChrome';
import {
  addBlocked,
  addStop,
  deliveryBeforePickup,
  dirtyLabels,
  dirtyOf,
  loadFormFrom,
  localErrors,
  nextTripAllowed,
  reachedAsk as askFor,
  removeBlocked,
  removeStop,
  routeServerError,
  stopEditOf,
  stopFlags,
  stopName,
  stopsToSend,
  type FieldError,
  type LoadForm,
  type ReachedAsk,
  type StopForm as StopFormState,
} from './load-form';
import { LoadStrip } from './LoadStrip';
import { STOP_FORM_ID, StopList } from './StopList';
import { StopForm } from './StopForm';

/**
 * design-spec §9.9, §12.119. One modal covers editing a load and entering
 * the truck's first one: a dispatcher doing either is doing the same thing
 * with different starting data, and a second creation flow would be a second
 * place for the appointment path to go wrong.
 *
 * §12.119. It edits a LOAD: the load's own fields once, its stops in a list
 * beside the selected stop's form (tabs above it below 1008px). It opens on
 * the load read (`GET /api/loads/:id`) — fetched when the truck was
 * selected, so in hand by the time Edit load is clicked — and the version
 * that read carries. Both are frozen when the modal opens: the console polls
 * the board under it, and nothing a poll brings may change what the form
 * holds or the version its save is checked against (§12.117).
 */

interface Props {
  row: FleetRow;
  drivers: BoardDriver[];
  role: Role;
  dispatchTz: string;
  onClose: () => void;
  /**
   * §12.117. Opens the modal again on the board as it is now, after a save
   * was refused because the load changed. The typed values go with it — the
   * dispatcher asked for that by pressing Reload; nothing is merged.
   */
  onReload?: () => void;
}

const truckNameOf = (row: FleetRow) =>
  row.truckNumber === null ? row.samsaraName : String(row.truckNumber);

/**
 * The read, then the editor. The read's key is taken once, when the modal
 * opens; the read itself is kept from the first answer, and nothing after it
 * — a refetch, a poll's new key — replaces it.
 */
export function EditStopModal(props: Props) {
  const queryClient = useQueryClient();
  const [key] = useState(() => loadReadKey(props.row));
  const [loadId] = useState(() => props.row.nextStop?.loadId ?? null);
  const query = useQuery({
    queryKey: key ?? ['load', 'none'],
    queryFn: () => fetchLoadRead(loadId!),
    enabled: key !== null,
    staleTime: Infinity,
    gcTime: LOAD_READ_GC_MS,
    retry: 1,
  });
  const [read, setRead] = useState<LoadForEdit | null>(() =>
    key ? (queryClient.getQueryData<LoadForEdit>(key) ?? null) : null,
  );
  useEffect(() => {
    if (read === null && query.data) setRead(query.data);
  }, [query.data, read]);

  if (key !== null && read === null) {
    return (
      <ReadingPanel
        truckName={truckNameOf(props.row)}
        failed={query.isError ? (query.error as Error).message : null}
        onRetry={() => void query.refetch()}
        onClose={props.onClose}
      />
    );
  }
  return <LoadEditor {...props} read={read} />;
}

/** While the load is read — no time at all when the prefetch got there first. */
function ReadingPanel({
  truckName,
  failed,
  onRetry,
  onClose,
}: {
  truckName: string;
  failed: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
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
      className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-busy={failed === null}
      aria-label={`Edit load for truck ${truckName}`}
    >
      <div className="flex w-[960px] max-w-[calc(100vw-3rem)] flex-col border border-line-hair bg-surface-overlay shadow-modal">
        <div className="flex items-baseline justify-between border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            Edit load — truck {truckName}
          </h2>
          <span className="font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay">
            Esc close
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 py-6">
          {failed ? (
            <>
              <p role="alert" className="flex-1 text-body text-status-late-fg">
                {failed}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="h-8 shrink-0 border border-status-late-bd px-3 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg hover:bg-status-late-bg"
              >
                Retry
              </button>
            </>
          ) : (
            <p className="text-body text-text-secondary">Reading this load…</p>
          )}
        </div>
        <div className="flex justify-end border-t border-line-hair bg-surface-raised px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadEditor({
  row,
  drivers,
  role,
  dispatchTz,
  onClose,
  onReload,
  read,
}: Props & { read: LoadForEdit | null }) {
  const queryClient = useQueryClient();
  /**
   * §12.119. The opening focus stays the appointment date, as it was — when
   * the date is on the screen. At 720px tall it is below the fold, and a
   * native date input scrolls itself into view when focused, opening the
   * modal past the top of its load strip; the street address, at the top of
   * the stop's form, takes the focus instead.
   */
  const trap = useFocusTrap(true, (root, marked) => {
    const area = root.querySelector('[data-edit-scroll]');
    if (!marked || !area) return marked;
    const a = area.getBoundingClientRect();
    const m = marked.getBoundingClientRect();
    if (m.top >= a.top && m.bottom <= a.bottom) return marked;
    return root.querySelector<HTMLElement>('[role="tabpanel"] input[type="text"]') ?? marked;
  });
  const mayEdit = can(role, 'dispatcher');
  const mayFlipActive = can(role, 'admin');
  const lockedReason = `Your role is ${role}. Editing needs dispatcher.`;
  const truckName = truckNameOf(row);

  /**
   * Everything the form is measured against, taken ONCE as it opens. The row
   * is live — the console re-reads it every poll — and a "before" that moved
   * with it would make the form dirty, or clean, on its own.
   */
  const [openedAt] = useState(() => new Date().toISOString());
  const [nextKey] = useState(() => (read ? (row.nextStop?.stopId ?? null) : null));
  const [openedOverride] = useState(() => row.override);
  const [openedActive] = useState(() => row.active);
  const [initialDriverId] = useState(
    () => drivers.find((d) => d.truckId === row.id)?.id ?? null,
  );
  const [initialForm] = useState<LoadForm>(() => loadFormFrom(read, openedAt, initialDriverId));
  const [form, setForm] = useState<LoadForm>(initialForm);
  const [selected, setSelected] = useState(() =>
    Math.max(0, initialForm.stops.findIndex((s) => s.key === nextKey)),
  );

  /** §12.117. The version the form opened with; moved only by this modal's own Clear now. */
  const [version, setVersion] = useState(() => read?.version ?? null);
  /** §12.117. A save was refused because the load changed; Reload is offered. */
  const [stale, setStale] = useState(false);

  const [override, setOverride] = useState<OverrideDraft>(() => ({
    forced: row.override?.forcedStatus ?? 'AUTO',
    reason: row.override?.reason ?? '',
    reasonNote: row.override?.reasonNote ?? '',
    expiry: 'PLUS_4H',
    customDate: '',
    customTime: '',
  }));

  /**
   * §12.14's `trucks.active`. Its own state and its own request, not part of
   * the save: it is a different entity behind a different gate (`admin`),
   * and folding it in would make the whole save admin-only.
   */
  const [active, setActive] = useState(row.active);

  /** Errors the server answered with, routed to their stop. */
  const [errors, setErrors] = useState<FieldError[]>([]);
  /** §12.24. The save SUCCEEDED and something about it is worth knowing. */
  const [saveWarnings, setSaveWarnings] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ReassignPreview | null>(null);
  const [discarding, setDiscarding] = useState(false);
  /** §12.88. Clear stop's confirm step is open. */
  const [clearing, setClearing] = useState(false);
  /** §12.92. Opened from a previous-load line: that load comes preselected. */
  const [clearLoadId, setClearLoadId] = useState<string | null>(null);
  /** The stops the last request carried, in its order — a field error's `stops.<i>`. */
  const sentKeys = useRef<string[]>([]);

  const setStop = useCallback((index: number, patch: Partial<StopFormState>) => {
    setForm((f) => ({
      ...f,
      stops: f.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }, []);
  /**
   * §12.119 stage 4b. Add stop selects the new stop and puts the cursor in
   * its street address — once its form has mounted, so the key is held here
   * until then.
   */
  const [focusAddressOf, setFocusAddressOf] = useState<string | null>(null);
  const addOne = useCallback(() => {
    const added = addStop(form, openedAt);
    setForm(added.form);
    setSelected(added.form.stops.length - 1);
    setFocusAddressOf(added.key);
  }, [form, openedAt]);
  const removeOne = useCallback(
    (key: string) => {
      const index = form.stops.findIndex((s) => s.key === key);
      if (index === -1) return;
      setForm(removeStop(form, key));
      // The stop below takes its place; the last one's place is taken by the one above.
      setSelected(Math.min(index, form.stops.length - 2));
      setErrors((list) => list.filter((e) => e.stopKey !== key));
    },
    [form],
  );
  useEffect(() => {
    if (focusAddressOf === null) return;
    if (form.stops[selected]?.key !== focusAddressOf) return;
    document.getElementById(STOP_FORM_ID)?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    setFocusAddressOf(null);
  }, [focusAddressOf, form.stops, selected]);

  const selectKey = useCallback(
    (key: string) => {
      const index = form.stops.findIndex((s) => s.key === key);
      if (index !== -1) setSelected(index);
    },
    [form.stops],
  );

  /**
   * §12.92. No next stop, but open loads: every one of them is a PREVIOUS
   * load — open, every stop departed. Read fresh for the lines above the
   * form, the Clear stop tooltip and the save-time question.
   */
  const needsPrevious = !read && row.openLoadCount > 0;
  const timeline = useTruckTimeline(needsPrevious ? row.id : null, { fresh: true });
  const previous = needsPrevious && timeline.data ? previousLoads(timeline.data) : null;
  const previousReady = previous !== null && !timeline.isFetching;
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Record<string, SaveAnswer>>({});
  const [closes, setCloses] = useState<{ loadId: string; status: ClearStatus }[] | null>(
    null,
  );

  /** "Correction, or the next trip?" — open, and about which stop. */
  const [reachedAsk, setReachedAsk] = useState<ReachedAsk | null>(null);
  const [reachedAnswer, setReachedAnswer] = useState<ReachedAnswer | null>(null);

  /* ------------------------------ derived ------------------------------- */

  const dirty = useMemo(() => dirtyOf(initialForm, form, row.id), [form, initialForm, row.id]);
  const unsaved = useMemo(
    () => [
      ...dirtyLabels(dirty, form, initialForm),
      ...(active === openedActive ? [] : ['active flag']),
    ],
    [active, dirty, form, initialForm, openedActive],
  );

  const driverChanged = form.driverId !== initialDriverId;

  /**
   * The override travels inside the save, on the next stop (§12.28, D2) — but
   * Save owns it, so §9.5's rule holds: Save is disabled while an override
   * lacks a reason, exactly as while a field is invalid.
   */
  const overrideChanged =
    override.forced !== (openedOverride?.forcedStatus ?? 'AUTO') ||
    (override.forced !== 'AUTO' && override.reason !== (openedOverride?.reason ?? ''));

  const overridePayload =
    override.forced === 'AUTO'
      ? null
      : StopOverrideEdit.safeParse({
          action: 'set',
          forcedStatus: override.forced,
          reason: override.reason === '' ? undefined : override.reason,
          reasonNote: override.reasonNote.trim() === '' ? null : override.reasonNote,
          expiry: override.expiry,
          customExpiry:
            override.expiry === 'CUSTOM' && override.customDate && override.customTime
              ? {
                  date: {
                    y: Number(override.customDate.slice(0, 4)),
                    m: Number(override.customDate.slice(5, 7)),
                    d: Number(override.customDate.slice(8, 10)),
                  },
                  time: {
                    h: Number(override.customTime.slice(0, 2)),
                    min: Number(override.customTime.slice(3, 5)),
                  },
                  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }
              : null,
        });
  const overrideErrors: FieldError[] =
    overridePayload && !overridePayload.success
      ? overridePayload.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      : [];
  const overrideEdit: StopOverrideEdit | undefined = useMemo(
    () =>
      !overrideChanged
        ? undefined
        : override.forced === 'AUTO'
          ? { action: 'clear' }
          : overridePayload?.success
            ? overridePayload.data
            : undefined,
    [override.forced, overrideChanged, overridePayload],
  );

  /** §12.119. What the save would send, and whether it is ready to. */
  const send = useMemo(
    () => stopsToSend(form, dirty, nextKey, overrideChanged),
    [dirty, form, nextKey, overrideChanged],
  );
  const local = useMemo(() => localErrors(form, send, row.id), [form, row.id, send]);
  const parsed = local.parsed;
  const allErrors = useMemo(() => [...local.errors, ...errors], [errors, local.errors]);
  const errorFor = (field: string, stopKey?: string) =>
    allErrors.find((e) => e.field === field && e.stopKey === stopKey)?.message;
  const errorKeys = useMemo(
    () => new Set(allErrors.flatMap((e) => (e.stopKey ? [e.stopKey] : []))),
    [allErrors],
  );
  const stopsWithErrors = errorKeys.size;

  const canSave =
    mayEdit &&
    parsed !== null &&
    overrideErrors.length === 0 &&
    (unsaved.length > 0 || overrideChanged) &&
    !saving;

  const flags = form.stops.map((_, i) => stopFlags(form, i, nextKey));
  const current = form.stops[selected] ?? form.stops[0]!;
  const currentFlags = flags[selected] ?? flags[0]!;
  const initialCurrent = initialForm.stops.find((s) => s.key === current.key);

  /* ------------------------------- Clear now ---------------------------- */

  /**
   * `Clear now` from the block — immediate, not part of the save (§9.5). It
   * changes the load's version, so it carries the version this modal holds
   * and takes back the new one (§12.117).
   */
  const clearOverrideNow = useCallback(async () => {
    if (!nextKey) return;
    setSaving(true);
    try {
      const response = await fetch('/api/overrides', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stopId: nextKey, ...(version ? { version } : {}) }),
      });
      if (response.status === 409) {
        const body = (await response.json()) as { error?: string };
        setStale(true);
        setErrors([{ field: '*', message: body.error ?? 'This load was changed since you opened it.' }]);
        return;
      }
      if (response.ok) {
        const body = (await response.json()) as { loadVersion?: string };
        if (body.loadVersion) setVersion(body.loadVersion);
      }
      setOverride((d) => ({ ...d, forced: 'AUTO', reason: '' }));
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
    } finally {
      setSaving(false);
    }
  }, [nextKey, queryClient, version]);

  /* --------------------------------- send ------------------------------- */

  /** POSTs the edit. `token` is the preview the dispatcher confirmed. */
  const sendSave = useCallback(
    async (token?: string, closeList = closes, reached = reachedAnswer) => {
      if (!parsed) return;
      setSaving(true);
      setErrors([]);

      /**
       * Optimistic: patch the row in place, keep the snapshot to roll back to.
       * From the PARSED edit, never the form (§12.21): the cache must never
       * hold a shape the server cannot produce.
       */
      const key = ['fleet'];
      const snapshot = queryClient.getQueryData<FleetResponse>(key);
      const fallbackKey = (form.stops.find((s) => s.key === nextKey) ?? form.stops[0]!).key;
      const nextIndex = send.findIndex((s) => s.key === nextKey);
      const patch = nextIndex === -1 ? null : parsed[nextIndex]!;
      const loadNumber = parsed[0]!.loadNumber;
      queryClient.setQueryData<FleetResponse>(key, (cache) =>
        cache
          ? {
              ...cache,
              fleet: cache.fleet.map((r) =>
                r.id === row.id && r.nextStop
                  ? {
                      ...r,
                      nextStop: {
                        ...r.nextStop,
                        // Undefined means "leave it alone" on the wire, so it
                        // has to mean the same here (§12.23).
                        loadNumber: loadNumber === undefined ? r.nextStop.loadNumber : loadNumber,
                        ...(patch
                          ? {
                              addressLine: patch.addressLine,
                              city: patch.city,
                              state: patch.state,
                              zip: patch.zip,
                              dispatcherNote:
                                patch.dispatcherNote === undefined
                                  ? r.nextStop.dispatcherNote
                                  : patch.dispatcherNote,
                            }
                          : {}),
                      },
                    }
                  : r,
              ),
            }
          : cache,
      );

      const edits = parsed.map(
        (edit, i): StopEdit => ({
          ...edit,
          ...(token ? { previewToken: token } : {}),
          ...(overrideEdit && send[i]!.key === fallbackKey ? { override: overrideEdit } : {}),
          // §12.92: closed in the same transaction as the new load.
          ...(closeList?.length ? { closePrevious: closeList } : {}),
          ...(reached ? { reachedStop: reached } : {}),
        }),
      );
      sentKeys.current = send.map((s) => s.key);

      try {
        // One request: the stops, their appointments, the assignment and the
        // override are one act and land in one transaction (§12.28), checked
        // against the version this modal opened with (§12.117).
        const response = await fetch('/api/stops', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            loadEditFromStops(
              edits as [StopEdit, ...StopEdit[]],
              { loadId: read?.loadId ?? null, version: version ?? undefined },
              form.removed,
            ),
          ),
        });

        if (response.status === 409) {
          const body = (await response.json()) as {
            preview?: ReassignPreview;
            error?: string;
            closePrevious?: boolean;
            reachedStop?: { arrivedAt: string; stopId?: string; stopIndex?: number | null };
            stale?: boolean;
          };
          queryClient.setQueryData(key, snapshot);
          setReachedAnswer(null);
          if (body.stale) {
            /**
             * §12.117. Someone changed this load after the modal opened.
             * Nothing was written. What the dispatcher typed stays in the
             * form; Reload opens it again on the load as it is now.
             */
            setCloses(null);
            setStale(true);
            setErrors([{ field: '*', message: body.error ?? 'This load was changed since you opened it.' }]);
            return;
          }
          if (body.reachedStop) {
            // Reached after this modal opened. Nothing was written; ask about
            // THAT stop (§12.119), with the arrival the server holds.
            const asked = body.reachedStop;
            const stopKey =
              asked.stopId ??
              (asked.stopIndex !== undefined && asked.stopIndex !== null
                ? sentKeys.current[asked.stopIndex]
                : undefined) ??
              fallbackKey;
            selectKey(stopKey);
            setReachedAsk({ arrivedAt: asked.arrivedAt, stopKey });
            return;
          }
          if (body.closePrevious) {
            // §12.92. A previous load changed under the question. Nothing was
            // written; ask again on a fresh read.
            setCloses(null);
            setAnswers({});
            setErrors([
              { field: '*', message: body.error ?? 'A previous load changed. Nothing was saved.' },
            ]);
            await queryClient.invalidateQueries({ queryKey: ['timeline', row.id] });
            return;
          }
          // The world moved under the open dialog. Re-ask on the fresh view.
          if (body.preview) setPreview(body.preview);
          return;
        }
        if (!response.ok) {
          const body = (await response.json()) as {
            error?: string;
            fields?: FieldError[];
            reference?: string;
          };
          queryClient.setQueryData(key, snapshot);
          setCloses(null);
          setReachedAnswer(null);
          const routed = body.fields?.length
            ? body.fields.map((f) => routeServerError(f, sentKeys.current))
            : [{ field: '*', message: `${body.error ?? 'Save failed.'}${body.reference ? ` (${body.reference})` : ''}` }];
          setErrors(routed);
          // The form shows the stop the server named.
          const named = routed.find((e) => e.stopKey)?.stopKey;
          if (named) selectKey(named);
          return;
        }

        const saved = (await response.json()) as { warnings?: FieldError[] };

        /**
         * §12.14. A second request, deliberately, and only when the flag
         * moved — after the save, not before: a truck vanishing from the
         * console while its stop failed to save would be the worse half.
         */
        if (active !== openedActive) {
          const flipped = await fetch('/api/trucks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ truckId: row.id, active }),
          });
          if (!flipped.ok) {
            const body = (await flipped.json().catch(() => null)) as { error?: string } | null;
            await queryClient.invalidateQueries({ queryKey: key });
            // The stop IS saved. Saying otherwise would send the dispatcher
            // back to redo work that landed (§12.24's warning-not-error rule).
            setActive(openedActive);
            setSaveWarnings([
              {
                field: 'active',
                message: `The stop saved. The active flag did not: ${
                  body?.error ?? 'the change was refused.'
                }`,
              },
            ]);
            return;
          }
        }

        await queryClient.invalidateQueries({ queryKey: key });
        if (closeList?.length) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['fleet-health'] }),
            queryClient.invalidateQueries({ queryKey: ['timeline', row.id] }),
          ]);
        }

        if (saved.warnings?.length) {
          setSaveWarnings(
            saved.warnings.map((w) => {
              const routed = routeServerError(w, sentKeys.current);
              // On a load of several stops, the warning says which.
              return form.stops.length > 1 && routed.stopKey
                ? { ...routed, message: `${stopName(form, routed.stopKey)}: ${routed.message}` }
                : routed;
            }),
          );
          return;
        }
        onClose();
      } catch (error: unknown) {
        queryClient.setQueryData(key, snapshot);
        setCloses(null);
        setReachedAnswer(null);
        setErrors([
          { field: '*', message: error instanceof Error ? error.message : 'Save failed.' },
        ]);
      } finally {
        setSaving(false);
      }
    },
    [active, closes, form, nextKey, onClose, openedActive, overrideEdit, parsed, queryClient, reachedAnswer, read?.loadId, row.id, selectKey, send, version],
  );

  /** A driver change is confirmed against the SERVER's preview first (§9.10). */
  const save = useCallback(
    async (closeList?: { loadId: string; status: ClearStatus }[], reached?: ReachedAnswer) => {
      if (!canSave || !parsed) return;
      /**
       * The overwritten-trips fix: a reached stop given a new city — or a
       * reached load a new number — is asked about first, every time, by the
       * same rule the server enforces.
       */
      const given = reached ?? null;
      if (given === null) {
        const ask = askFor(read, send, parsed);
        if (ask) {
          selectKey(ask.stopKey);
          setReachedAsk(ask);
          return;
        }
      }
      setReachedAnswer(given);
      /**
       * §12.92. A new load on a truck still holding a previous one asks about
       * it first, every time. Never closed without the answer.
       */
      const answered = closeList ?? closes;
      if (needsPrevious && answered === null) {
        setAnswers({});
        setAsking(true);
        return;
      }
      setCloses(answered);
      if (driverChanged) {
        const response = await fetch('/api/assignments/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ truckId: row.id, driverId: form.driverId }),
        });
        if (response.ok) {
          setPreview((await response.json()) as ReassignPreview);
          return;
        }
      }
      await sendSave(undefined, answered, given);
    },
    [canSave, closes, driverChanged, form.driverId, needsPrevious, parsed, read, row.id, selectKey, send, sendSave],
  );

  /** One previous-load answer given; the last one saves. */
  const answer = useCallback(
    (loadId: string, given: SaveAnswer) => {
      const next = { ...answers, [loadId]: given };
      setAnswers(next);
      if (!previous || !previousReady) return;
      if (!previous.every((load) => next[load.loadId] !== undefined)) return;
      const forThese = Object.fromEntries(
        previous.map((load) => [load.loadId, next[load.loadId]!]),
      );
      setAsking(false);
      void save(closesFor(forThese));
    },
    [answers, previous, previousReady, save],
  );

  // Read fresh, and nothing is open any more (closed elsewhere): nothing to ask.
  useEffect(() => {
    if (asking && previousReady && previous.length === 0) {
      setAsking(false);
      void save([]);
    }
  }, [asking, previous, previousReady, save]);

  /** Esc raises the discard confirm; it never closes silently (§9.9). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // §12.88. A confirm step owns Enter and Esc while it is open.
      if (clearing || asking || reachedAsk) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (preview) setPreview(null);
        else if (unsaved.length > 0) setDiscarding(true);
        else onClose();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [asking, clearing, onClose, preview, reachedAsk, save, unsaved.length]);

  const claimedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const driver of drivers) {
      if (driver.truckLabel) map.set(driver.id, driver.truckLabel);
    }
    return map;
  }, [drivers]);

  /**
   * §12.88. Keyed off the COUNT, not off the read: a truck whose only open
   * load has every stop departed opens in its new-load state and still has a
   * load to close.
   */
  const canClear = mayEdit && row.openLoadCount > 0 && !saving;
  const clearTitle = !mayEdit
    ? lockedReason
    : row.openLoadCount === 0
      ? 'This truck has no open load to close.'
      : !read
        ? // §12.92: the form is empty, so the tooltip names the load.
          clearStopTitle(previous)
        : 'Close a finished load in one step.';
  const currentDriverName = drivers.find((d) => d.id === initialDriverId)?.name ?? null;

  const title = read ? `Edit load — truck ${truckName}` : `New load — truck ${truckName}`;
  const stopCount = `${form.stops.length} ${form.stops.length === 1 ? 'stop' : 'stops'}`;
  const nextIndex = form.stops.findIndex((s) => s.key === nextKey);
  const bannerError = errorFor('*');

  const editCurrent = stopEditOf(form, current, row.id);
  const editInitial = initialCurrent ? stopEditOf(initialForm, initialCurrent, row.id) : editCurrent;

  const footerNote = driverChanged
    ? `Reassigns truck ${truckName} from ${currentDriverName ?? 'Unassigned'} to ${
        drivers.find((d) => d.id === form.driverId)?.name ?? 'Unassigned'
      }.`
    : stopsWithErrors > 0
      ? `${stopsWithErrors} ${stopsWithErrors === 1 ? 'stop needs' : 'stops need'} attention before saving`
      : '';

  return (
    <>
      <div
        className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`${read ? 'Edit' : 'New'} load for truck ${truckName}`}
      >
        <div
          ref={trap}
          className="flex max-h-[calc(100dvh-3rem)] w-[960px] max-w-[calc(100vw-3rem)] flex-col border border-line-hair bg-surface-overlay shadow-modal"
        >
          {/* -------------------------- header, fixed ----------------------- */}
          <div className="flex flex-none items-baseline justify-between border-b border-line-soft px-4 py-3">
            <div>
              <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
                {title}
              </h2>
              <p className="mt-0.5 text-small text-text-mutedOnOverlay">
                {read
                  ? (read.loadNumber ?? 'Load number not given yet')
                  : // §12.92: the same count that enables Clear stop.
                    newLoadSubtitle(row.openLoadCount)}
                {currentDriverName ? ` · ${currentDriverName}` : ' · Unassigned'}
              </p>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-small text-text-mutedOnOverlay" data-stop-count="">
                {stopCount}
              </span>
              <span className="font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay">
                Esc close
              </span>
            </div>
          </div>

          {/* ------------------------- middle, scrolls ---------------------- */}
          <div data-edit-scroll="" className="min-h-0 flex-1 overflow-auto">
            {bannerError ? (
              <div className="flex items-center gap-3 border-b border-status-late-bd bg-status-late-bg px-4 py-2">
                <p role="alert" className="flex-1 text-body text-status-late-fg">
                  {bannerError}
                </p>
                {stale && onReload ? (
                  <button
                    type="button"
                    onClick={() => {
                      // The board as it is now, then the modal on it, read
                      // afresh. The typed values are discarded only here.
                      void queryClient.refetchQueries({ queryKey: ['fleet'] }).finally(() => {
                        if (read) queryClient.removeQueries({ queryKey: ['load', read.loadId] });
                        onReload();
                      });
                    }}
                    className="h-8 shrink-0 border border-status-late-bd px-3 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg hover:bg-status-late-bg"
                  >
                    Reload
                  </button>
                ) : null}
              </div>
            ) : null}

            {unsaved.length > 0 ? (
              <p className="border-b border-status-risk-bd bg-status-risk-bg px-4 py-2 text-body text-text">
                Unsaved changes — {unsaved.join(', ')}.
              </p>
            ) : null}

            {saveWarnings.length > 0 ? (
              <div className="border-b border-status-neutral-bd bg-status-neutral-bg px-4 py-2">
                <p className="font-cond text-micro uppercase tracking-[.09em] text-status-neutral-fg">
                  Saved · one thing to know
                </p>
                {saveWarnings.map((warning) => (
                  <p key={warning.field + warning.message} className="mt-0.5 text-body text-text">
                    {warning.message}
                  </p>
                ))}
              </div>
            ) : null}

            {/* ------------------------ previous loads -------------------- */}
            {needsPrevious ? (
              <div
                data-previous-loads=""
                className="space-y-2 border-b border-status-risk-bd bg-status-risk-bg px-4 py-2"
              >
                {timeline.isError ? (
                  <p role="alert" className="text-body text-status-late-fg">
                    This truck&apos;s open loads could not be read.
                  </p>
                ) : previous === null ? (
                  <p className="text-body text-text-secondary">
                    Reading this truck&apos;s open loads…
                  </p>
                ) : (
                  previous.map((load) => (
                    <div
                      key={load.loadId}
                      data-previous-load={load.loadId}
                      className="flex items-center gap-3"
                    >
                      <p className="flex-1 text-body text-text">
                        {previousLoadLine(load, dispatchTz, new Date(openedAt))}
                      </p>
                      <button
                        type="button"
                        disabled={!canClear}
                        title={mayEdit ? undefined : lockedReason}
                        onClick={() => {
                          setClearLoadId(load.loadId);
                          setClearing(true);
                        }}
                        className="h-8 shrink-0 border border-status-late-bd px-3 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg hover:bg-status-late-bg disabled:opacity-45"
                      >
                        Close load…
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <LoadStrip
              truckName={truckName}
              drivers={drivers}
              driverId={form.driverId}
              initialDriverId={initialDriverId}
              currentDriverName={currentDriverName}
              claimedBy={claimedBy}
              loadNumber={form.loadNumber}
              loadStatus={form.loadStatus}
              active={active}
              mayEdit={mayEdit}
              mayFlipActive={mayFlipActive}
              saving={saving}
              lockedReason={lockedReason}
              loadNumberError={errorFor('loadNumber')}
              onDriver={(id) => setForm((f) => ({ ...f, driverId: id }))}
              onDriverCreated={() => {
                // The picker holds the new driver itself until this lands.
                void queryClient.invalidateQueries({ queryKey: ['fleet'] });
              }}
              onLoadNumber={(value) => setForm((f) => ({ ...f, loadNumber: value }))}
              onLoadStatus={(value) => setForm((f) => ({ ...f, loadStatus: value }))}
              onActive={setActive}
            />

            <div className="min-[1008px]:grid min-[1008px]:grid-cols-[280px_1fr]">
              <StopList
                stops={form.stops}
                flags={flags}
                selected={selected}
                dirtyKeys={new Set(dirty.stops.keys())}
                errorKeys={errorKeys}
                onSelect={setSelected}
                mayEdit={mayEdit && !saving}
                addBlocked={mayEdit ? addBlocked(form) : lockedReason}
                onAdd={addOne}
              />
              <StopForm
                key={current.key}
                stop={current}
                index={selected}
                flags={currentFlags}
                mayEdit={mayEdit}
                loadExists={read !== null}
                dispatchTz={dispatchTz}
                storedWindow={initialCurrent?.appointment.windowMinutes}
                initialFocus={initialDriverId !== null}
                addressChanged={normalizeAddress(editCurrent) !== normalizeAddress(editInitial)}
                computed={read && currentFlags.next ? row.computed : null}
                basisDetails={read && currentFlags.next ? etaDetails(row) : []}
                overrideBlock={
                  (!read && selected === 0) || currentFlags.next ? (
                    <OverrideBlock
                      draft={override}
                      onChange={setOverride}
                      computed={row.computed}
                      live={
                        row.override
                          ? {
                              forcedStatus: row.override.forcedStatus,
                              reasonLabel: OVERRIDE_REASON_LABEL[row.override.reason],
                              setByName: row.override.setByName,
                              setAtUtc: row.override.setAtUtc,
                              expiresAtUtc: row.override.expiresAtUtc,
                            }
                          : null
                      }
                      disabled={!mayEdit || !read}
                      onClearNow={() => void clearOverrideNow()}
                      errors={(field) =>
                        overrideErrors.find((e) => e.field === field)?.message ??
                        errors.find((e) => e.field === field && !e.stopKey)?.message
                      }
                    />
                  ) : null
                }
                notNextNote={
                  read && !currentFlags.next && nextIndex !== -1
                    ? `A status override applies to the truck's next stop (stop ${nextIndex + 1}).`
                    : null
                }
                errorFor={(field) => errorFor(field, current.key)}
                onChange={(patch) => setStop(selected, patch)}
                removeBlocked={
                  mayEdit
                    ? removeBlocked(form, selected, dispatchTz)
                    : { text: lockedReason, reached: false }
                }
                onRemove={() => removeOne(current.key)}
                orderNote={deliveryBeforePickup(form, selected)}
              />
            </div>

            {/* §12.107. Drawn only when this truck closed a load in the last 7 days. */}
            <div className="px-4 pb-4">
              <RecentlyClosed
                truckId={row.id}
                truckName={truckName}
                dispatchTz={dispatchTz}
                mayEdit={mayEdit}
                lockedReason={lockedReason}
                onReopened={onClose}
              />
            </div>
          </div>

          {/* --------------------------- footer, fixed ---------------------- */}
          <div className="flex flex-none items-center justify-between gap-3 border-t border-line-hair bg-surface-raised px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* §12.88. Bottom-left, away from Save and Cancel. */}
              <button
                type="button"
                data-clear-stop
                disabled={!canClear}
                title={clearTitle}
                onClick={() => {
                  setClearLoadId(null);
                  setClearing(true);
                }}
                className="h-10 shrink-0 border border-status-late-bd px-4 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg hover:bg-status-late-bg disabled:opacity-45 disabled:hover:bg-transparent"
              >
                Clear stop
              </button>
              <span
                className={`text-[11.5px] font-medium ${
                  driverChanged ? 'text-status-risk-fg' : 'text-status-late-fg'
                }`}
              >
                {footerNote}
              </span>
            </div>
            <div className="flex shrink-0 gap-2.5">
              <button
                type="button"
                onClick={() => (unsaved.length > 0 ? setDiscarding(true) : onClose())}
                className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                title={mayEdit ? undefined : lockedReason}
                onClick={() => void save()}
                className="h-10 bg-accent px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover disabled:opacity-45"
              >
                {saving ? 'Saving…' : driverChanged ? 'Confirm reassign & save' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {preview ? (
        <ReassignConfirm
          preview={preview}
          busy={saving}
          onCancel={() => setPreview(null)}
          onConfirm={() => void sendSave(preview.token)}
        />
      ) : null}

      {clearing ? (
        <ClearStopConfirm
          truckId={row.id}
          truckName={truckName}
          dispatchTz={dispatchTz}
          unsaved={unsaved}
          initialLoadId={clearLoadId}
          onBack={() => setClearing(false)}
          onCleared={onClose}
        />
      ) : null}

      {asking ? (
        <PreviousLoadQuestion
          loads={previousReady ? previous : null}
          answers={answers}
          dispatchTz={dispatchTz}
          now={new Date(openedAt)}
          onAnswer={answer}
          onBack={() => setAsking(false)}
        />
      ) : null}

      {reachedAsk ? (
        <ReachedStopQuestion
          arrivedAt={reachedAsk.arrivedAt}
          loadNumber={read?.loadNumber ?? null}
          dispatchTz={dispatchTz}
          now={new Date()}
          stopName={form.stops.length > 1 ? stopName(form, reachedAsk.stopKey) : undefined}
          nextTrip={nextTripAllowed(read, send, reachedAsk.stopKey, form.removed)}
          onAnswer={(given) => {
            setReachedAsk(null);
            void save(undefined, given);
          }}
          onBack={() => setReachedAsk(null)}
        />
      ) : null}

      {discarding ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-scrim p-6">
          <div className="w-[420px] border border-line-hair bg-surface-overlay p-4 shadow-modal">
            <h3 className="font-cond text-[15px] font-semibold uppercase tracking-[.06em] text-text">
              Discard changes?
            </h3>
            <p className="mt-1.5 text-body text-text-secondary">
              {unsaved.join(', ')} would be lost.
            </p>
            <div className="mt-4 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDiscarding(false)}
                className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 border border-status-late-bd bg-status-late-bg px-4 font-cond text-micro uppercase tracking-[.09em] text-status-late-fg"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
