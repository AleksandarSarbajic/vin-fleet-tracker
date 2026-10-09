import { MAX_STOPS_PER_LOAD } from '@/lib/load-edit';
import { zipStateCheck } from '@/lib/geo/zip-state';
import type { RateconRead, Source, StopRead, TimeRead } from '@/lib/ratecon/templates';
import type { AppointmentDraft } from './AppointmentFields';
import {
  addStop,
  deliveryBeforePickup,
  patchStop,
  stopFormFrom,
  zoneCheckMessage,
  type LoadForm,
  type StopFill,
  type StopForm,
} from './load-form';

/**
 * §12.122. A rate confirmation's read, put into the edit modal's form. Pure.
 *
 * Fills the load number and, per stop in the document's order, the type,
 * street, ZIP, city, state and appointment; the zone follows the address by
 * §12.120's rules. Never the rate, broker, contacts, driver, trailer, notes,
 * status or Active — the read does not carry them. Nothing is saved: the
 * form is the dispatcher's to look at, change and Save.
 */

export const TOO_MANY_STOPS = (n: number) =>
  `This rate confirmation has ${n} stops; a load holds at most ${MAX_STOPS_PER_LOAD}. Nothing was filled.`;

/** A window this long or shorter is an appointment window; longer is receiving hours. */
export const APPT_WINDOW_MAX_MINUTES = 120;
/** A date this many days out is far enough to be a typo. */
export const FAR_DAYS = 30;

const quote = (text: string) => `“${text}”`;

const minutesBetween = (date: string, time: string, endDate: string, endTime: string) => {
  const at = (d: string, t: string) =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), Number(t.slice(0, 2)), Number(t.slice(3, 5)));
  return (at(endDate, endTime) - at(date, time)) / 60_000;
};

const length = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : '', m > 0 ? `${m} min` : ''].filter(Boolean).join(' ');
};

const nextDay = (date: string) => {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1));
  return d.toISOString().slice(0, 10);
};

/**
 * What the text said about a stop's time, as the form's appointment — and
 * what to check. An exact time is APPT with no window; a window of two hours
 * or less is APPT with that window; a longer one is FCFS receiving hours, and
 * says so. Anything else is left blank and quoted. Never a guessed time.
 */
export function appointmentFrom(
  time: TimeRead,
): { patch: Partial<AppointmentDraft>; check: string | null } {
  const blank = (date: string | null, check: string) => ({
    patch: { enabled: true, type: 'APPT' as const, date: date ?? '', time: '', windowMinutes: 0 },
    check,
  });
  switch (time.kind) {
    case 'none':
      return { patch: { enabled: false }, check: 'No date or time for this stop in the PDF.' };
    case 'unreadable':
      return blank(time.date, `Couldn't read: ${quote(time.quoted)}.`);
    case 'exact':
      return {
        patch: { enabled: true, type: 'APPT', date: time.date, time: time.time, windowMinutes: 0 },
        check:
          time.flag === 'FCFS'
            ? 'Check: the PDF says FCFS but gives one time, so it is filled as an appointment at that time.'
            : null,
      };
    case 'range': {
      const minutes = minutesBetween(time.date, time.time, time.endDate, time.endTime);
      if (minutes < 0) {
        return blank(
          time.date,
          `Check: the window ends before it starts: ${quote(time.source.text)}. It was not read as overnight; enter it by hand.`,
        );
      }
      if (minutes === 0) {
        return { patch: { enabled: true, type: 'APPT', date: time.date, time: time.time, windowMinutes: 0 }, check: null };
      }
      if (minutes <= APPT_WINDOW_MAX_MINUTES) {
        return {
          patch: { enabled: true, type: 'APPT', date: time.date, time: time.time, windowMinutes: minutes },
          check:
            time.flag === 'FCFS'
              ? `Check: the PDF says FCFS; a window of ${length(minutes)} is filled as an appointment window.`
              : null,
        };
      }
      const overnight = time.endDate === nextDay(time.date) && time.endTime <= time.time;
      if (time.endDate !== time.date && !overnight) {
        return blank(time.date, `Check: the window runs longer than a day: ${quote(time.source.text)}. Enter it by hand.`);
      }
      return {
        patch: { enabled: true, type: 'FCFS', date: time.date, time: time.time, endTime: time.endTime },
        check:
          `Check: a window of ${length(minutes)} (${time.time}–${time.endTime}${overnight ? ' the next day' : ''}) is longer than 2 hours, so it is filled as FCFS receiving hours.` +
          (time.flag === 'APPT' ? ' The PDF calls it APPT.' : ''),
      };
    }
  }
}

/** The stop-local calendar day of `now`. */
const today = (now: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

function dateCheck(date: string, tz: string, now: Date): string | null {
  if (date === '') return null;
  const day = today(now, tz);
  if (date < day) return 'Check: this date has passed.';
  const far = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + FAR_DAYS))
    .toISOString()
    .slice(0, 10);
  if (date > far) return `Check: this date is more than ${FAR_DAYS} days out.`;
  return null;
}

function fillStop(blank: StopForm, read: StopRead, now: Date): StopForm {
  const sources: StopFill['sources'] = { stopType: read.type.source };
  const checks: StopFill['checks'] = {};
  if (read.typeCheck) checks.stopType = read.typeCheck;

  const address: Partial<StopForm> = { stopType: read.type.value };
  for (const [field, value] of [
    ['addressLine', read.street],
    ['city', read.city],
    ['state', read.state],
    ['zip', read.zip],
  ] as const) {
    if (value) {
      address[field] = value.value;
      sources[field] = value.source;
    } else {
      checks[field] = 'Not found in the PDF.';
    }
  }
  // The address first, so the zone follows it (§12.120)…
  let stop = patchStop(blank, address);
  // …then the appointment, in the zone the address settled on.
  const appointment = appointmentFrom(read.time);
  stop = patchStop(stop, { appointment: { ...stop.appointment, ...appointment.patch, tz: stop.appointment.tz } });
  if (read.time.kind !== 'none' && read.time.source) sources.appointment = read.time.source;
  const when = dateCheck(stop.appointment.enabled ? stop.appointment.date : '', stop.appointment.tz, now);
  const said = [appointment.check, when].filter(Boolean).join(' ');
  if (said) checks.appointment = said;
  return { ...stop, fill: { sources, checks } };
}

/**
 * The read, as the form. Replaces the stops the form has — every one of them
 * unsaved, or the strip would not have been offered — and the load number;
 * keeps the driver, the status and anything the load itself already is.
 */
export function fillLoad(
  form: LoadForm,
  read: RateconRead,
  openedAt: string,
  now: Date,
): { ok: true; form: LoadForm } | { ok: false; message: string } {
  if (read.stops.length > MAX_STOPS_PER_LOAD) return { ok: false, message: TOO_MANY_STOPS(read.stops.length) };
  const firstKey = form.stops[0]?.key ?? 'new-1';
  let next: LoadForm = {
    ...form,
    loadNumber: read.loadNumber?.value ?? form.loadNumber,
    stops: [stopFormFrom(null, openedAt, firstKey)],
    fill: {
      layout: read.layout,
      loadNumber: read.loadNumber?.source ?? null,
      loadNumberCheck: read.loadNumberCheck,
    },
  };
  read.stops.forEach((stopRead, i) => {
    if (i > 0) next = addStop(next, openedAt).form;
    const at = next.stops.length - 1;
    next = {
      ...next,
      stops: next.stops.map((s, j) => (j === at ? fillStop(s, stopRead, now) : s)),
    };
  });
  return { ok: true, form: next };
}

/**
 * "4 fields to check": every mark a fill left that is still standing, every
 * zone still waiting for a confirmation, every ZIP that is not in its state,
 * and a delivery before a pickup. Counted live, so it falls as they are seen to.
 */
export function fieldsToCheck(form: LoadForm): number {
  let n = form.fill?.loadNumberCheck ? 1 : 0;
  form.stops.forEach((stop, i) => {
    n += Object.keys(stop.fill?.checks ?? {}).length;
    if (zoneCheckMessage(stop) && !stop.fill?.checks.appointment) n += 1;
    if (zipStateCheck(stop.state, stop.zip) && !stop.fill?.checks.zip) n += 1;
    if (deliveryBeforePickup(form, i)) n += 1;
  });
  return n;
}

/** Said under a filled field: where it came from, exactly. */
export function sourceLine(source: Source | undefined): string | undefined {
  if (!source) return undefined;
  return `${source.page === null ? 'From the pasted text' : `From p.${source.page}`}: ${quote(source.text)}`;
}
