/**
 * §12.122. What `npm run ratecon:score` says, worked out apart from reading
 * the samples so a test holds it (src/test/ratecon-score-lines.test.ts).
 * `ratecon-score.mts` reads, fills and prints; every line it prints is built
 * here. Sample numbers, layout ids, field names and stop numbers only: never
 * a value.
 *
 * A bar field is `pass` when it is right, marked or not; `FAIL (marked)` when
 * it is wrong and the fill's own Check is on it, so a person will look;
 * `FAIL` when it is wrong and unmarked. The stop count has no mark. The
 * appointment scores as `appointmentScore` says (ratecon-expected.mts): only
 * WRONG fails. A sample fails on any FAIL, marked or not; the summary lists
 * apart what nobody would see.
 */
import type { LoadForm, StopForm } from '../src/components/edit/load-form';
import type { LayoutId } from '../src/lib/ratecon/templates';
import { appointmentScore, appointmentVerdict, type ExpectedStop } from './ratecon-expected.mjs';

export type Mark = 'pass' | 'FAIL (marked)' | 'FAIL';

/** Right is `pass`, marked or not. Wrong is `FAIL (marked)` only with a Check on it. */
export function markOf(right: boolean, marked: boolean): Mark {
  if (right) return 'pass';
  return marked ? 'FAIL (marked)' : 'FAIL';
}

/** Each bar field of a stop: its name in the score, the fill's key for its Check, the form's value, the truth's. */
const STOP_FIELDS = [
  ['order + type', 'stopType', (s: StopForm) => s.stopType, (w: ExpectedStop) => w.type],
  ['street', 'addressLine', (s: StopForm) => s.addressLine, (w: ExpectedStop) => w.street],
  ['ZIP', 'zip', (s: StopForm) => s.zip, (w: ExpectedStop) => w.zip],
  ['city', 'city', (s: StopForm) => s.city, (w: ExpectedStop) => w.city],
  ['state', 'state', (s: StopForm) => s.state, (w: ExpectedStop) => w.state],
] as const;

export type AppointmentScore = ReturnType<typeof appointmentScore>;

export interface SampleScore {
  /** The load number and the stop count. */
  load: [name: string, mark: Mark][];
  /** Each stop field, one mark per stop of the ground truth; a stop the fill lacks is `FAIL`. */
  stops: [name: string, marks: Mark[]][];
  /** One per stop of the ground truth; a stop the fill lacks is `WRONG`. */
  appointments: AppointmentScore[];
  /** As printed, with which parts differ: "WRONG (date, time)". */
  appointmentsSaid: string[];
}

/** A filled form against its ground truth. */
export function scoreSample(form: Pick<LoadForm, 'loadNumber' | 'stops' | 'fill'>, want: { loadNumber: string; stops: ExpectedStop[] }): SampleScore {
  const got = form.stops;
  return {
    load: [
      ['load number', markOf(form.loadNumber === want.loadNumber, Boolean(form.fill?.loadNumberCheck))],
      ['stop count', markOf(got.length === want.stops.length, false)],
    ],
    stops: STOP_FIELDS.map(([name, key, value, truth]) => [
      name,
      want.stops.map((w, i) => {
        const s = got[i];
        return s ? markOf(value(s) === truth(w), Boolean(s.fill?.checks[key])) : 'FAIL';
      }),
    ]),
    appointments: want.stops.map((w, i) => {
      const s = got[i];
      return s ? appointmentScore(s, w.appointment) : 'WRONG';
    }),
    appointmentsSaid: want.stops.map((w, i) => {
      const s = got[i];
      return s ? appointmentVerdict(s, w.appointment) : 'WRONG (missing)';
    }),
  };
}

const barMarks = (score: SampleScore): Mark[] => [...score.load.map(([, m]) => m), ...score.stops.flatMap(([, ms]) => ms)];

/** Every bar field right, marked or not. */
export const barRight = (score: SampleScore): boolean => barMarks(score).every((m) => m === 'pass');

/** The sample's own line: `FAIL (marked)` when every wrong bar field is marked and no appointment is WRONG. */
export function sampleMark(score: SampleScore): Mark {
  const marks = barMarks(score);
  if (marks.includes('FAIL') || score.appointments.includes('WRONG')) return 'FAIL';
  return marks.includes('FAIL (marked)') ? 'FAIL (marked)' : 'pass';
}

/** The lines for a sample that was read and filled. */
export function scoredLines(n: number, read: { layout: LayoutId; stops: number; fromScan: boolean }, score: SampleScore): string[] {
  return [
    `sample ${n} (${read.layout}, ${read.stops} stops${read.fromScan ? ', a scan read by OCR' : ''}): ${sampleMark(score)}`,
    ...score.load.map(([name, m]) => `  ${name.padEnd(14)} ${m}`),
    ...score.stops.map(([name, ms]) => `  ${name.padEnd(14)} ${ms.map((m, i) => `stop ${i + 1} ${m}`).join('   ')}`),
    `  ${'appointment'.padEnd(14)} ${score.appointmentsSaid.map((a, i) => `stop ${i + 1} ${a}`).join('   ')}`,
  ];
}

/**
 * Why a sample was not read, from `recognisedLayouts`: `readRatecon` says
 * "not-recognised" for all three.
 */
export function notReadWhy(found: readonly LayoutId[]): string {
  if (found.length === 0) return 'no layout recognised';
  if (found.length === 1) return `recognised as ${found.join(', ')}, refused`;
  return `recognised as ${found.join(', ')}: more than one layout`;
}

/** A sample not read. Priority 1 is ground truth for the AI reader's evaluation, not a template failure. */
export function notReadLine(n: number, found: readonly LayoutId[], aiOnly: boolean): string {
  return aiOnly ? `sample ${n}: ${notReadWhy(found)} — ground truth for the AI evaluation only` : `sample ${n}: FAIL — ${notReadWhy(found)}`;
}

/** A sample whose ground truth says no template reads it. */
export function expectedNotReadLine(n: number, read: LayoutId | null, found: readonly LayoutId[]): string {
  return read === null ? `sample ${n}: ${notReadWhy(found)} — pass (expected: no template reads it)` : `sample ${n}: read as ${read} — FAIL (expected: no template reads it)`;
}

/** A sample that fails before a field is scored, as the summary names it. */
export type SampleFailure = 'ground truth wrong shape' | 'PDF not read' | 'read, expected not' | 'not read' | 'fill refused';

export interface Tally {
  /** Samples with every bar field right, and samples held to the bar. */
  bar: number;
  barOf: number;
  /** Samples that fail, marked or not: any makes the exit code 1. */
  failed: number;
  /** Wrong and not marked, appointments apart: "sample 12 street stop 1", "sample 19 not read". */
  unmarked: string[];
  /** WRONG appointments: "sample 12 stop 2". */
  appointments: string[];
}

export const newTally = (): Tally => ({ bar: 0, barOf: 0, failed: 0, unmarked: [], appointments: [] });

/** A sample that fails before a field is scored. `onBar`: it was held to the bar. */
export function tallyFailed(t: Tally, n: number, failure: SampleFailure, onBar: boolean): void {
  if (onBar) t.barOf += 1;
  t.failed += 1;
  t.unmarked.push(`sample ${n} ${failure}`);
}

/** A sample read, filled and scored. */
export function tallyScored(t: Tally, n: number, score: SampleScore): void {
  t.barOf += 1;
  if (barRight(score)) t.bar += 1;
  if (sampleMark(score) !== 'pass') t.failed += 1;
  for (const [name, m] of score.load) if (m === 'FAIL') t.unmarked.push(`sample ${n} ${name}`);
  for (const [name, ms] of score.stops) {
    for (const [i, m] of ms.entries()) if (m === 'FAIL') t.unmarked.push(`sample ${n} ${name} stop ${i + 1}`);
  }
  for (const [i, a] of score.appointments.entries()) if (a === 'WRONG') t.appointments.push(`sample ${n} stop ${i + 1}`);
}

const listOrNone = (items: string[]) => (items.length === 0 ? 'none' : `${items.length}: ${items.join(', ')}`);

/** The last lines. */
export function summaryLines(t: Tally): string[] {
  return [
    `The bar (load number, stop count, order and type, street, ZIP, city, state all exact): ${t.bar} of ${t.barOf}`,
    `Wrong and not marked: ${listOrNone(t.unmarked)}`,
    `Appointments silently wrong: ${listOrNone(t.appointments)}`,
  ];
}
