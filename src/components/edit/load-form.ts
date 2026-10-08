import { DEFAULT_WINDOW_MINUTES, isIanaZone, storedWindowMinutes } from '@/lib/appointment';
import { timeInZone, wallTimeInstant } from '@/lib/format';
import { MAX_STOPS_PER_LOAD } from '@/lib/load-edit';
import { LOAD_STATUSES } from '@/lib/loads';
import type { LoadForEdit } from '@/lib/load-read';
import { needsReachedAnswer } from '@/lib/reached-stop';
import { StopEdit, dirtyFields } from '@/lib/stop-edit';
import {
  FCFS_DEFAULT_EARLIEST,
  FCFS_DEFAULT_LATEST,
  zoneForState,
  type AppointmentDraft,
} from './AppointmentFields';
import type { ArrivalDraft, DepartureDraft } from './ArrivalFields';
import { zoneForAddress, type ZoneVerdict } from '@/lib/geo/zone-for-address';

/**
 * §12.119. The edit modal's form, for a load with any number of stops — and
 * the rules that read it. Pure: no React, no fetch, so every rule here is
 * tested without rendering anything.
 *
 * The per-stop conversion (`stopEditOf`) is the one-stop modal's `toEdit`,
 * moved here unchanged. A one-stop load's save must stay byte for byte the
 * request it was (one-stop-body.test.tsx), and the surest way to keep that is
 * not to rewrite the function that builds it.
 */

export type LoadStatus = (typeof LOAD_STATUSES)[number];
export type StopRead = LoadForEdit['stops'][number];

export interface StopForm {
  /** The stop's id, or `new-<n>` for one this form added (stage 4b). */
  key: string;
  /** What the load read said about this stop; null for one this form added. */
  stored: StopRead | null;
  stopType: 'PU' | 'DEL';
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  note: string;
  appointment: AppointmentDraft;
  arrival: ArrivalDraft;
  departure: DepartureDraft;
  /** §12.120. Where the appointment's zone came from, and whether it is settled. */
  zone: ZoneState;
}

/** §12.120. */
export interface ZoneState {
  /**
   * `kept`   — a saved stop's stored zone. Its address never moves it.
   * `auto`   — follows the state, and in a state with two zones the ZIP.
   * `chosen` — picked by hand in this form. Nothing overrides it.
   */
  mode: 'kept' | 'auto' | 'chosen';
  /**
   * What the address last said. Null until the state or ZIP is typed, or the
   * appointment ticked: opening a stop decides nothing, so a stop opened to
   * change its note is never asked about its zone.
   */
  verdict: ZoneVerdict | null;
  /** "Zone is right" was pressed for this verdict. */
  confirmed: boolean;
}

export interface LoadForm {
  loadNumber: string;
  loadStatus: LoadStatus;
  driverId: string | null;
  stops: StopForm[];
  /** §12.119 stage 4b. Saved stops taken off the load by this form, in the order removed. */
  removed: string[];
}

export interface FieldError {
  field: string;
  message: string;
  /** The stop it belongs to; absent for the load's own fields and the banner. */
  stopKey?: string;
}

/** §12.119 S4-A. Said under the time field of a ticked appointment with no time. */
export const APPOINTMENT_TIME_MISSING = 'Enter a time, or untick the appointment.';
/** §12.119. Said under the date field of a ticked appointment with no date. */
export const APPOINTMENT_DATE_MISSING = 'Enter a date, or untick the appointment.';

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

/** The stop's zone, for its arrival and departure. Same facility, same clock (§7.1). */
const zoneOf = (stop: StopRead | null) => stop?.apptTz ?? zoneForState(stop?.state ?? null);

/**
 * One stop as the form opens on it: the stored values, never blanks over them
 * (§12.53, §12.57), and for an unmarked arrival or departure a default of now
 * at the stop — `openedAt`, frozen when the modal opened, so the form is not
 * dirty on its own.
 */
export function stopFormFrom(stop: StopRead | null, openedAt: string, key?: string): StopForm {
  const zone = zoneOf(stop);
  return {
    key: key ?? stop?.stopId ?? 'new-1',
    stored: stop,
    stopType: stop?.type ?? 'DEL',
    addressLine: stop?.addressLine ?? '',
    city: stop?.city ?? '',
    state: stop?.state ?? '',
    zip: stop?.zip ?? '',
    note: stop?.dispatcherNote ?? '',
    appointment: {
      enabled: Boolean(stop?.apptStartUtc),
      type: stop?.apptType ?? 'APPT',
      date: isoDate(stop?.apptStartUtc ?? null, stop?.apptTz ?? null),
      time:
        isoTime(stop?.apptStartUtc ?? null, stop?.apptTz ?? null) ||
        (stop?.apptType === 'FCFS' ? FCFS_DEFAULT_EARLIEST : ''),
      // §12.22: receiving hours default to 07:00–15:00 on a new FCFS stop.
      endTime: isoTime(stop?.apptEndUtc ?? null, stop?.apptTz ?? null) || FCFS_DEFAULT_LATEST,
      tz: stop?.apptTz ?? zoneForState(stop?.state ?? null),
      // §12.115: the window the stop was saved with, never the default.
      windowMinutes:
        stop?.apptType === 'FCFS'
          ? DEFAULT_WINDOW_MINUTES
          : storedWindowMinutes(stop?.apptStartUtc ?? null, stop?.apptEndUtc ?? null),
    },
    arrival: {
      marked: Boolean(stop?.arrivedAt),
      date: isoDate(stop?.arrivedAt ?? null, zone) || isoDate(openedAt, zone),
      time: isoTime(stop?.arrivedAt ?? null, zone) || isoTime(openedAt, zone),
    },
    /**
     * §12.118. Loaded like the arrival. The board's next stop has not been
     * left — that is what makes it the next stop — so there it always opens
     * unmarked; a stop the truck has left opens with its departure.
     */
    departure: {
      marked: Boolean(stop?.departedAt),
      date: isoDate(stop?.departedAt ?? null, zone) || isoDate(openedAt, zone),
      time: isoTime(stop?.departedAt ?? null, zone) || isoTime(openedAt, zone),
    },
    /**
     * §12.120. A stored zone stays; without one the zone follows the address
     * — unless the truck's arrival is recorded. That arrival is shown, and
     * saved back, as wall time in this zone, so a zone that moved under it
     * would move the arrival itself by the difference.
     */
    zone: {
      mode: stop?.apptTz || stop?.arrivedAt ? 'kept' : 'auto',
      verdict: null,
      confirmed: false,
    },
  };
}

/**
 * §12.120. A change to one stop's form, with the zone following the address.
 *
 *   - A zone picked in the dropdown is the dispatcher's: `chosen`, for good.
 *   - Otherwise, on a stop whose zone follows (`auto`), a new state or ZIP —
 *     or ticking the appointment — asks the address again, and the zone
 *     becomes its answer. An uncertain answer offers the state's usual zone
 *     and asks for a confirmation (`zoneErrors`).
 *   - A saved stop's stored zone (`kept`) never moves.
 */
export function patchStop(stop: StopForm, patch: Partial<StopForm>): StopForm {
  const next = { ...stop, ...patch };
  if (patch.appointment && patch.appointment.tz !== stop.appointment.tz) {
    return { ...next, zone: { mode: 'chosen', verdict: null, confirmed: false } };
  }
  const asks =
    patch.state !== undefined ||
    patch.zip !== undefined ||
    (patch.appointment?.enabled === true && !stop.appointment.enabled);
  if (stop.zone.mode !== 'auto' || !asks) return next;
  const verdict = zoneForAddress(next.state, next.zip);
  if (!verdict) return { ...next, zone: { ...stop.zone, verdict: null, confirmed: false } };
  return {
    ...next,
    appointment: { ...next.appointment, tz: verdict.zone },
    zone: { mode: 'auto', verdict, confirmed: false },
  };
}

/** §12.120. "Zone is right": the dispatcher settles an uncertain zone as shown. */
export function confirmZone(stop: StopForm): StopForm {
  return { ...stop, zone: { ...stop.zone, confirmed: true } };
}

/** §12.120. The words under an unsettled zone — and, while they show, Save waits. */
export function zoneCheckMessage(stop: StopForm): string | null {
  const { verdict, mode, confirmed } = stop.zone;
  if (mode !== 'auto' || confirmed || verdict?.kind !== 'uncertain') return null;
  const state = stop.state.trim().toUpperCase();
  const zip = stop.zip.trim();
  switch (verdict.reason) {
    case 'no-zip':
      return `${state} has more than one time zone. Enter the ZIP, or check the zone and confirm it.`;
    case 'zip-crosses':
      return `ZIP ${zip} crosses a time zone line. Check the zone, then confirm it.`;
    case 'zip-unknown':
      return `${state} has more than one time zone, and ZIP ${zip} isn't one we can place. Check the zone, then confirm it.`;
    case 'not-a-state':
      return `${state} isn't a US state, so the zone can't be worked out. Check it, then confirm it.`;
  }
}

/** The form as it opens: the load read, or — with none — a new load's one stop. */
export function loadFormFrom(
  read: LoadForEdit | null,
  openedAt: string,
  driverId: string | null,
): LoadForm {
  return {
    loadNumber: read?.loadNumber ?? '',
    loadStatus: read?.status ?? 'AVAILABLE',
    driverId,
    removed: [],
    stops: read && read.stops.length > 0
      ? read.stops.map((s) => stopFormFrom(s, openedAt))
      : [stopFormFrom(null, openedAt)],
  };
}

const wall = (date: string, time: string, tz: string) => ({
  date: { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) },
  time: { h: Number(time.slice(0, 2)), min: Number(time.slice(3, 5)) },
  tz,
});

/**
 * One stop as the flat edit the server's rules are written against — the
 * one-stop modal's `toEdit`, unchanged but for the departure's third state,
 * which a stop the truck has LEFT needs and the next stop never has.
 */
export function stopEditOf(load: LoadForm, f: StopForm, truckId: string) {
  const trimmed = (value: string) => (value.trim() === '' ? null : value.trim());
  const [y, m, d] = f.appointment.date.split('-').map(Number);
  const [h, min] = f.appointment.time.split(':').map(Number);
  const [endH, endMin] = f.appointment.endTime.split(':').map(Number);
  const hasAppointment =
    f.appointment.enabled && [y, m, d, h, min].every((n) => n !== undefined && !Number.isNaN(n));
  const isFcfs = f.appointment.type === 'FCFS';

  return {
    stopId: f.stored?.stopId ?? null,
    truckId,
    loadNumber: load.loadNumber,
    loadStatus: load.loadStatus,
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
          endTime:
            isFcfs && endH !== undefined && !Number.isNaN(endH)
              ? { h: endH, min: endMin ?? 0 }
              : null,
        }
      : null,
    dispatcherNote: trimmed(f.note),
    /**
     * §12.57: marked, a wall time; cleared, null — only when there IS one to
     * clear; nothing to say, omitted. The zone is the appointment block's,
     * live, so correcting the facility's zone corrects the arrival with it.
     */
    arrivedAt: f.arrival.marked
      ? wall(f.arrival.date, f.arrival.time, f.appointment.tz)
      : f.stored?.arrivedAt
        ? null
        : undefined,
    /**
     * §12.118, the same three states. Never sent without the arrival it
     * leaves from: unticking the arrival clears both on the server.
     */
    departedAt:
      f.arrival.marked && f.departure.marked
        ? wall(f.departure.date, f.departure.time, f.appointment.tz)
        : f.arrival.marked && f.stored?.departedAt
          ? null
          : undefined,
    driverId: load.driverId,
  };
}

export type StopEditDraft = ReturnType<typeof stopEditOf>;

/** The load's own fields, named once in the dirty banner. */
const LOAD_LABELS = new Set(['load number', 'load status', 'assigned driver']);
/** The load's own fields as the flat edit names them. */
const LOAD_FIELDS = new Set(['loadNumber', 'loadStatus', 'driverId', 'truckId']);

export interface Dirty {
  load: string[];
  /** Per stop key, the stop's own unsaved fields. */
  stops: Map<string, string[]>;
  /** Per stop key, everything `dirtyFields` said, load fields included. */
  raw: Map<string, string[]>;
}

/**
 * What is unsaved, against the form as it opened — the same function on both
 * sides (§12.53's lesson: a hand-written "before" opened every modal dirty).
 */
export function dirtyOf(initial: LoadForm, current: LoadForm, truckId: string): Dirty {
  const load = new Set<string>();
  const stops = new Map<string, string[]>();
  const raw = new Map<string, string[]>();
  for (const stop of current.stops) {
    const before = initial.stops.find((s) => s.key === stop.key);
    if (!before) {
      stops.set(stop.key, ['new']);
      raw.set(stop.key, ['new']);
      continue;
    }
    const labels = dirtyFields(
      stopEditOf(initial, before, truckId) as StopEdit,
      stopEditOf(current, stop, truckId) as StopEdit,
    );
    raw.set(stop.key, labels);
    for (const label of labels) if (LOAD_LABELS.has(label)) load.add(label);
    const own = labels.filter((l) => !LOAD_LABELS.has(l));
    if (own.length > 0) stops.set(stop.key, own);
  }
  return { load: [...load], stops, raw };
}

/**
 * The banner's words. One stop reads exactly as the one-stop modal did —
 * "Unsaved changes — appointment time, note." — and several name their stop:
 * "load number; stop 2: appointment time".
 */
export function dirtyLabels(dirty: Dirty, form: LoadForm, initial: LoadForm): string[] {
  if (form.stops.length === 1 && form.removed.length === 0) {
    return dirty.raw.get(form.stops[0]!.key) ?? [];
  }
  const out = [...dirty.load];
  form.stops.forEach((stop, i) => {
    const own = dirty.stops.get(stop.key);
    if (own) out.push(`stop ${i + 1}: ${own.join(', ')}`);
  });
  // A removed stop is named as it was numbered when the form opened.
  for (const id of form.removed) {
    const index = initial.stops.findIndex((s) => s.key === id);
    const stop = initial.stops[index];
    if (!stop) continue;
    const place = placeOf(stop);
    out.push(`stop ${index + 1}${place ? ` (${place})` : ''} removed`);
  }
  return out;
}

const placeOf = (stop: StopForm) =>
  [stop.city.trim(), stop.state.trim().toUpperCase()].filter(Boolean).join(', ');

/**
 * §12.119. Which stops a save sends: those with unsaved changes, in the load's
 * order. A save that changes only the load's own fields — or the override —
 * sends the next stop, as the one-stop modal always did; on a one-stop load
 * that is its one stop, every time.
 */
export function stopsToSend(
  form: LoadForm,
  dirty: Dirty,
  nextKey: string | null,
  overrideChanged: boolean,
): StopForm[] {
  const fallback =
    form.stops.find((s) => s.key === nextKey) ?? form.stops[0]!;
  // A stop this form added is always sent — on a new load, the one it
  // opened with as well, untouched or not: a new load is every stop it has.
  const send = form.stops.filter(
    (s) =>
      dirty.stops.has(s.key) ||
      (s.stored === null && form.stops.length > 1) ||
      (overrideChanged && s.key === fallback.key),
  );
  return send.length > 0 ? send : [fallback];
}

/**
 * §12.119 S4-A. A ticked appointment with no time — or no date — used to
 * save as NO appointment, silently: `stopEditOf` cannot build one without
 * both, and sends null. Now each is an error on its own field, on every stop,
 * APPT or FCFS alike.
 */
export function appointmentErrors(form: LoadForm): FieldError[] {
  return form.stops.flatMap((s) => {
    if (!s.appointment.enabled) return [];
    const errors: FieldError[] = [];
    // §12.120. An uncertain zone, unconfirmed, is the stop's to settle.
    const zoneCheck = zoneCheckMessage(s);
    if (zoneCheck) errors.push({ field: 'appointment.tz', message: zoneCheck, stopKey: s.key });
    if (s.appointment.date.trim() === '') {
      errors.push({ field: 'appointment.date', message: APPOINTMENT_DATE_MISSING, stopKey: s.key });
    }
    if (s.appointment.time.trim() === '') {
      errors.push({ field: 'appointment.time', message: APPOINTMENT_TIME_MISSING, stopKey: s.key });
    }
    return errors;
  });
}

/**
 * The local check of every stop the save would send, against the server's
 * own schema. A stop's field errors carry its key; the load's own fields are
 * said once, without one.
 */
export function localErrors(
  form: LoadForm,
  send: StopForm[],
  truckId: string,
): { errors: FieldError[]; parsed: StopEdit[] | null } {
  const errors: FieldError[] = [...appointmentErrors(form)];
  const parsed: StopEdit[] = [];
  const seenLoad = new Set<string>();
  for (const stop of send) {
    const result = StopEdit.safeParse(stopEditOf(form, stop, truckId));
    if (result.success) {
      parsed.push(result.data);
      continue;
    }
    for (const issue of result.error.issues) {
      const field = issue.path.join('.');
      if (LOAD_FIELDS.has(String(issue.path[0]))) {
        if (seenLoad.has(field)) continue;
        seenLoad.add(field);
        errors.push({ field, message: issue.message });
      } else {
        errors.push({ field, message: issue.message, stopKey: stop.key });
      }
    }
  }
  return { errors, parsed: errors.length === 0 ? parsed : null };
}

/**
 * The server names a stop's field `stops.<i>.<field>`, where i is the stop's
 * place in the REQUEST. `sentKeys` is the order the request had; the error
 * goes to that stop's form, and a field the server names on the load stays
 * on the load — `version`, which has no input of its own, on the banner.
 */
export function routeServerError(error: FieldError, sentKeys: readonly string[]): FieldError {
  const match = /^stops\.(\d+)\.(.+)$/.exec(error.field);
  if (match) {
    const key = sentKeys[Number(match[1])];
    if (key !== undefined) return { field: match[2]!, message: error.message, stopKey: key };
  }
  return { field: error.field === 'version' ? '*' : error.field, message: error.message };
}

/** The flags one stop's form and list row are drawn from. */
export interface StopFlags {
  /** The board's next stop. */
  next: boolean;
  arrived: boolean;
  /** The truck has left it — stored, so its address, type and appointment stay (D4). */
  departed: boolean;
  /** §12.116 D5: why its arrival cannot be ticked, if it cannot. */
  arrivalBlocked: string | null;
}

/**
 * §12.116 D5, in the form. A stop's arrival cannot be ticked while an earlier
 * stop has not been left — stored, or ticked in this form, since the server
 * now counts a departure written earlier in the same save (§12.119).
 */
export function stopFlags(form: LoadForm, index: number, nextKey: string | null): StopFlags {
  const stop = form.stops[index]!;
  const earlier = form.stops
    .slice(0, index)
    .findIndex((s) => !(s.arrival.marked && s.departure.marked));
  return {
    next: stop.key === nextKey,
    arrived: Boolean(stop.stored?.arrivedAt),
    departed: Boolean(stop.stored?.departedAt),
    arrivalBlocked:
      earlier === -1
        ? null
        : `Stop ${earlier + 1} hasn't been left yet, so the truck cannot have arrived here.`,
  };
}

/** §12.116 D4. Shown once at the top of a left stop's form. */
export const LEFT_STOP_NOTE =
  'The truck has left this stop, so its address, type and appointment stay as recorded.';

export interface ReachedAsk {
  arrivedAt: string;
  /** The stop asked about. */
  stopKey: string;
}

/**
 * The overwritten-trips fix, per stop. A sent stop the truck reached, given a
 * new city — or a new load number on a load any stop of which was reached:
 * the same two rules the server asks by (stop-edit.ts `reachedArrival`).
 */
export function reachedAsk(
  read: LoadForEdit | null,
  send: StopForm[],
  parsed: StopEdit[],
): ReachedAsk | null {
  if (!read) return null;
  for (const [i, stop] of send.entries()) {
    const stored = stop.stored;
    if (
      stored?.arrivedAt &&
      needsReachedAnswer(
        { arrivedAt: stored.arrivedAt, city: stored.city, loadNumber: read.loadNumber },
        { city: parsed[i]!.city, loadNumber: parsed[i]!.loadNumber },
      )
    ) {
      return { arrivedAt: stored.arrivedAt, stopKey: stop.key };
    }
  }
  const number = parsed[0]?.loadNumber;
  if (number !== undefined && number !== read.loadNumber) {
    const reached = read.stops.find((s) => s.arrivedAt !== null);
    if (reached?.arrivedAt) return { arrivedAt: reached.arrivedAt, stopKey: reached.stopId };
  }
  return null;
}

/**
 * §12.116 D3. "Next trip" closes this load as Delivered and saves the edited
 * stop as a new load, so it is offered only when every stop on the load has
 * been reached, and the save is that one stop. The stop asked about counts as
 * reached even when the read predates it: the server raised the question
 * because the truck got there after the modal opened.
 */
export function nextTripAllowed(
  read: LoadForEdit | null,
  send: StopForm[],
  askedKey: string,
  removed: readonly string[] = [],
): boolean {
  if (!read) return false;
  return (
    read.stops.every((s) => s.arrivedAt !== null || s.stopId === askedKey) &&
    send.length === 1 &&
    // An added stop or a removal is an edit of THIS load, not the next trip.
    send[0]!.stored !== null &&
    removed.length === 0
  );
}

/** "Stop 2 (Fargo, ND)" — or "Stop 2" before it has a place. */
export function stopName(form: LoadForm, key: string): string {
  const index = form.stops.findIndex((s) => s.key === key);
  const stop = form.stops[index];
  if (!stop) return 'This stop';
  const place = placeOf(stop);
  return place ? `Stop ${index + 1} (${place})` : `Stop ${index + 1}`;
}

/* ------------------------- Add and Remove (stage 4b) ------------------------- */

/** §12.116 D6. Under Add stop when the load is full. */
export const ADD_STOP_FULL = `A load holds at most ${MAX_STOPS_PER_LOAD} stops.`;
/** Under Remove stop on a load's only stop. */
export const REMOVE_LAST_STOP = 'A load needs at least one stop.';

/** Why Add stop is off, or null. */
export function addBlocked(form: LoadForm): string | null {
  return form.stops.length >= MAX_STOPS_PER_LOAD ? ADD_STOP_FULL : null;
}

/**
 * A new stop after the last one: the other type — a delivery follows a
 * pickup — and an appointment already ticked, on the last stop's date and in
 * its zone, with no time. The time is the one thing that cannot be guessed,
 * and an empty time on a ticked appointment is an error (S4-A), so the stop
 * cannot be saved without one.
 */
export function addStop(form: LoadForm, openedAt: string): { form: LoadForm; key: string } {
  const last = form.stops[form.stops.length - 1]!;
  const used = form.stops.flatMap((s) => {
    const match = /^new-(\d+)$/.exec(s.key);
    return match ? [Number(match[1])] : [];
  });
  const key = `new-${Math.max(0, ...used) + 1}`;
  const blank = stopFormFrom(null, openedAt, key);
  const stop: StopForm = {
    ...blank,
    stopType: last.stopType === 'PU' ? 'DEL' : 'PU',
    appointment: {
      ...blank.appointment,
      enabled: true,
      type: 'APPT',
      date: last.appointment.date,
      time: '',
      tz: last.appointment.tz,
    },
  };
  return { form: { ...form, stops: [...form.stops, stop] }, key };
}

/** Why Remove stop is off, and whether that is because the truck reached the stop. */
export interface RemoveBlock {
  text: string;
  /**
   * Reached: said as visible text under the stop's header, because it is a
   * fact about the stop. Otherwise — the load's only stop, the role — the
   * button's tooltip alone.
   */
  reached: boolean;
}

/**
 * Why a stop cannot be removed, or null. A stop the truck reached is part of
 * the record — the server refuses its removal under the load's lock too —
 * and a load keeps at least one stop.
 */
export function removeBlocked(form: LoadForm, index: number, dispatchTz: string): RemoveBlock | null {
  const stop = form.stops[index]!;
  const reachedAt = stop.stored?.arrivedAt ?? stop.stored?.departedAt ?? null;
  if (reachedAt) {
    const zone = isIanaZone(stop.appointment.tz) ? stop.appointment.tz : dispatchTz;
    return {
      text: `Can't remove: the truck arrived here at ${timeInZone(new Date(reachedAt), zone)}.`,
      reached: true,
    };
  }
  if (form.stops.length <= 1) return { text: REMOVE_LAST_STOP, reached: false };
  return null;
}

/**
 * A stop off the form. One this form added is simply gone; a saved one is
 * remembered in `removed`, so the save deletes it and Cancel — which drops
 * the form — leaves it on the load.
 */
export function removeStop(form: LoadForm, key: string): LoadForm {
  const stop = form.stops.find((s) => s.key === key);
  if (!stop) return form;
  return {
    ...form,
    stops: form.stops.filter((s) => s.key !== key),
    removed: stop.stored ? [...form.removed, stop.stored.stopId] : form.removed,
  };
}

/** The appointment's start as an instant, when the form holds a whole one. */
function appointmentInstant(stop: StopForm): Date | null {
  const a = stop.appointment;
  if (!a.enabled || !isIanaZone(a.tz)) return null;
  const [y, m, d] = a.date.split('-').map(Number);
  const [h, min] = a.time.split(':').map(Number);
  if (![y, m, d, h, min].every((n) => n !== undefined && !Number.isNaN(n))) return null;
  return wallTimeInstant({ y: y!, m: m!, d: d! }, { h: h!, min: min! }, a.tz);
}

/**
 * A quiet note under a delivery whose appointment comes before a pickup
 * above it — usually a typo in one of the two dates. Display only: never
 * sent, never an error, never in the way of Save. Compared as instants, so
 * stops in two zones are compared correctly; each time is shown in its own.
 */
export function deliveryBeforePickup(form: LoadForm, index: number): string | null {
  const stop = form.stops[index];
  if (!stop || stop.stopType !== 'DEL') return null;
  const at = appointmentInstant(stop);
  if (!at) return null;
  for (let j = index - 1; j >= 0; j -= 1) {
    const pickup = form.stops[j]!;
    if (pickup.stopType !== 'PU') continue;
    const pickupAt = appointmentInstant(pickup);
    if (!pickupAt || pickupAt.getTime() <= at.getTime()) continue;
    const zone = pickup.appointment.tz;
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).format(pickupAt);
    return `This delivery is before the pickup above it (stop ${j + 1}, ${day} ${timeInZone(pickupAt, zone)}).`;
  }
  return null;
}
