'use client';

import { useMemo, useState } from 'react';
import { WINDOW_OPTIONS, endsNextDay, fcfsEndDate, isIanaZone } from '@/lib/appointment';
import { ZONES } from '@/lib/geo/zone-by-state';
import { FCFS_DEFAULT_EARLIEST, FCFS_DEFAULT_LATEST, type AppointmentDraft } from './appointment-draft';
import {
  timeInZone,
  wallTimeInstant,
  windowEnd,
  windowLength,
  zoneAbbreviation,
} from '@/lib/format';
import { ownZone, stopDay, stopDayNote, type StopDayChoice } from '@/lib/stop-day';

/**
 * The appointment as written on the rate confirmation (§9.9).
 *
 * The stop-local time is the primary field, and the abbreviation shown beside
 * it is derived from the zone AND the date — never stored, never typed. The
 * derived line underneath carries both console clocks, read-only.
 *
 * Nothing here builds an instant. The three integers and the zone go to the
 * server exactly as typed; the server converts.
 */

/** The draft and its defaults live in `appointment-draft.ts` (phase 3bw), re-exported here. */
export {
  FCFS_DEFAULT_EARLIEST,
  FCFS_DEFAULT_LATEST,
  zoneForState,
  type AppointmentDraft,
} from './appointment-draft';

export function AppointmentFields({
  draft,
  onChange,
  storedWindow,
  dispatchTz,
  disabled,
  error,
  endError,
  dateError,
  zoneCheck,
  onConfirmZone,
  zoneSource,
  fillSource,
  fillCheck,
  initialFocus = false,
}: {
  draft: AppointmentDraft;
  onChange: (next: AppointmentDraft) => void;
  /**
   * §12.115. The window this stop was saved with. Offered even when it is not
   * one of the standard choices (a 45-minute window from a script, say), so
   * opening and saving the stop cannot quietly round it to something else.
   */
  storedWindow?: number | undefined;
  dispatchTz: string;
  disabled: boolean;
  error?: string | undefined;
  /** Field error for the FCFS latest hour. */
  endError?: string | undefined;
  /** §12.119. A ticked appointment with no date. */
  dateError?: string | undefined;
  /** §12.120. Why the zone is not settled; Save waits while it shows. */
  zoneCheck?: string | undefined;
  /** §12.120. "Zone is right". */
  onConfirmZone?: () => void;
  /** §12.121. Where the zone came from, when the address set it. */
  zoneSource?: string | null | undefined;
  /** §12.122. Where a fill got the appointment, and what to check about it. */
  fillSource?: string | undefined;
  fillCheck?: string | undefined;
  /** Takes the modal's opening focus when the truck already has a driver. */
  initialFocus?: boolean;
}) {
  const set = (patch: Partial<AppointmentDraft>) => onChange({ ...draft, ...patch });

  /**
   * §12.163, phase 3bw (QoL 4). Today and Tomorrow: the date at the stop, worked out at the
   * click from the stop's own zone (the one in the field below), never the dispatcher's. It goes
   * through `set` as a typed date does: a wall date, and the server converts. What the click
   * found is kept for its note, which shows only while the date is the one it wrote, so the
   * window looks the same at every hour until someone presses one.
   */
  const [picked, setPicked] = useState<{ date: string; zone: string; note: string | null } | null>(null);
  const pickDay = (which: StopDayChoice) => {
    if (!isIanaZone(draft.tz)) return;
    const now = new Date();
    const date = stopDay(now, draft.tz, which);
    setPicked({ date, zone: draft.tz, note: stopDayNote(now, draft.tz, ownZone()) });
    set({ date });
  };
  /**
   * On a new stop whose zone still follows the address (`auto`), a state or ZIP typed after the
   * click can move the zone. The date stays as written, as a typed date does; the note says
   * which zone it was worked out in, rather than claim the new one's.
   */
  const dayNote =
    picked && picked.date === draft.date
      ? picked.zone === draft.tz
        ? picked.note
        : `Worked out in ${picked.zone}. The zone is now ${draft.tz}: press Today or Tomorrow again for the date there.`
      : null;

  /**
   * The badge inside the time field, and the read-only "your clock" line.
   * Both are derived from an instant built ONLY for display — the value that
   * gets saved is the wall time itself.
   */
  const preview = useMemo(() => {
    const date = dateParts(draft.date);
    const time = timeParts(draft.time);
    if (!date || !time || !isIanaZone(draft.tz)) return null;

    // Display-only: good enough to name the abbreviation and show the two
    // clocks. The authoritative conversion happens on the server.
    const at = wallTimeInstant(date, time, draft.tz);
    const abbrev = zoneAbbreviation(at, draft.tz);
    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const clock = (zone: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(at);
    return {
      abbrev,
      dispatch: `${clock(dispatchTz)} ${zoneAbbreviation(at, dispatchTz)}`,
      viewer: `${clock(viewerZone)} ${zoneAbbreviation(at, viewerZone)}`,
    };
  }, [draft.date, draft.time, draft.tz, dispatchTz]);

  /**
   * §12.114. The FCFS latest hour, on the day it is actually on.
   *
   * Its abbreviation is the END's own — on the fall-back night a window opens
   * at 22:00 CDT and closes at 06:00 CST, and borrowing the start's would
   * print the wrong one beside the deadline. `nextDay` carries the line that
   * says so in words, with the length, because the length is what gives away
   * a transposed 15:00–07:00 that was meant as 07:00–15:00.
   */
  const end = useMemo(() => {
    if (draft.type !== 'FCFS') return null;
    const date = dateParts(draft.date);
    const time = timeParts(draft.time);
    const endTime = timeParts(draft.endTime);
    if (!date || !time || !endTime || !isIanaZone(draft.tz)) return null;

    const closes = wallTimeInstant(fcfsEndDate(date, time, endTime), endTime, draft.tz);
    const opens = wallTimeInstant(date, time, draft.tz);
    const minutes = Math.round((closes.getTime() - opens.getTime()) / 60_000);
    return {
      abbrev: zoneAbbreviation(closes, draft.tz),
      nextDay:
        endsNextDay(time, endTime) && minutes > 0
          ? `Ends next day · ${timeInZone(closes, draft.tz, { weekday: true })} · ${windowLength(minutes)}`
          : null,
    };
  }, [draft.type, draft.date, draft.time, draft.endTime, draft.tz]);

  /**
   * §12.115. What the window MEANS: the deadline, the time plus the window.
   * The choices used to read "±30 min" over a stored start-to-start+30, which
   * promised an early half that nothing stores or measures.
   */
  const deadline = useMemo(() => {
    if (draft.type !== 'APPT') return null;
    const date = dateParts(draft.date);
    const time = timeParts(draft.time);
    if (!date || !time || !isIanaZone(draft.tz)) return null;
    const opens = wallTimeInstant(date, time, draft.tz);
    const closes = new Date(opens.getTime() + draft.windowMinutes * 60_000);
    return `deadline ${windowEnd(opens.toISOString(), closes.toISOString(), draft.tz)}`;
  }, [draft.type, draft.date, draft.time, draft.tz, draft.windowMinutes]);

  const windowChoices = [
    ...new Set([
      ...WINDOW_OPTIONS,
      ...(storedWindow === undefined ? [] : [storedWindow]),
      // §12.122. A filled window (90 min, say) is offered as it is, not shown as another.
      draft.windowMinutes,
    ]),
  ].sort((a, b) => a - b);

  return (
    <fieldset disabled={disabled} className="mt-4 border-0 p-0">
      <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
        Appointment — as written on the rate confirmation
      </legend>

      {fillCheck || fillSource ? (
        <div data-appointment-fill="" className="mb-3 flex flex-col gap-1 border-l border-line-soft pl-3 text-small">
          {fillCheck ? (
            <p data-appointment-check="" className="text-status-risk-fg">
              {fillCheck}
            </p>
          ) : null}
          {fillSource ? (
            <p data-fill-source="appointment" className="break-words text-text-mutedOnOverlay">
              {fillSource}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-body text-text-secondary">
          <input
            type="checkbox"
            data-fill="appointment.enabled"
            checked={draft.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          This stop has an appointment
        </label>
        {draft.enabled ? (
          <div data-fill="appointment.type" className="ml-auto flex border border-line-hair">
            {(['APPT', 'FCFS'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() =>
                  // Switching to FCFS with an appointment time already typed
                  // would leave "earliest 14:30, latest 15:00", which reads
                  // like receiving hours and is not what anyone meant.
                  set(
                    type === 'FCFS'
                      ? {
                          type,
                          time: FCFS_DEFAULT_EARLIEST,
                          endTime: FCFS_DEFAULT_LATEST,
                        }
                      : { type },
                  )
                }
                className={`h-9 px-3 font-cond text-micro uppercase tracking-[.08em] ${
                  draft.type === type
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-overlay text-text-mutedOnOverlay'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {draft.enabled ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {/*
              §12.163. The two buttons sit beside the label, not inside it: a button inside a
              <label> is a labelable control, and the first one would take the label from the
              date input.
            */}
            <div className="relative">
              <label className="block">
                <span className="mb-1 block text-small text-text-secondary">
                  Date (stop-local)
                </span>
                <input
                  type="date"
                  data-fill="appointment.date"
                  data-initial-focus={initialFocus ? '' : undefined}
                  value={draft.date}
                  onChange={(e) => set({ date: e.target.value })}
                  className={`h-10 w-full border bg-surface-sunken px-2.5 text-body tabular-nums text-text ${
                    dateError ? 'border-status-late-fg' : 'border-line-hair'
                  }`}
                />
                {dateError ? (
                  <span role="alert" className="mt-1 block text-small text-status-late-fg">
                    {dateError}
                  </span>
                ) : null}
              </label>
              <span className="absolute right-0 top-0 flex items-baseline gap-2">
                {(['today', 'tomorrow'] as const).map((which) => (
                  <button
                    key={which}
                    type="button"
                    data-stop-day={which}
                    aria-label={`${which === 'today' ? 'Today' : 'Tomorrow'} at this stop`}
                    title={`The date ${which === 'today' ? 'today' : 'tomorrow'} at this stop, in its own zone`}
                    onClick={() => pickDay(which)}
                    className="font-cond text-micro font-semibold uppercase leading-none tracking-[.09em] text-accent hover:underline disabled:text-text-muted"
                  >
                    {which === 'today' ? 'Today' : 'Tomorrow'}
                  </button>
                ))}
              </span>
            </div>

            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">
                {draft.type === 'FCFS' ? 'Earliest receiving hour' : 'Time at the stop'}
              </span>
              <span className="relative block">
                <input
                  type="time"
                  data-fill="appointment.time"
                  value={draft.time}
                  onChange={(e) => set({ time: e.target.value })}
                  aria-describedby="appt-help"
                  className={`h-10 w-full border bg-surface-sunken px-2.5 pr-14 text-body tabular-nums text-text ${
                    error ? 'border-status-late-fg' : 'border-line-hair'
                  }`}
                />
                {/* Locked to the facility, computed from the zone and date. */}
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 border border-line-hair bg-surface-overlay px-1.5 py-0.5 font-cond text-[11px] uppercase tracking-[.09em] text-text-secondary">
                  {preview?.abbrev ?? '—'}
                </span>
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">
                {draft.type === 'FCFS' ? (
                  <>
                    Latest ·{' '}
                    <span className="text-status-risk-fg">this is the deadline</span>
                  </>
                ) : (
                  'Window'
                )}
              </span>
              {draft.type === 'FCFS' ? (
                <span className="relative block">
                  <input
                    type="time"
                    data-fill="appointment.endTime"
                    value={draft.endTime}
                    onChange={(e) => set({ endTime: e.target.value })}
                    aria-describedby="appt-help"
                    className={`h-10 w-full border bg-surface-sunken px-2.5 pr-14 text-body tabular-nums text-text ${
                      endError ? 'border-status-late-fg' : 'border-line-hair'
                    }`}
                  />
                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 border border-line-hair bg-surface-overlay px-1.5 py-0.5 font-cond text-[11px] uppercase tracking-[.09em] text-text-secondary">
                    {end?.abbrev ?? '—'}
                  </span>
                </span>
              ) : (
                <select
                  data-fill="appointment.windowMinutes"
                  value={draft.windowMinutes}
                  onChange={(e) => set({ windowMinutes: Number(e.target.value) })}
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                >
                  {windowChoices.map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Exact time' : `+${windowLength(m)}`}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>

          {dayNote ? (
            <p data-stop-day-note="" role="status" className="mt-1.5 text-small text-text-secondary">
              {dayNote}
            </p>
          ) : null}

          {deadline && !error ? (
            <p
              data-appt-deadline=""
              className="mt-1.5 text-right text-small tabular-nums text-text-secondary"
            >
              {deadline}
            </p>
          ) : null}

          {end?.nextDay && !endError ? (
            <p
              data-ends-next-day=""
              className="mt-1.5 text-right text-small font-medium tabular-nums text-text"
            >
              {end.nextDay}
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-3 gap-3">
            <label className="col-span-1 block">
              <span className="mb-1 block text-small text-text-secondary">
                Facility time zone
              </span>
              <select
                data-fill="tz"
                value={draft.tz}
                aria-describedby={zoneCheck ? 'zone-check' : undefined}
                onChange={(e) => set({ tz: e.target.value })}
                className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
              >
                {ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>

            <p
              id="appt-help"
              className="col-span-2 self-end pb-2 text-small tabular-nums text-text-secondary"
            >
              {preview
                ? `Your clock (read-only): ${preview.dispatch} · ${preview.viewer}`
                : 'Your clock (read-only): —'}
            </p>
          </div>

          {zoneSource && !zoneCheck ? (
            <p data-zone-source="" data-fill-source="zone" className="mt-1.5 text-small text-text-mutedOnOverlay">
              Zone: {zoneSource}
            </p>
          ) : null}

          {/* §12.120. A check, not a fault: the zone shown may be right. */}
          {zoneCheck ? (
            <div
              data-zone-check=""
              className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-2 border-status-risk-bd bg-status-risk-bg px-3 py-2"
            >
              <p id="zone-check" className="text-small text-status-risk-fg">
                {zoneCheck}
              </p>
              {onConfirmZone ? (
                <button
                  type="button"
                  onClick={onConfirmZone}
                  aria-describedby="zone-check"
                  className="h-[26px] border border-status-risk-bd px-2.5 font-cond text-micro font-semibold uppercase tracking-[.09em] text-status-risk-fg"
                >
                  Zone is right
                </button>
              ) : null}
            </div>
          ) : null}

          {error || endError ? (
            <p className="mt-2 text-small text-status-late-fg">{error ?? endError}</p>
          ) : (
            <p className="mt-2 text-small text-text-mutedOnOverlay">
              {draft.type === 'FCFS'
                ? 'Receiving hours, as the facility keeps them. A truck arriving after the latest hour is late for this stop.'
                : 'Typed as the facility reads it. The server converts to UTC — the zone above is what it converts from.'}
            </p>
          )}
        </>
      ) : (
        <p className="text-small text-text-mutedOnOverlay">
          No appointment. The truck reads <span className="text-status-neutral-fg">No appt</span>{' '}
          until one is entered.
        </p>
      )}
    </fieldset>
  );
}

/** `yyyy-mm-dd` from the date input, as integer parts, or null while incomplete. */
function dateParts(value: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = value.split('-').map(Number);
  if ([y, m, d].some((n) => n === undefined || Number.isNaN(n))) return null;
  return { y: y!, m: m!, d: d! };
}

/** `HH:mm` from a time input, as integer parts, or null while incomplete. */
function timeParts(value: string): { h: number; min: number } | null {
  const [h, min] = value.split(':').map(Number);
  if ([h, min].some((n) => n === undefined || Number.isNaN(n))) return null;
  return { h: h!, min: min! };
}
