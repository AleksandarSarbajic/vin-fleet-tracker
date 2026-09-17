'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LOAD_STATUSES, LOAD_STATUS_LABEL } from '@/lib/loads';
import { can, type Role } from '@/lib/roles';
import { StopEdit, dirtyFields } from '@/lib/stop-edit';
import type { FleetRow } from '@/server/fleet-query';
import type { BoardDriver } from '@/server/assignments';
import type { ReassignPreview } from '@/server/reassign';
import type { FleetResponse } from '@/hooks/useFleet';
import { DriverSelect } from '@/components/assignments/DriverSelect';
import { OVERRIDE_REASON_LABEL, OverrideInput } from '@/lib/override';
import { OverrideBlock, type OverrideDraft } from './OverrideBlock';
import {
  AppointmentFields,
  FCFS_DEFAULT_EARLIEST,
  FCFS_DEFAULT_LATEST,
  zoneForState,
  type AppointmentDraft,
} from './AppointmentFields';
import { ReassignConfirm } from './ReassignConfirm';
import { useFocusTrap } from './useModalChrome';

/**
 * design-spec §9.9. One modal covers editing a stop and entering the truck's
 * first load: a dispatcher doing either is doing the same thing with
 * different starting data, and a second creation flow would be a second place
 * for the appointment path to go wrong.
 *
 * TODO(phase 5): the status override block (§9.5) belongs between the note
 * and the footer. It is deliberately absent, not forgotten — it renders the
 * COMPUTED status beside the forced one, and the engine that computes it
 * lands next phase. A block whose headline number is fabricated is worse than
 * no block.
 */

interface Props {
  row: FleetRow;
  drivers: BoardDriver[];
  role: Role;
  dispatchTz: string;
  onClose: () => void;
}

interface FieldError {
  field: string;
  message: string;
}

const isoDate = (utc: string | null, tz: string | null): string => {
  if (!utc || !tz) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(utc));
};

const isoTime = (utc: string | null, tz: string | null): string => {
  if (!utc || !tz) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(utc));
};

export function EditStopModal({ row, drivers, role, dispatchTz, onClose }: Props) {
  const queryClient = useQueryClient();
  const trap = useFocusTrap(true);
  const mayEdit = can(role, 'dispatcher');
  const mayFlipActive = can(role, 'admin');
  const lockedReason = `Your role is ${role}. Editing needs dispatcher.`;

  const stop = row.nextStop;

  /**
   * One form object, and the SAME function turns it into a StopEdit whether
   * it holds the values the modal opened with or the ones on screen now.
   *
   * The first version of this diffed the live edit against a hand-written
   * "before" object, and got it wrong: the appointment was missing from that
   * object, so every modal opened already dirty and the banner named fields
   * nobody had touched. A dirty banner that is always on is worse than none —
   * it trains people to ignore it.
   */
  const initialForm = useMemo(
    () => ({
      loadNumber: stop?.loadNumber ?? '',
      loadStatus: stop?.loadStatus ?? ('AVAILABLE' as (typeof LOAD_STATUSES)[number]),
      stopType: stop?.type ?? ('DEL' as 'PU' | 'DEL'),
      addressLine: stop?.addressLine ?? '',
      city: stop?.city ?? '',
      state: stop?.state ?? '',
      zip: stop?.zip ?? '',
      note: '',
      driverId: drivers.find((d) => d.truckId === row.id)?.id ?? null,
      appointment: {
        enabled: Boolean(stop?.apptStartUtc),
        type: stop?.apptType ?? ('APPT' as 'APPT' | 'FCFS'),
        date: isoDate(stop?.apptStartUtc ?? null, stop?.apptTz ?? null),
        time:
          isoTime(stop?.apptStartUtc ?? null, stop?.apptTz ?? null) ||
          (stop?.apptType === 'FCFS' ? FCFS_DEFAULT_EARLIEST : ''),
        // §12.22: receiving hours default to 07:00–15:00 on a new FCFS stop.
        endTime:
          isoTime(stop?.apptEndUtc ?? null, stop?.apptTz ?? null) || FCFS_DEFAULT_LATEST,
        tz: stop?.apptTz ?? zoneForState(stop?.state ?? null),
        windowMinutes: 30,
      } as AppointmentDraft,
    }),
    [drivers, row.id, stop],
  );

  const [form, setForm] = useState(initialForm);

  const [override, setOverride] = useState<OverrideDraft>(() => ({
    forced: row.override?.forcedStatus ?? 'AUTO',
    reason: row.override?.reason ?? '',
    reasonNote: row.override?.reasonNote ?? '',
    expiry: 'PLUS_4H',
    customDate: '',
    customTime: '',
  }));
  const set = <K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const [errors, setErrors] = useState<FieldError[]>([]);
  /**
   * §12.24. The save SUCCEEDED and something about it is worth knowing —
   * today, that the address could not be located so the stop has no ETA.
   *
   * Deliberately not an error: the dispatcher's work is saved and correct,
   * and colouring it red would send them looking for what they got wrong.
   * The modal stays open on a warning rather than closing over it, because a
   * banner nobody sees is the same as no banner.
   */
  const [saveWarnings, setSaveWarnings] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ReassignPreview | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const toEdit = useCallback(
    (f: typeof initialForm) => {
      const trimmed = (value: string) => (value.trim() === '' ? null : value.trim());
      const [y, m, d] = f.appointment.date.split('-').map(Number);
      const [h, min] = f.appointment.time.split(':').map(Number);
      const [endH, endMin] = f.appointment.endTime.split(':').map(Number);
      const hasAppointment =
        f.appointment.enabled &&
        [y, m, d, h, min].every((n) => n !== undefined && !Number.isNaN(n));
      const isFcfs = f.appointment.type === 'FCFS';

      return {
        stopId: stop?.stopId ?? null,
        truckId: row.id,
        loadNumber: f.loadNumber,
        loadStatus: f.loadStatus,
        stopType: f.stopType,
        addressLine: trimmed(f.addressLine),
        city: trimmed(f.city),
        state: trimmed(f.state),
        zip: trimmed(f.zip),
        // Wall time and a zone. Never an instant — the server converts (§7).
        appointment: hasAppointment
          ? {
              type: f.appointment.type,
              date: { y: y!, m: m!, d: d! },
              time: { h: h!, min: min! },
              tz: f.appointment.tz,
              windowMinutes: isFcfs ? null : f.appointment.windowMinutes,
              // FCFS carries the latest receiving hour as a typed wall time,
              // converted server-side exactly like the earliest one.
              endTime:
                isFcfs && endH !== undefined && !Number.isNaN(endH)
                  ? { h: endH, min: endMin ?? 0 }
                  : null,
            }
          : null,
        dispatcherNote: trimmed(f.note),
        driverId: f.driverId,
      };
    },
    [row.id, stop?.stopId],
  );

  const initialDriverId = initialForm.driverId;
  const driverId = form.driverId;
  const edit = useMemo(() => toEdit(form), [form, toEdit]);
  const initialEdit = useMemo(() => toEdit(initialForm), [initialForm, toEdit]);

  const parsed = StopEdit.safeParse(edit);
  const localErrors: FieldError[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  const allErrors = [...localErrors, ...errors];
  const errorFor = (field: string) => allErrors.find((e) => e.field === field)?.message;

  const dirty = useMemo(
    () => dirtyFields(initialEdit as StopEdit, edit as StopEdit),
    [edit, initialEdit],
  );

  const driverChanged = driverId !== initialDriverId;

  /**
   * The override travels as its own request to its own table — but Save owns
   * both, so §9.5's rule holds: Save is disabled while an override lacks a
   * reason, exactly as it is while a field is invalid.
   */
  const overrideChanged =
    override.forced !== (row.override?.forcedStatus ?? 'AUTO') ||
    (override.forced !== 'AUTO' && override.reason !== (row.override?.reason ?? ''));

  const overridePayload =
    override.forced === 'AUTO'
      ? null
      : OverrideInput.safeParse({
          stopId: stop?.stopId ?? '',
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
      ? overridePayload.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        }))
      : [];

  const canSave =
    mayEdit &&
    parsed.success &&
    overrideErrors.length === 0 &&
    (dirty.length > 0 || overrideChanged) &&
    !saving;

  /** Writes the override after the stop save. Its own table, its own route. */
  const sendOverride = useCallback(async (): Promise<boolean> => {
    if (!overrideChanged) return true;

    const response =
      override.forced === 'AUTO'
        ? await fetch('/api/overrides', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stopId: stop?.stopId }),
          })
        : await fetch('/api/overrides', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(overridePayload?.success ? overridePayload.data : null),
          });

    if (response.ok) return true;
    const body = (await response.json()) as { error?: string; fields?: FieldError[] };
    setErrors(body.fields?.length ? body.fields : [{ field: '*', message: body.error ?? 'The override failed.' }]);
    return false;
  }, [override.forced, overrideChanged, overridePayload, stop?.stopId]);

  /** `Clear now` from the block — immediate, not part of the save (§9.5). */
  const clearOverrideNow = useCallback(async () => {
    if (!stop) return;
    setSaving(true);
    try {
      await fetch('/api/overrides', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stopId: stop.stopId }),
      });
      setOverride((d) => ({ ...d, forced: 'AUTO', reason: '' }));
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
    } finally {
      setSaving(false);
    }
  }, [queryClient, stop]);

  /** POSTs the edit. `token` is the preview the dispatcher confirmed. */
  const send = useCallback(
    async (token?: string) => {
      if (!parsed.success) return;
      setSaving(true);
      setErrors([]);

      // Optimistic: patch the row in place, keep the snapshot to roll back to.
      const key = ['fleet'];
      const snapshot = queryClient.getQueryData<FleetResponse>(key);
      queryClient.setQueryData<FleetResponse>(key, (current) =>
        current
          ? {
              ...current,
              fleet: current.fleet.map((r) =>
                r.id === row.id && r.nextStop
                  ? {
                      ...r,
                      nextStop: {
                        ...r.nextStop,
                        loadNumber: edit.loadNumber,
                        addressLine: edit.addressLine,
                        city: edit.city,
                        state: edit.state,
                        zip: edit.zip,
                      },
                    }
                  : r,
              ),
            }
          : current,
      );

      try {
        const response = await fetch('/api/stops', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(token ? { ...parsed.data, previewToken: token } : parsed.data),
        });

        if (response.status === 409) {
          const body = (await response.json()) as { preview: ReassignPreview };
          // The world moved under the open dialog. Re-ask on the fresh view.
          queryClient.setQueryData(key, snapshot);
          setPreview(body.preview);
          return;
        }
        if (!response.ok) {
          const body = (await response.json()) as {
            error?: string;
            fields?: FieldError[];
            reference?: string;
          };
          queryClient.setQueryData(key, snapshot);
          setErrors(
            body.fields?.length
              ? body.fields
              : [{ field: '*', message: `${body.error ?? 'Save failed.'}${body.reference ? ` (${body.reference})` : ''}` }],
          );
          return;
        }

        const saved = (await response.json()) as { warnings?: FieldError[] };

        // The override is a second request to a second table. If it fails the
        // stop edit still stands and the field error says why, rather than the
        // whole save being rolled back on the client's behalf.
        if (!(await sendOverride())) return;

        await queryClient.invalidateQueries({ queryKey: key });

        if (saved.warnings?.length) {
          setSaveWarnings(saved.warnings);
          return;
        }
        onClose();
      } catch (error: unknown) {
        queryClient.setQueryData(key, snapshot);
        setErrors([
          { field: '*', message: error instanceof Error ? error.message : 'Save failed.' },
        ]);
      } finally {
        setSaving(false);
      }
    },
    [edit, onClose, parsed, queryClient, row.id, sendOverride],
  );

  /** A driver change is confirmed against the SERVER's preview first (§9.10). */
  const save = useCallback(async () => {
    if (!canSave) return;
    if (driverChanged) {
      const response = await fetch('/api/assignments/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ truckId: row.id, driverId }),
      });
      if (response.ok) {
        setPreview((await response.json()) as ReassignPreview);
        return;
      }
    }
    await send();
  }, [canSave, driverChanged, driverId, row.id, send]);

  /** Esc raises the discard confirm; it never closes silently (§9.9). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (preview) setPreview(null);
        else if (dirty.length > 0) setDiscarding(true);
        else onClose();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [dirty.length, onClose, preview, save]);

  const claimedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const driver of drivers) {
      if (driver.truckLabel) map.set(driver.id, driver.truckLabel);
    }
    return map;
  }, [drivers]);

  const truckName = row.truckNumber === null ? row.samsaraName : String(row.truckNumber);
  const currentDriverName = drivers.find((d) => d.id === initialDriverId)?.name ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 grid place-items-center bg-scrim p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit stop for truck ${truckName}`}
      >
        <div
          ref={trap}
          className="max-h-full w-[720px] max-w-full overflow-auto border border-line-hair bg-surface-overlay shadow-modal"
        >
          <div className="flex items-baseline justify-between border-b border-line-soft px-4 py-3">
            <div>
              <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
                {stop ? `Edit stop — truck ${truckName}` : `New load — truck ${truckName}`}
              </h2>
              <p className="mt-0.5 text-small text-text-muted">
                {stop
                  ? (stop.loadNumber ?? 'Load number not given yet')
                  : 'No load on this truck yet'}
                {currentDriverName ? ` · ${currentDriverName}` : ' · Unassigned'}
              </p>
            </div>
            <span className="font-cond text-micro uppercase tracking-[.09em] text-text-muted">
              Esc close
            </span>
          </div>

          {dirty.length > 0 ? (
            <p className="border-b border-status-risk-bd bg-status-risk-bg px-4 py-2 text-body text-text">
              Unsaved changes — {dirty.join(', ')}.
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

          <div className="p-4">
            {/* ---------------------------- assignment --------------------- */}
            <fieldset disabled={!mayEdit} className="border-0 p-0">
              <legend className="mb-2 flex w-full items-baseline justify-between border-b border-line-soft pb-1.5">
                <span className="font-cond text-micro uppercase tracking-[.11em] text-text-muted">
                  Assignment
                </span>
                <span className="font-cond text-micro uppercase tracking-[.09em] text-status-risk-fg">
                  Driver change requires confirm
                </span>
              </legend>

              <div className="grid grid-cols-[110px_1fr_150px] gap-3">
                <label className="block">
                  <span className="mb-1 block text-small text-text-secondary">Truck no.</span>
                  <p className="flex h-10 items-center font-sans text-data font-bold tabular-nums text-text">
                    {truckName}
                  </p>
                </label>
                <label className="block">
                  <span className="mb-1 block text-small text-text-secondary">
                    Assigned driver
                  </span>
                  <DriverSelect
                    drivers={drivers}
                    value={driverId}
                    /**
                     * Only when the truck has nobody. With a driver already
                     * assigned, the modal was opened to change something
                     * else — most often the appointment — and an open
                     * dropdown over the form is in the way.
                     */
                    autoFocus={initialDriverId === null}
                    claimedBy={claimedBy}
                    truckLabel={truckName}
                    disabled={!mayEdit || saving}
                    disabledReason={mayEdit ? undefined : lockedReason}
                    onChange={(id) => set('driverId', id)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-small text-text-secondary">Active</span>
                  <span
                    title={mayFlipActive ? undefined : 'Only an admin may change this.'}
                    className="flex h-10 items-center gap-2 text-body text-text-secondary"
                  >
                    <input type="checkbox" defaultChecked disabled={!mayFlipActive} />
                    On the console
                  </span>
                </label>
              </div>
              <p className="mt-1.5 text-small text-text-muted">
                {currentDriverName
                  ? `Current assignment: ${currentDriverName}.`
                  : 'No driver on this truck.'}{' '}
                Type a surname to search all {drivers.length} drivers.
              </p>
            </fieldset>

            {/* --------------------------- appointment --------------------- */}
            <AppointmentFields
              draft={form.appointment}
              onChange={(next) => set('appointment', next)}
              dispatchTz={dispatchTz}
              disabled={!mayEdit}
              initialFocus={initialDriverId !== null}
              error={errorFor('appointment.time')}
              endError={errorFor('appointment.endTime')}
            />

            {/* --------------------------- stop & load --------------------- */}
            <fieldset disabled={!mayEdit} className="mt-4 border-0 p-0">
              <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
                Stop &amp; load
              </legend>

              <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
                <Field
                  label="Street address"
                  value={form.addressLine}
                  onChange={(v) => set('addressLine', v)}
                />
                <Field label="ZIP" value={form.zip} onChange={(v) => set('zip', v)} />
                <label className="block">
                  <span className="mb-1 block text-small text-text-secondary">Stop type</span>
                  <select
                    value={form.stopType}
                    onChange={(e) => set('stopType', e.target.value as 'PU' | 'DEL')}
                    className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                  >
                    <option value="PU">Pick up</option>
                    <option value="DEL">Deliver</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 grid grid-cols-[1.6fr_1fr_1fr] gap-3">
                <Field label="City" value={form.city} onChange={(v) => set('city', v)} />
                <Field label="State" value={form.state} onChange={(v) => set('state', v)} placeholder="IL" />
                <label className="block">
                  <span className="mb-1 block text-small text-text-secondary">Load status</span>
                  <select
                    value={form.loadStatus}
                    onChange={(e) =>
                      set('loadStatus', e.target.value as (typeof LOAD_STATUSES)[number])
                    }
                    className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                  >
                    {LOAD_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {LOAD_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 grid grid-cols-[1.6fr_1fr_1fr] gap-3">
                {/* §12.21: no longer required. Broker paperwork does not
                    always carry a number when the load is entered. */}
                <Field
                  label="Load number"
                  value={form.loadNumber}
                  onChange={(v) => set('loadNumber', v)}
                  error={errorFor('loadNumber')}
                  help="Any format the broker uses, or leave it blank (§12.21)"
                />
              </div>
            </fieldset>

            {/* ------------------------------ note ------------------------- */}
            <fieldset disabled={!mayEdit} className="mt-4 border-0 p-0">
              <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
                Dispatcher note · visible to the next shift
              </legend>
              <textarea
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                className="h-14 w-full border border-line-hair bg-surface-sunken p-2 text-[13px] leading-[1.5] text-text"
              />
            </fieldset>

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
              disabled={!mayEdit || !stop}
              onClearNow={() => void clearOverrideNow()}
              errors={(field) =>
                overrideErrors.find((e) => e.field === field)?.message ??
                errors.find((e) => e.field === field)?.message
              }
            />

            {errorFor('*') ? (
              <p className="mt-3 border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg">
                {errorFor('*')}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-line-hair bg-surface-raised px-4 py-3">
            <span className="text-[11.5px] font-medium text-status-risk-fg">
              {driverChanged
                ? `Reassigns truck ${truckName} from ${currentDriverName ?? 'Unassigned'} to ${
                    drivers.find((d) => d.id === driverId)?.name ?? 'Unassigned'
                  }.`
                : ''}
            </span>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => (dirty.length > 0 ? setDiscarding(true) : onClose())}
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
          onConfirm={() => void send(preview.token)}
        />
      ) : null}

      {discarding ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-scrim p-6">
          <div className="w-[420px] border border-line-hair bg-surface-overlay p-4 shadow-modal">
            <h3 className="font-cond text-[15px] font-semibold uppercase tracking-[.06em] text-text">
              Discard changes?
            </h3>
            <p className="mt-1.5 text-body text-text-secondary">
              {dirty.join(', ')} would be lost.
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

function Field({
  label,
  value,
  onChange,
  help,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string | undefined;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-small text-text-secondary">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 w-full border bg-surface-sunken px-2.5 text-body text-text ${
          error ? 'border-status-late-fg' : 'border-line-hair'
        }`}
      />
      {/* Errors sit under their own field, never in a summary banner (§9.9). */}
      {error ? (
        <span className="mt-1 block text-small text-status-late-fg">{error}</span>
      ) : help ? (
        <span className="mt-1 block text-small text-text-muted">{help}</span>
      ) : null}
    </label>
  );
}
