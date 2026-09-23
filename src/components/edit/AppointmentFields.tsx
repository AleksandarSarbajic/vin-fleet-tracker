'use client';

import { useMemo } from 'react';
import { isIanaZone } from '@/lib/appointment';
import { zoneAbbreviation } from '@/lib/format';

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

export interface AppointmentDraft {
  enabled: boolean;
  type: 'APPT' | 'FCFS';
  /** yyyy-mm-dd, as the date input gives it. Split into parts on the wire. */
  date: string;
  /** HH:mm. The appointment (APPT), or the EARLIEST receiving hour (FCFS). */
  time: string;
  /** HH:mm. FCFS only: the LATEST receiving hour — the deadline (§12.22). */
  endTime: string;
  tz: string;
  windowMinutes: number;
}

/** §12.22. A new FCFS stop starts at the commonest receiving hours. */
export const FCFS_DEFAULT_EARLIEST = '07:00';
export const FCFS_DEFAULT_LATEST = '15:00';

/** A guess at the facility's zone from its state. Always overridable. */
const ZONE_BY_STATE: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  IA: 'America/Chicago', ID: 'America/Boise', IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', KS: 'America/Chicago', KY: 'America/New_York',
  LA: 'America/Chicago', MA: 'America/New_York', MD: 'America/New_York',
  ME: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MO: 'America/Chicago', MS: 'America/Chicago', MT: 'America/Denver',
  NC: 'America/New_York', ND: 'America/Chicago', NE: 'America/Chicago',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York',
  PR: 'America/Puerto_Rico', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VA: 'America/New_York', VT: 'America/New_York',
  WA: 'America/Los_Angeles', WI: 'America/Chicago', WV: 'America/New_York',
  WY: 'America/Denver',
};

/**
 * A DEFAULT, never an answer. Several states are split — North Dakota runs
 * Central and Mountain, and this fleet has trucks in both halves of it — and
 * there is no geocoder in this product to settle it. The dispatcher sees the
 * zone and its current abbreviation and can change it.
 */
export function zoneForState(state: string | null): string {
  if (!state) return 'America/Chicago';
  return ZONE_BY_STATE[state.toUpperCase()] ?? 'America/Chicago';
}

const ZONES = [...new Set(Object.values(ZONE_BY_STATE))].sort();

export function AppointmentFields({
  draft,
  onChange,
  dispatchTz,
  disabled,
  error,
  endError,
  initialFocus = false,
}: {
  draft: AppointmentDraft;
  onChange: (next: AppointmentDraft) => void;
  dispatchTz: string;
  disabled: boolean;
  error?: string | undefined;
  /** Field error for the FCFS latest hour. */
  endError?: string | undefined;
  /** Takes the modal's opening focus when the truck already has a driver. */
  initialFocus?: boolean;
}) {
  const set = (patch: Partial<AppointmentDraft>) => onChange({ ...draft, ...patch });

  /**
   * The badge inside the time field, and the read-only "your clock" line.
   * Both are derived from an instant built ONLY for display — the value that
   * gets saved is the wall time itself.
   */
  const preview = useMemo(() => {
    if (!draft.date || !draft.time || !isIanaZone(draft.tz)) return null;
    const [y, m, d] = draft.date.split('-').map(Number);
    const [h, min] = draft.time.split(':').map(Number);
    if ([y, m, d, h, min].some((n) => n === undefined || Number.isNaN(n))) return null;

    // Display-only: good enough to name the abbreviation and show the two
    // clocks. The authoritative conversion happens on the server.
    const guess = new Date(Date.UTC(y!, m! - 1, d!, h!, min!));
    const abbrev = zoneAbbreviation(guess, draft.tz);
    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const at = (zone: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(offsetGuess(guess, draft.tz));
    return {
      abbrev,
      dispatch: `${at(dispatchTz)} ${zoneAbbreviation(guess, dispatchTz)}`,
      viewer: `${at(viewerZone)} ${zoneAbbreviation(guess, viewerZone)}`,
    };
  }, [draft.date, draft.time, draft.tz, dispatchTz]);

  return (
    <fieldset disabled={disabled} className="mt-4 border-0 p-0">
      <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
        Appointment — as written on the rate confirmation
      </legend>

      <div className="mb-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-body text-text-secondary">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          This stop has an appointment
        </label>
        {draft.enabled ? (
          <div className="ml-auto flex border border-line-hair">
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
            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">
                Date (stop-local)
              </span>
              <input
                type="date"
                data-initial-focus={initialFocus ? '' : undefined}
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
                className="h-10 w-full border border-line-hair bg-surface-sunken px-2.5 text-body tabular-nums text-text"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">
                {draft.type === 'FCFS' ? 'Earliest receiving hour' : 'Time at the stop'}
              </span>
              <span className="relative block">
                <input
                  type="time"
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
                    value={draft.endTime}
                    onChange={(e) => set({ endTime: e.target.value })}
                    aria-describedby="appt-help"
                    className={`h-10 w-full border bg-surface-sunken px-2.5 pr-14 text-body tabular-nums text-text ${
                      endError ? 'border-status-late-fg' : 'border-line-hair'
                    }`}
                  />
                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 border border-line-hair bg-surface-overlay px-1.5 py-0.5 font-cond text-[11px] uppercase tracking-[.09em] text-text-secondary">
                    {preview?.abbrev ?? '—'}
                  </span>
                </span>
              ) : (
                <select
                  value={draft.windowMinutes}
                  onChange={(e) => set({ windowMinutes: Number(e.target.value) })}
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                >
                  {[0, 15, 30, 60, 120].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Exact time' : `±${m} min`}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <label className="col-span-1 block">
              <span className="mb-1 block text-small text-text-secondary">
                Facility time zone
              </span>
              <select
                value={draft.tz}
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

/**
 * Turns a wall time into the instant it names in `zone`, for display only.
 * Two passes: build a UTC guess, measure how that guess renders in the zone,
 * then correct by the difference. The SERVER does the real conversion, in
 * Postgres, and its answer is what gets stored.
 */
function offsetGuess(utcGuess: Date, zone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcGuess);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return new Date(utcGuess.getTime() * 2 - asUtc);
}
