'use client';

import { zoneAbbreviation } from '@/lib/format';
import { isIanaZone } from '@/lib/appointment';
import type { ArrivalSource } from '@/lib/status';

/**
 * §12.57. The arrival, marked by hand.
 *
 * `arrived_at` had one writer until now — the sweep, which anchors it to a
 * GPS fix. Two real stops cannot produce that fix at all: a ZIP centroid,
 * where §12.30 gates arrival off entirely, and a street match the §12.55
 * guard refuses, which leaves the stop with no coordinate to measure from.
 * Those stops would otherwise never flip, however long the truck sat there.
 *
 * ## Why this is a time and not a button
 *
 * A button that stamps `now()` records when the DISPATCHER got round to it,
 * not when the truck arrived, and the gap is the whole value of the field:
 * confirming at 07:10 for a truck that docked at 06:44 would put 26 minutes
 * of invented detention into the only column anyone could argue it from.
 *
 * ## Why it is a wall time and not an instant
 *
 * The same rule the appointment has kept since phase 2 (§7): the browser
 * sends the integers it was given and the zone it read them in, and Postgres
 * converts. Nothing here builds a Date to send.
 *
 * The zone is the STOP's — the same one the appointment block is showing,
 * not a second picker. A dispatcher reading "06:44" off a phone call is
 * reading the receiver's clock, and asking them which zone that was, twice
 * in one modal, is how the wrong answer gets typed.
 */

export interface ArrivalDraft {
  /** Unchecked with a stored arrival means CLEAR IT (§12.23's null). */
  marked: boolean;
  /** yyyy-mm-dd and HH:mm, as the inputs give them. Split on the wire. */
  date: string;
  time: string;
}

export function ArrivalFields({
  draft,
  onChange,
  /** The stop's zone — whatever the appointment block currently holds. */
  zone,
  storedSource,
  disabled,
  error,
}: {
  draft: ArrivalDraft;
  onChange: (next: ArrivalDraft) => void;
  zone: string;
  /** What is in the database now, or null when the truck has not arrived. */
  storedSource: ArrivalSource | null;
  disabled: boolean;
  error?: string | undefined;
}) {
  const set = (patch: Partial<ArrivalDraft>) => onChange({ ...draft, ...patch });

  /**
   * Display only, and built from the date being typed rather than from today:
   * the abbreviation is a property of the INSTANT, and an arrival entered on
   * 3 November is CST where the same clock face on 1 November is CDT.
   */
  const abbrev = (() => {
    if (!isIanaZone(zone)) return '';
    const [y, m, d] = draft.date.split('-').map(Number);
    const [h, min] = draft.time.split(':').map(Number);
    if ([y, m, d, h, min].some((n) => n === undefined || Number.isNaN(n))) return '';
    return zoneAbbreviation(new Date(Date.UTC(y!, m! - 1, d!, h!, min!)), zone);
  })();

  return (
    <fieldset disabled={disabled} className="mt-4 border-0 p-0">
      <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
        Arrival
      </legend>

      <label className="flex items-center gap-2 text-body text-text-secondary">
        <input
          type="checkbox"
          checked={draft.marked}
          onChange={(e) => set({ marked: e.target.checked })}
          aria-label="This truck has arrived at this stop"
        />
        This truck has arrived at this stop
      </label>

      {draft.marked ? (
        <>
          <div className="mt-3 grid grid-cols-[1.2fr_1fr_1.4fr] gap-3">
            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">
                Arrival date
              </span>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
                className="h-10 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
              />
            </label>
            <label className="block">
              {/* Not "Time at the stop" — the appointment block already
                  uses that exact label, and two fields with one name in one
                  modal is how the wrong one gets filled in at 4am. */}
              <span className="mb-1 block text-small text-text-secondary">
                Arrival time at the stop
              </span>
              <div className="relative">
                <input
                  type="time"
                  value={draft.time}
                  onChange={(e) => set({ time: e.target.value })}
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2 pr-12 text-body text-text"
                />
                {abbrev ? (
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-cond text-micro uppercase tracking-[.08em] text-text-muted">
                    {abbrev}
                  </span>
                ) : null}
              </div>
            </label>
            <p className="self-end pb-2 text-small text-text-muted">
              {/* Not "your clock": the number that matters is the receiver's,
                  and offering a second one invites typing it in. */}
              When the truck reached the receiver, on the receiver&rsquo;s clock.
            </p>
          </div>

          {/**
           * The one thing a dispatcher cannot see from the inputs: that
           * saving replaces a MEASUREMENT with an assertion. Editing a
           * detected arrival is legitimate — §12.54's radius put one 60
           * seconds early — but it should be a decision, not a side effect
           * of opening the modal and pressing Save.
           */}
          {storedSource === 'detected' ? (
            <p className="mt-2 text-small text-text-muted">
              This arrival was detected from GPS. Changing the time replaces that
              with your own entry, and the row will read <em>marked</em> instead of{' '}
              <em>arrived</em>.
            </p>
          ) : null}
        </>
      ) : storedSource !== null ? (
        <p className="mt-2 text-small text-status-late-fg">
          Saving now will clear the recorded arrival for this stop.
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-small text-status-late-fg" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
