/**
 * The real-sample evaluation's engine (docs/llm-reader-design.md §8.2, step
 * 1). `scripts/ratecon-eval-ai.mts` is the command; this is everything it
 * does that a test can run with the FAKE adapter and invented documents.
 *
 * The path is the app's: `prepareForReading` (in the browser), the adapter
 * with the request the route builds (`n` and `text` only, today in the
 * dispatch zone), `ModelRead`, `verifyRead` against exactly the lines sent,
 * then `fillLoad` into an empty form. Nothing is stored: each reply is scored
 * in memory and dropped.
 *
 * Output goes through `say`, and it is COUNTS AND CODES ONLY: a sample's
 * number, an outcome code, tokens, cost, and per field a status and a score.
 * Never a value, a quote, a file name or a line of text — right or wrong.
 *
 * Two ceilings, both checked BEFORE each call: the number of calls, and the
 * dollars spent so far (measured tokens × the price constants) plus the most
 * the next call can cost. That most is an upper bound, not a guess: input
 * tokens at most the request's UTF-8 bytes plus a fixed margin (a token is at
 * least one byte), output at most the adapter's `max_tokens`. If a reply ever
 * bills more input than its bound, the run stops: the bound was wrong.
 */
import { fillLoad } from '../src/components/edit/ratecon-fill';
import { loadFormFrom, type LoadForm, type StopForm } from '../src/components/edit/load-form';
import { uncitedAddressLines } from '../src/lib/ratecon/address-cue';
import { agreeReads, type Agreement } from '../src/lib/ratecon/agree-reads';
import { ModelRead } from '../src/lib/ratecon/model-read';
import { prepareForReading, type PreparedLine } from '../src/lib/ratecon/redact';
import type { Line } from '../src/lib/ratecon/lines';
import type { RateconRead } from '../src/lib/ratecon/templates';
import { verifyRead, type Verified } from '../src/lib/ratecon/verify-read';
import type { AdapterFailure, AdapterUsage, ReaderAdapter, ReaderRequest } from '../src/server/ratecon-reader/adapter';
import { appointmentVerdict, inspect, type ExpectedStop } from './ratecon-expected.mjs';

/**
 * Per million tokens, in US dollars. Source: Anthropic's model table as the
 * claude-api reference gives it (cached 2026-10-06), read 2026-10-14. Haiku
 * 5.5's prices hold for prompts up to 100K tokens; a call whose input bound
 * passes that is refused, so the higher tier is never needed.
 */
export const PRICES = {
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5, maxInputTokens: 100_000 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, maxInputTokens: 1_000_000 },
} as const;
export type PricedModel = keyof typeof PRICES;
export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
  maxInputTokens: number;
}

/** Alex's ceilings (HANDOFF, "What Alex must approve before step 1"). */
export const CEILINGS = { dollars: 1.0, calls: 75 } as const;
export const DEFAULT_RUNS = 3;

/** The most a call can bill: input from the request's bytes, output from the adapter's `max_tokens`. */
export type Bound = (request: ReaderRequest) => AdapterUsage;

/**
 * Tokens the vendor may add around what is sent (role and format markers,
 * the structured-output scaffolding). Generous: the 2b smoke call sent a
 * 5,470-byte body and was billed 3,117 input tokens.
 */
export const INPUT_MARGIN_TOKENS = 2_000;

/** A request body's bound: a token is at least one byte, so its UTF-8 bytes plus the margin; output at `max_tokens`. */
export function boundOfBody(body: string, maxTokens: number): AdapterUsage {
  return { inputTokens: Buffer.byteLength(body, 'utf8') + INPUT_MARGIN_TOKENS, outputTokens: maxTokens };
}

export const costOf = (usage: AdapterUsage, price: Price) =>
  (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;

/* ------------------------------- the files ------------------------------- */

export interface EvalFile {
  n: number;
  lines: PreparedLine[];
  want: { loadNumber: string; stops: ExpectedStop[] };
}

/** Why a named file cannot be evaluated; checked for every file before the first call. */
export type Ineligible = 'not-text' | 'not-prepared' | 'no-ground-truth' | 'ground-truth-incomplete' | 'ground-truth-wrong-shape' | 'no-stops-in-ground-truth';

/** A sample made ready: its lines prepared exactly as the browser would, and its ground truth complete with stops. */
export function evalFile(n: number, lines: readonly Line[] | null, entry: unknown): { ok: true; file: EvalFile } | { ok: false; why: Ineligible } {
  if (lines === null) return { ok: false, why: 'not-text' };
  if (entry === undefined) return { ok: false, why: 'no-ground-truth' };
  const inspected = inspect(entry);
  if (inspected.state === 'incomplete') return { ok: false, why: 'ground-truth-incomplete' };
  if (inspected.state === 'invalid') return { ok: false, why: 'ground-truth-wrong-shape' };
  if ('notRecognised' in inspected.entry) return { ok: false, why: 'no-stops-in-ground-truth' };
  const prepared = prepareForReading(lines);
  if (!prepared.ok) return { ok: false, why: 'not-prepared' };
  return { ok: true, file: { n, lines: prepared.lines, want: inspected.entry } };
}

/* -------------------------------- scoring -------------------------------- */

export type Status = 'verified' | 'blank-and-marked' | 'filled-and-marked' | 'blank-unmarked';
export type Score = 'exact' | 'marked' | 'WRONG';

/**
 * One field: what the fill did, and how that stands against the ground truth.
 * WRONG is filled, unmarked, and not what the PDF says — the one a dispatcher
 * would not see. A blank with no mark is WRONG too unless the truth is blank:
 * it should not happen, and the bar must not pass it if it does.
 */
export function scoreField(value: string, check: string | null | undefined, truth: string): { status: Status; score: Score } {
  if (check) return { status: value === '' ? 'blank-and-marked' : 'filled-and-marked', score: 'marked' };
  if (value === '') return { status: 'blank-unmarked', score: truth === '' ? 'exact' : 'WRONG' };
  return { status: 'verified', score: value === truth ? 'exact' : 'WRONG' };
}

/** The fields the bar is held on (design §8.2): zero WRONG on each. */
export const BAR_FIELDS = ['load number', 'stop count', 'order + type', 'street', 'ZIP', 'city', 'state'] as const;
export type BarField = (typeof BAR_FIELDS)[number];

const STOP_FIELDS = [
  ['order + type', (s: StopForm) => s.stopType, 'stopType', (w: ExpectedStop) => w.type],
  ['street', (s: StopForm) => s.addressLine, 'addressLine', (w: ExpectedStop) => w.street],
  ['ZIP', (s: StopForm) => s.zip, 'zip', (w: ExpectedStop) => w.zip],
  ['city', (s: StopForm) => s.city, 'city', (w: ExpectedStop) => w.city],
  ['state', (s: StopForm) => s.state, 'state', (w: ExpectedStop) => w.state],
] as const;

/* --------------------------------- a run --------------------------------- */

export type Outcome = 'ok' | 'invalid_output' | 'nothing_confirmed' | 'fill_refused' | AdapterFailure;

export interface EvalDeps {
  adapter: ReaderAdapter;
  price: Price;
  bound: Bound;
  /** The ground truth's instant (`expected.json`'s `scoredAt`): the verifier's and the fill's "now", as `ratecon:score` uses it. */
  now: Date;
  /** The dispatch zone, for the request's "today" — as the route computes it. */
  tz: string;
  timeoutMs: number;
  say: (line: string) => void;
}

export interface EvalPlan {
  files: EvalFile[];
  runs: number;
  ceilings: { dollars: number; calls: number };
  /** Two calls a run, in parallel, merged by `agreeReads` before scoring. Off by default. */
  pairs?: boolean;
}

/** Runs and calls the plan makes: a pair is one run of two calls. */
export const plannedOf = (plan: EvalPlan) => {
  const runs = plan.files.length * plan.runs;
  return { runs, calls: runs * (plan.pairs ? 2 : 1) };
};

export interface EvalTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  dollars: number;
  /** Why the run ended early, or null when every planned call was made. */
  stopped: null | 'call-ceiling' | 'dollar-ceiling' | 'input-over-bound' | 'vendor-capped';
  wrong: Record<BarField, number>;
  /** Runs that reached the fill and were scored. */
  scored: number;
  /** Scored runs on which the dropped-stop cue would have fired (`address-cue.ts`). */
  cueFired: number;
  /** With `--pairs`: how the pairs went, and read A's own WRONGs, so a run shows whether agreement removed one. */
  pairs: { agreed: number; differed: number; wrongReadA: Record<BarField, number> };
}

export const dayIn = (tz: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const usd = (n: number) => `$${n.toFixed(4)}`;
const pad = (s: string) => s.padEnd(13);

/**
 * The run's verdict, and the command's exit code: 0 ONLY when every planned
 * call was made and scored and nothing on the bar is WRONG. A WRONG is
 * `not-met`; anything short of every run scored is `incomplete`.
 */
export function barVerdict(totals: EvalTotals, planned: { runs: number; calls: number }): { verdict: 'met' | 'not-met' | 'incomplete'; exitCode: 0 | 1 } {
  if (BAR_FIELDS.some((f) => totals.wrong[f] > 0)) return { verdict: 'not-met', exitCode: 1 };
  if (totals.stopped !== null || totals.calls < planned.calls || totals.scored < planned.runs) return { verdict: 'incomplete', exitCode: 1 };
  return { verdict: 'met', exitCode: 0 };
}

/** Refused before any call: more calls than the ceiling allows. */
export function planProblem(plan: EvalPlan): string | null {
  if (plan.files.length === 0) return 'no files';
  if (!Number.isInteger(plan.runs) || plan.runs < 1) return 'runs must be a whole number, 1 or more';
  const { calls } = plannedOf(plan);
  if (calls > plan.ceilings.calls) return `${calls} calls planned, over the ceiling of ${plan.ceilings.calls}`;
  return null;
}

/** Score one filled reply against its file's ground truth; print it; add its WRONGs to the totals. */
function scoreRun(file: EvalFile, form: { loadNumber: string; loadNumberCheck: string | null; stops: StopForm[] }, wrong: Record<BarField, number>, say: (l: string) => void) {
  const load = scoreField(form.loadNumber, form.loadNumberCheck, file.want.loadNumber);
  if (load.score === 'WRONG') wrong['load number'] += 1;
  say(`  ${pad('load number')} ${load.status} · ${load.score}`);

  const count = form.stops.length === file.want.stops.length ? 'exact' : 'WRONG';
  if (count === 'WRONG') wrong['stop count'] += 1;
  say(`  ${pad('stop count')} ${form.stops.length} read, ${file.want.stops.length} expected · ${count}`);

  file.want.stops.forEach((w, i) => {
    const got = form.stops[i];
    if (!got) {
      say(`  ${pad(`stop ${i + 1}`)} missing`);
      return;
    }
    const parts = STOP_FIELDS.map(([name, value, key, truth]) => {
      const r = scoreField(value(got), got.fill?.checks[key], truth(w));
      if (r.score === 'WRONG') wrong[name] += 1;
      return `${name} ${r.status} ${r.score}`;
    });
    parts.push(`appointment ${appointmentVerdict(got, w.appointment)}`);
    say(`  ${pad(`stop ${i + 1}`)} ${parts.join(' · ')}`);
  });
}

/**
 * Every planned call, in rounds (run 1 of every file, then run 2…), so a
 * ceiling that stops it early still leaves each file a run. Never throws on
 * a reply: every outcome is a code.
 */
export async function runEvaluation(plan: EvalPlan, deps: EvalDeps): Promise<EvalTotals> {
  const { say, price } = deps;
  const zeroWrong = () => Object.fromEntries(BAR_FIELDS.map((f) => [f, 0])) as Record<BarField, number>;
  const totals: EvalTotals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    dollars: 0,
    stopped: null,
    wrong: zeroWrong(),
    scored: 0,
    cueFired: 0,
    pairs: { agreed: 0, differed: 0, wrongReadA: zeroWrong() },
  };
  const today = dayIn(deps.tz, deps.now);
  const nowIso = deps.now.toISOString();
  const perRun = plan.pairs ? 2 : 1;
  const fill = (read: RateconRead) => fillLoad(loadFormFrom(null, nowIso, null), read, nowIso, deps.now);
  const scored = (form: LoadForm) => ({ loadNumber: form.loadNumber, loadNumberCheck: form.fill?.loadNumberCheck ?? null, stops: form.stops });
  const sayCue = (uncited: number[]) => {
    if (uncited.length > 0) totals.cueFired += 1;
    say(
      uncited.length === 0
        ? `  ${pad('address cue')} silent: 0 uncited address-like lines`
        : `  ${pad('address cue')} would fire: ${uncited.length} uncited address-like ${uncited.length === 1 ? 'line' : 'lines'}: ${uncited.map((n) => `L${n}`).join(', ')}`,
    );
  };

  rounds: for (let run = 1; run <= plan.runs; run += 1) {
    for (const file of plan.files) {
      const request: ReaderRequest = { lines: file.lines.map(({ n, text }) => ({ n, text })), today };
      const bound = deps.bound(request);
      // Both ceilings, BEFORE the call — or the pair: a pair is two calls.
      if (totals.calls + perRun > plan.ceilings.calls) {
        totals.stopped = 'call-ceiling';
        break rounds;
      }
      if (bound.inputTokens > price.maxInputTokens || totals.dollars + perRun * costOf(bound, price) > plan.ceilings.dollars) {
        totals.stopped = 'dollar-ceiling';
        break rounds;
      }

      totals.calls += perRun;
      const reads = await Promise.all(Array.from({ length: perRun }, () => readOnce(request, bound, file, deps)));
      const usage = reads.reduce((u, r) => ({ inputTokens: u.inputTokens + r.usage.inputTokens, outputTokens: u.outputTokens + r.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
      const cost = costOf(usage, price);
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.dollars += cost;
      const counted = reads.every((r) => r.reported) ? '' : reads.length === 1 ? 'not reported, counted at its bound ' : 'some not reported, counted at the bound ';
      const billed = `${perRun === 2 ? '2 calls, ' : ''}${counted}${usage.inputTokens} in / ${usage.outputTokens} out`;
      const head = (outcome: string, extra = '') => say(`sample ${file.n} run ${run}: ${outcome}${extra} · tokens ${billed} · ${usd(cost)}`);
      const codes = () => reads.map((r, k) => `${k === 0 ? 'A' : 'B'} ${r.code}`).join(', ');

      if (reads.some((r) => r.overBound)) {
        head(perRun === 1 ? reads[0]!.code : `pair (${codes()})`);
        totals.stopped = 'input-over-bound';
        break rounds;
      }
      if (reads.some((r) => r.code === 'vendor_capped')) {
        head(perRun === 1 ? 'vendor_capped' : `pair_incomplete (${codes()})`, perRun === 1 && reads[0]!.vendorStatus !== null ? ` (HTTP ${reads[0]!.vendorStatus})` : '');
        totals.stopped = 'vendor-capped';
        break rounds;
      }

      if (perRun === 1) {
        const [only] = reads as [ReadOnce];
        if (only.verified === null || only.reply === null) {
          head(only.code, only.vendorStatus === null ? '' : ` (HTTP ${only.vendorStatus})`);
          continue;
        }
        const filled = fill(only.verified.read);
        if (!filled.ok) {
          head('fill_refused');
          continue;
        }
        head('ok', ` · ${only.verified.confirmed} values stood, ${only.verified.unconfirmed} did not`);
        totals.scored += 1;
        scoreRun(file, scored(filled.form), totals.wrong, say);
        // The strip's cue, as the app computes it: line numbers only.
        sayCue(uncitedAddressLines(only.reply, file.lines));
        continue;
      }

      // A pair: both reads must verify, or the run is not scored.
      const [a, b] = reads as [ReadOnce, ReadOnce];
      if (a.verified === null || b.verified === null || a.reply === null || b.reply === null) {
        head(`pair_incomplete (${codes()})`);
        continue;
      }
      const agreement = agreeReads(a.verified.read, b.verified.read);
      const filled = fill(agreement.read);
      const aloneA = fill(a.verified.read);
      if (!filled.ok || !aloneA.ok) {
        head('fill_refused');
        continue;
      }
      head('ok', ` · A ${a.verified.confirmed} values stood, ${a.verified.unconfirmed} did not; B ${b.verified.confirmed} stood, ${b.verified.unconfirmed} did not`);
      totals.scored += 1;
      say(`  ${pairSaid(agreement)}`);
      if (agreement.stopCounts === null && agreement.differed.length === 0) totals.pairs.agreed += 1;
      else totals.pairs.differed += 1;
      scoreRun(file, scored(filled.form), totals.wrong, say);
      const wrongA = zeroWrong();
      scoreRun(file, scored(aloneA.form), wrongA, () => undefined);
      for (const f of BAR_FIELDS) totals.pairs.wrongReadA[f] += wrongA[f];
      const nA = BAR_FIELDS.reduce((n, f) => n + wrongA[f], 0);
      say(`  read A alone: ${nA} WRONG on the bar`);
      // A line either read cited is used.
      const citedByB = new Set(uncitedAddressLines(b.reply, file.lines));
      sayCue(uncitedAddressLines(a.reply, file.lines).filter((n) => citedByB.has(n)));
    }
  }

  const planned = plannedOf(plan);
  say('');
  if (totals.stopped !== null) say(`STOPPED EARLY: ${totals.stopped}.`);
  say(`Calls: ${totals.calls} of ${planned.calls} planned (ceiling ${plan.ceilings.calls}).`);
  say(`Tokens: ${totals.inputTokens} in, ${totals.outputTokens} out. Cost: ${usd(totals.dollars)} (ceiling ${usd(plan.ceilings.dollars)}).`);
  say(`Runs scored: ${totals.scored}.`);
  say(`Address cue: would fire on ${totals.cueFired} of ${totals.scored} scored runs.`);
  if (plan.pairs) {
    say(`Pairs: ${totals.pairs.agreed} agreed, ${totals.pairs.differed} differed.`);
    const a = BAR_FIELDS.reduce((n, f) => n + totals.pairs.wrongReadA[f], 0);
    say(`Read A alone, WRONG on the bar's fields: ${BAR_FIELDS.map((f) => `${f} ${totals.pairs.wrongReadA[f]}`).join(', ')} (${a} in all).`);
  }
  say(`WRONG on the bar's fields${plan.pairs ? ', merged' : ''}: ${BAR_FIELDS.map((f) => `${f} ${totals.wrong[f]}`).join(', ')}.`);
  const wrong = BAR_FIELDS.reduce((n, f) => n + totals.wrong[f], 0);
  const { verdict } = barVerdict(totals, planned);
  say(
    verdict === 'not-met'
      ? `The bar: NOT met (${wrong} WRONG). The reader stays off.`
      : verdict === 'incomplete'
        ? 'The bar: no WRONG in what was scored, but not every planned run was scored. Not a pass.'
        : 'The bar: met — zero WRONG on load number, stop count, order and type, street, ZIP, city and state.',
  );
  return totals;
}

/** "pair: agree", or "pair: differ (stop count 2/1; fields that differed: street x1, appointment x1)". Counts and names only. */
export function pairSaid(agreement: Agreement): string {
  if (agreement.stopCounts === null && agreement.differed.length === 0) return 'pair: agree';
  const parts: string[] = [];
  if (agreement.stopCounts) parts.push(`stop count ${agreement.stopCounts.a}/${agreement.stopCounts.b}`);
  if (agreement.differed.length > 0) {
    const counts = new Map<string, number>();
    for (const d of agreement.differed) counts.set(d.field, (counts.get(d.field) ?? 0) + 1);
    parts.push(`fields that differed: ${[...counts].map(([f, n]) => `${f} x${n}`).join(', ')}`);
  }
  return `pair: differ (${parts.join('; ')})`;
}

interface ReadOnce {
  code: Outcome;
  vendorStatus: number | null;
  /** Billed, or the bound when the vendor reported nothing. */
  usage: AdapterUsage;
  reported: boolean;
  overBound: boolean;
  reply: ModelRead | null;
  verified: Extract<Verified, { ok: true }> | null;
}

/** One call, then the route's check and the browser's: the schema, then the verifier against exactly what was sent. */
async function readOnce(request: ReaderRequest, bound: AdapterUsage, file: EvalFile, deps: EvalDeps): Promise<ReadOnce> {
  const result = await deps.adapter.read(request, AbortSignal.timeout(deps.timeoutMs));
  const base = {
    vendorStatus: result.ok ? null : result.vendorStatus,
    // A failure with no usage may still have been billed: count the most it could have been.
    usage: result.usage ?? bound,
    reported: result.usage !== undefined,
    overBound: result.usage !== undefined && result.usage.inputTokens > bound.inputTokens,
    reply: null,
    verified: null,
  };
  if (!result.ok) return { ...base, code: result.code };
  const parsed = ModelRead.safeParse(result.output);
  if (!parsed.success) return { ...base, code: 'invalid_output' };
  const verified = verifyRead(parsed.data, file.lines, deps.now);
  if (!verified.ok) return { ...base, code: 'nothing_confirmed' };
  return { ...base, code: 'ok', reply: parsed.data, verified };
}

/* ----------------------------- the command line ----------------------------- */

export interface EvalArgs {
  approved: string;
  files: number[];
  runs: number;
  /** `--pairs`: two calls a run, merged by agreement. */
  pairs: boolean;
}

const realDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return at.toISOString().slice(0, 10) === iso;
};

/**
 * The flags, or why they refuse. `--approved=YYYY-MM-DD` is the date of
 * Alex's written approval: a real date, not after `today`. `--files=` the
 * sample numbers, comma-separated. `--runs=` optional, 3 by default.
 * `--pairs` optional: each run is two calls, merged by agreement.
 */
export function parseEvalArgs(argv: readonly string[], today: string): { ok: true; args: EvalArgs } | { ok: false; why: string } {
  const flags = new Map<string, string>();
  let pairs = false;
  for (const arg of argv) {
    if (arg === '--pairs') {
      if (pairs) return { ok: false, why: '--pairs given twice' };
      pairs = true;
      continue;
    }
    const m = /^--(approved|files|runs)=(.*)$/.exec(arg);
    if (!m) return { ok: false, why: `unknown argument (allowed: --approved=YYYY-MM-DD --files=<numbers> [--runs=<n>] [--pairs])` };
    if (flags.has(m[1]!)) return { ok: false, why: `--${m[1]} given twice` };
    flags.set(m[1]!, m[2]!);
  }
  const approved = flags.get('approved');
  if (approved === undefined) return { ok: false, why: 'no --approved=YYYY-MM-DD: the date of Alex’s written approval of step 1' };
  if (!realDate(approved)) return { ok: false, why: '--approved must be a real date, YYYY-MM-DD' };
  if (approved > today) return { ok: false, why: '--approved is after today' };
  const list = flags.get('files');
  if (list === undefined) return { ok: false, why: 'no --files=<numbers>: name the approved samples, e.g. --files=1,18' };
  const files = list.split(',').map((s) => s.trim());
  if (files.some((s) => !/^[1-9]\d*$/.test(s))) return { ok: false, why: '--files must be sample numbers, comma-separated' };
  const numbers = files.map(Number);
  if (new Set(numbers).size !== numbers.length) return { ok: false, why: '--files names a sample twice' };
  const runsFlag = flags.get('runs');
  if (runsFlag !== undefined && !/^[1-9]\d*$/.test(runsFlag)) return { ok: false, why: '--runs must be a whole number, 1 or more' };
  return { ok: true, args: { approved, files: numbers, runs: runsFlag === undefined ? DEFAULT_RUNS : Number(runsFlag), pairs } };
}
