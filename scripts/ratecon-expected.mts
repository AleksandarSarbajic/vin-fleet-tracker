/**
 * The shape of `.samples/rate-confirmations/expected.json` — the hand-written
 * ground truth (docs/ground-truth-howto.md). Shared by `ratecon:score` and
 * `ratecon:check-expected`. Prints nothing.
 *
 * A field that is `null` is NOT WRITTEN YET (the skeletons). A field that is
 * `""` is ground truth: the document gives no such value. An entry is
 * complete when it has no `null` and its shape holds.
 *
 * Problems are reported as a PATH and a code ("stops.1.appointment:
 * invalid_union"), never zod's message: that can quote the value.
 */
import { z } from 'zod';
import type { StopForm } from '../src/components/edit/load-form';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const WallTime = z.string().regex(/^\d{2}:\d{2}$/);

/** What the dispatcher should end up with; see the how-to for each form. */
export const ExpectedAppointment = z.union([
  z.object({ type: z.literal('APPT'), date: IsoDate, time: WallTime, windowMinutes: z.number().int().min(0), marked: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('FCFS'), date: IsoDate, time: WallTime, endTime: WallTime, marked: z.boolean().optional() }).strict(),
  z.object({ couldntRead: z.literal(true), date: z.union([IsoDate, z.literal('')]) }).strict(),
  z.object({ none: z.literal(true) }).strict(),
]);
export type ExpectedAppointment = z.infer<typeof ExpectedAppointment>;

const Stop = z
  .object({
    type: z.enum(['PU', 'DEL']).nullable(),
    street: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    zip: z.string().nullable(),
    appointment: ExpectedAppointment.nullable(),
  })
  .strict();

const Entry = z.union([
  z.object({ notRecognised: z.literal(true) }).strict(),
  z
    .object({
      priority: z.union([z.literal(1), z.literal(2)]).optional(),
      loadNumber: z.string().nullable(),
      stops: z.array(Stop).min(1),
    })
    .strict(),
]);

export const ExpectedFile = z.object({ note: z.string().optional(), scoredAt: z.string(), files: z.record(z.unknown()) }).strict();

export interface ExpectedStop {
  type: 'PU' | 'DEL';
  street: string;
  city: string;
  state: string;
  zip: string;
  appointment: ExpectedAppointment;
}
export type CompleteEntry = { notRecognised: true } | { priority?: 1 | 2; loadNumber: string; stops: ExpectedStop[] };

export type Inspected =
  | { state: 'complete'; entry: CompleteEntry }
  | { state: 'incomplete'; blanks: number; priority: number | null }
  | { state: 'invalid'; problems: string[] };

const nulls = (v: unknown): number =>
  v === null ? 1 : Array.isArray(v) ? v.reduce((n: number, x) => n + nulls(x), 0) : typeof v === 'object' ? Object.values(v as object).reduce((n: number, x) => n + nulls(x), 0) : 0;

/** One entry: complete (and typed), incomplete (how many blanks), or not the right shape (where). */
export function inspect(entry: unknown): Inspected {
  const parsed = Entry.safeParse(entry);
  if (!parsed.success) {
    return { state: 'invalid', problems: parsed.error.issues.map((i) => `${i.path.join('.') || '(entry)'}: ${i.code}`) };
  }
  const blanks = nulls(parsed.data);
  if (blanks > 0) {
    const priority = 'priority' in parsed.data ? (parsed.data.priority ?? null) : null;
    return { state: 'incomplete', blanks, priority };
  }
  return { state: 'complete', entry: parsed.data as CompleteEntry };
}

/**
 * The part of an appointment that can differ, by NAME. The form has no end
 * date: an appointment's end is its `window` (minutes), receiving hours'
 * end is their `end time`, so a wrong end date shows as one of those.
 */
export type AppointmentPart = 'none-versus-set' | 'type' | 'date' | 'time' | 'window' | 'end time';

/**
 * Which parts of a stop's filled appointment differ from the ground truth —
 * never their values. Empty when it is right. Shared by `ratecon:score` and
 * `ratecon:eval-ai`; `appointmentScore` is built on it.
 */
export function appointmentDiff(stop: StopForm, want: ExpectedAppointment): AppointmentPart[] {
  const a = stop.appointment;
  if ('none' in want) return a.enabled ? ['none-versus-set'] : [];
  if (!a.enabled) return ['none-versus-set'];
  if ('couldntRead' in want) {
    const parts: AppointmentPart[] = [];
    if (a.date !== want.date) parts.push('date');
    if (a.time !== '') parts.push('time');
    return parts;
  }
  const parts: AppointmentPart[] = [];
  if (a.type !== want.type) parts.push('type');
  if (a.date !== want.date) parts.push('date');
  if (a.time !== want.time) parts.push('time');
  if (want.type === 'FCFS' ? a.endTime !== want.endTime : a.windowMinutes !== want.windowMinutes) {
    parts.push(want.type === 'FCFS' ? 'end time' : 'window');
  }
  return parts;
}

/**
 * One stop's appointment against the ground truth, as `ratecon:score` and
 * `ratecon:eval-ai` both score it: `exact` — filled, unmarked and right;
 * `marked, …` — the stop says Check or Couldn't read, so a person will look;
 * `WRONG` — filled, unmarked, and not what the PDF says.
 */
export function appointmentScore(
  stop: StopForm,
  want: ExpectedStop['appointment'],
): 'exact' | 'marked, filled as the PDF says' | 'marked, filled differently' | 'WRONG' {
  const marked = Boolean(stop.fill?.checks.appointment);
  const right = appointmentDiff(stop, want).length === 0;
  if (marked) return right ? 'marked, filled as the PDF says' : 'marked, filled differently';
  return right ? 'exact' : 'WRONG';
}

/** The score, and for a wrong or differently filled one, which parts differ: "WRONG (date, time)". Names only. */
export function appointmentVerdict(stop: StopForm, want: ExpectedAppointment): string {
  const score = appointmentScore(stop, want);
  const parts = appointmentDiff(stop, want);
  return parts.length > 0 ? `${score} (${parts.join(', ')})` : score;
}
