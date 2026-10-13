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
