/**
 * Step 1 of the real-sample evaluation (docs/llm-reader-design.md §8.2).
 *
 *   npm run ratecon:eval-ai -- --approved=YYYY-MM-DD --files=1,18 [--runs=3] [--pairs]
 *
 * PAID CALLS TO ANTHROPIC, with the approved samples' REDACTED text. Runs
 * only with Alex's written approval: `--approved` is its date, `--files` the
 * sample numbers it names. Everything is checked before the first call — the
 * flags (before the key or any sample is read), the key and model, and every
 * named file: a text layer, prepared without residue, complete ground truth
 * with stops. One file that fails refuses the whole run.
 *
 * The engine is `ratecon-eval.mts`: the app's own path, the ceilings ($1.00
 * and 75 calls, both before each call), and output that is counts and codes
 * only — never a value or a line of text. Nothing is stored.
 *
 * Built and tested in phase 3b-prep with the fake adapter only. Not yet run.
 */
import { z } from 'zod';
import { ReaderSmokeEnv, isIanaZone, report } from '../src/env/schema.ts';
import { readSample, sampleByNumber, sampleFiles, EXPECTED_PATH } from './ratecon-corpus.mts';
import { AnthropicReaderAdapter, MAX_TOKENS, anthropicRequest } from '../src/server/ratecon-reader/anthropic.ts';
import { existsSync, readFileSync } from 'node:fs';
import { ExpectedFile } from './ratecon-expected.mts';
import { CEILINGS, PRICES, barVerdict, boundOfBody, plannedOf, costOf, dayIn, evalFile, parseEvalArgs, planProblem, runEvaluation, type EvalFile } from './ratecon-eval.mts';

/** The route's own limit on a vendor call. */
const TIMEOUT_MS = 25_000;

function refuse(why: string): never {
  console.error(`ratecon:eval-ai refused: ${why}`);
  process.exit(2);
}

const localToday = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const parsed = parseEvalArgs(process.argv.slice(2), localToday);
if (!parsed.ok) refuse(parsed.why);
const { args } = parsed;

const env = ReaderSmokeEnv.safeParse(process.env);
if (!env.success) refuse(`\n${report('ratecon eval', env.error)}`);
const model = env.data.LLM_READER_MODEL;
const price = PRICES[model];
const tz = z.string().refine(isIanaZone).default('America/Chicago').safeParse(process.env.DISPATCH_TZ);
if (!tz.success) refuse('DISPATCH_TZ is not a valid IANA zone');

const names = sampleFiles();
if (names.length === 0) refuse('no .samples/rate-confirmations/ here');
if (!existsSync(EXPECTED_PATH)) refuse('no expected.json: the ground truth');
const expected = ExpectedFile.safeParse(JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')));
if (!expected.success) refuse('expected.json is not the right shape (npm run ratecon:check-expected)');

const files: EvalFile[] = [];
for (const n of args.files) {
  const name = sampleByNumber(names, n);
  if (name === null) refuse(`sample ${n}: no such sample`);
  const pdf = await readSample(name);
  const ready = evalFile(n, pdf.ok ? pdf.lines : null, expected.data.files[name]);
  if (!ready.ok) refuse(`sample ${n}: ${ready.why}`);
  files.push(ready.file);
}
const plan = { files, runs: args.runs, ceilings: CEILINGS, pairs: args.pairs };
const planned = plannedOf(plan);
const problem = planProblem(plan);
if (problem) refuse(problem);

const bound = (request: Parameters<typeof anthropicRequest>[0]) => boundOfBody(JSON.stringify(anthropicRequest(request, model)), MAX_TOKENS);
const now = new Date(expected.data.scoredAt);
if (Number.isNaN(now.getTime())) refuse('expected.json scoredAt is not an instant');

console.info(`Approved ${args.approved}. Model ${model}. Samples ${args.files.join(', ')}, ${args.runs} run(s) each${args.pairs ? ', each run a PAIR of reads merged by agreement' : ''}: ${planned.calls} calls.`);
console.info(`Ceilings: ${CEILINGS.calls} calls, $${CEILINGS.dollars.toFixed(2)}, both checked before each call.`);
console.info(`Prices: $${price.inputPerMTok} in, $${price.outputPerMTok} out, per million tokens.`);
const worst = files.reduce((sum, f) => sum + costOf(bound({ lines: f.lines, today: dayIn(tz.data, now) }), price), 0) * args.runs * (args.pairs ? 2 : 1);
console.info(`Most it could cost, at every call's bound: $${worst.toFixed(4)}. Counts and codes only below; nothing is stored.\n`);

const totals = await runEvaluation(plan, {
  adapter: new AnthropicReaderAdapter({ apiKey: env.data.LLM_READER_API_KEY, model }),
  price,
  bound,
  now,
  tz: tz.data,
  timeoutMs: TIMEOUT_MS,
  say: (line) => console.info(line),
});
process.exitCode = barVerdict(totals, planned).exitCode;
