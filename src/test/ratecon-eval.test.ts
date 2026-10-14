import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { prepareForReading } from '@/lib/ratecon/redact';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT, pdfLine } from '@/test/model-read-fixtures';
import type { FakeStep } from '@/server/ratecon-reader/fake';
import {
  BAR_FIELDS,
  CEILINGS,
  INPUT_MARGIN_TOKENS,
  barVerdict,
  boundOfBody,
  evalFile,
  parseEvalArgs,
  planProblem,
  runEvaluation,
  scoreField,
  type EvalDeps,
  type EvalTotals,
  type EvalFile,
  type EvalPlan,
} from '../../scripts/ratecon-eval.mjs';

vi.mock('server-only', () => ({}));
const { FakeReaderAdapter } = await import('@/server/ratecon-reader/fake');

/**
 * `npm run ratecon:eval-ai` (docs/llm-reader-design.md §8.2, step 1), tested
 * with the FAKE adapter and INVENTED documents and ground truth only. No test
 * here reads a sample, a key, or the network.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const NOW = new Date('2026-10-13T15:00:00Z');

/** Invented ground truth for UNKNOWN_LAYOUT, as `expected.json` would hold it. */
const WANT = {
  loadNumber: 'EX-40417',
  stops: [
    { type: 'PU', street: '4001 Main St', city: 'Fargo', state: 'ND', zip: '58102', appointment: { type: 'APPT', date: '2026-10-14', time: '08:00', windowMinutes: 120 } },
    { type: 'DEL', street: '220 Harbor Rd', city: 'Duluth', state: 'MN', zip: '55802', appointment: { couldntRead: true, date: '' } },
  ],
};

function file(want: unknown = WANT, n = 7): EvalFile {
  const ready = evalFile(n, UNKNOWN_LAYOUT, want);
  if (!ready.ok) throw new Error(ready.why);
  return ready.file;
}

const USAGE = { inputTokens: 3000, outputTokens: 1500 };
const OK: FakeStep = { reply: MODEL_REPLY, usage: USAGE };

function harness(steps: FakeStep[], over: Partial<EvalDeps> = {}) {
  const adapter = new FakeReaderAdapter(steps);
  const out: string[] = [];
  const deps: EvalDeps = {
    adapter,
    price: { inputPerMTok: 0.1, outputPerMTok: 0.5, maxInputTokens: 100_000 },
    bound: () => ({ inputTokens: 10_000, outputTokens: 8192 }),
    now: NOW,
    tz: 'America/Chicago',
    timeoutMs: 5_000,
    say: (line) => out.push(line),
    ...over,
  };
  return { adapter, out, deps };
}

const plan = (files: EvalFile[], runs = 1, ceilings: EvalPlan['ceilings'] = CEILINGS): EvalPlan => ({ files, runs, ceilings });

describe('the flags: nothing runs without a written approval date and the files it names', () => {
  const TODAY = '2026-10-14';

  it.each([
    ['no flags at all', [], 'no --approved'],
    ['files but no approval', ['--files=1,18'], 'no --approved'],
    ['an approval but no files', ['--approved=2026-10-14'], 'no --files'],
    ['an approval date that is not a date', ['--approved=2026-02-30', '--files=1'], 'real date'],
    ['an approval date in another form', ['--approved=14/10/2026', '--files=1'], 'real date'],
    ['an approval dated after today', ['--approved=2026-10-15', '--files=1'], 'after today'],
    ['files that are not numbers', ['--approved=2026-10-14', '--files=1,x'], 'sample numbers'],
    ['sample 0', ['--approved=2026-10-14', '--files=0'], 'sample numbers'],
    ['a file named twice', ['--approved=2026-10-14', '--files=1,1'], 'twice'],
    ['runs of zero', ['--approved=2026-10-14', '--files=1', '--runs=0'], 'whole number'],
    ['an unknown flag', ['--approved=2026-10-14', '--files=1', '--live'], 'unknown argument'],
    ['a flag given twice', ['--approved=2026-10-13', '--approved=2026-10-14', '--files=1'], 'twice'],
  ])('refuses %s', (_, argv, why) => {
    const parsed = parseEvalArgs(argv, TODAY);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.why).toContain(why);
  });

  it('takes an approval dated today or before, the files, and 3 runs by default', () => {
    expect(parseEvalArgs(['--approved=2026-10-14', '--files=1,18'], TODAY)).toEqual({
      ok: true,
      args: { approved: '2026-10-14', files: [1, 18], runs: 3, pairs: false },
    });
    expect(parseEvalArgs(['--files=22', '--approved=2026-10-01', '--runs=1'], TODAY)).toMatchObject({ ok: true, args: { runs: 1 } });
  });

  // The command itself, spawned with an environment that has NO key: it must
  // refuse at the flags, before the key, a sample or the adapter is touched.
  const command = (argv: string[]) => {
    try {
      execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'scripts/ratecon-eval-ai.mts', ...argv], {
        cwd: ROOT,
        env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        stdio: 'pipe',
        timeout: 30_000,
      });
      return { code: 0, stderr: '', stdout: '' };
    } catch (error: unknown) {
      const e = error as { status: number; stderr: Buffer; stdout: Buffer };
      return { code: e.status, stderr: e.stderr.toString(), stdout: e.stdout.toString() };
    }
  };

  it('the command refuses with no approval, and says nothing else', () => {
    const run = command(['--files=1']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('refused: no --approved');
    expect(run.stdout).toBe('');
  });

  it('the command refuses with no files', () => {
    expect(command(['--approved=2026-10-14'])).toMatchObject({ code: 2, stderr: expect.stringContaining('no --files') });
  });

  it('with the flags right but no key, the command refuses at the key: no call can be made', () => {
    const run = command(['--approved=2026-10-14', '--files=1']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('LLM_READER_API_KEY');
    expect(run.stdout).toBe('');
  }, 30_000);
});

describe('which files may be evaluated, checked before any call', () => {
  it('a prepared file with complete ground truth', () => {
    const ready = evalFile(7, UNKNOWN_LAYOUT, WANT);
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.file.lines).toEqual((prepareForReading(UNKNOWN_LAYOUT) as { lines: unknown }).lines);
  });

  it.each([
    ['a scan (no text layer)', null, WANT, 'not-text'],
    ['no ground truth', UNKNOWN_LAYOUT, undefined, 'no-ground-truth'],
    ['ground truth still blank in places', UNKNOWN_LAYOUT, { ...WANT, loadNumber: null }, 'ground-truth-incomplete'],
    ['ground truth of the wrong shape', UNKNOWN_LAYOUT, { loadNumber: 'x' }, 'ground-truth-wrong-shape'],
    ['ground truth with no stops', UNKNOWN_LAYOUT, { notRecognised: true }, 'no-stops-in-ground-truth'],
    ['a file the redaction refuses', [pdfLine(1, 'Contact:', 'Dana', 'Q.', 'Example', 'Quill', 'Riley')], WANT, 'not-prepared'],
  ])('refuses %s', (_, lines, want, why) => {
    expect(evalFile(7, lines, want)).toEqual({ ok: false, why });
  });
});

describe('the ceilings, enforced before each call', () => {
  it('plans more calls than the ceiling: refused before any call', () => {
    const f = file();
    expect(planProblem(plan(Array.from({ length: 25 }, () => f), 3))).toBeNull();
    expect(planProblem(plan(Array.from({ length: 26 }, () => f), 3))).toContain('78 calls planned, over the ceiling of 75');
  });

  it('the call ceiling stops the run before the call that would pass it', async () => {
    const { adapter, deps } = harness([OK, OK, OK]);
    const totals = await runEvaluation(plan([file()], 3, { calls: 2, dollars: 1 }), deps);
    expect(adapter.received).toHaveLength(2);
    expect(totals).toMatchObject({ calls: 2, stopped: 'call-ceiling' });
  });

  it('the dollar ceiling stops the run before a call whose most could pass it, and spending never passes it', async () => {
    // Each call's bound costs $0.20 and each bills $0.10: after two, $0.20 + $0.20 > $0.35.
    const billed: FakeStep = { reply: MODEL_REPLY, usage: { inputTokens: 500, outputTokens: 500 } };
    const { adapter, deps } = harness([billed, billed, billed], {
      price: { inputPerMTok: 100, outputPerMTok: 100, maxInputTokens: 100_000 },
      bound: () => ({ inputTokens: 1000, outputTokens: 1000 }),
    });
    const totals = await runEvaluation(plan([file()], 3, { calls: 75, dollars: 0.35 }), deps);
    expect(adapter.received).toHaveLength(2);
    expect(totals.stopped).toBe('dollar-ceiling');
    expect(totals.dollars).toBeCloseTo(0.2, 10);
    expect(totals.dollars).toBeLessThanOrEqual(0.35);
  });

  it('a call whose input bound passes the price tier is never made', async () => {
    const { adapter, deps } = harness([OK], { bound: () => ({ inputTokens: 100_001, outputTokens: 10 }) });
    const totals = await runEvaluation(plan([file()]), deps);
    expect(adapter.received).toHaveLength(0);
    expect(totals.stopped).toBe('dollar-ceiling');
  });

  it('a failure that reports no usage is counted at its bound, not as free', async () => {
    const { deps } = harness([{ fail: 'timeout' }]);
    const totals = await runEvaluation(plan([file()]), deps);
    expect(totals.inputTokens).toBe(10_000);
    expect(totals.outputTokens).toBe(8192);
  });

  it('a reply billed more input than its bound stops the run: the bound was wrong', async () => {
    const { adapter, deps } = harness([{ reply: MODEL_REPLY, usage: { inputTokens: 10_001, outputTokens: 1 } }, OK]);
    const totals = await runEvaluation(plan([file()], 2), deps);
    expect(adapter.received).toHaveLength(1);
    expect(totals.stopped).toBe('input-over-bound');
  });

  it("the vendor's own spending limit stops the run", async () => {
    const { adapter, deps } = harness([{ fail: 'vendor_capped', vendorStatus: 400 }, OK]);
    const totals = await runEvaluation(plan([file()], 2), deps);
    expect(adapter.received).toHaveLength(1);
    expect(totals.stopped).toBe('vendor-capped');
  });

  it("the bound of a body is its UTF-8 bytes plus the margin, and the adapter's max_tokens", () => {
    expect(boundOfBody('abc', 8192)).toEqual({ inputTokens: 3 + INPUT_MARGIN_TOKENS, outputTokens: 8192 });
    expect(boundOfBody('é', 1).inputTokens).toBe(2 + INPUT_MARGIN_TOKENS);
  });
});

describe("the app's path, and the score", () => {
  it('sends the prepared lines as n and text only, and today in the dispatch zone', async () => {
    const { adapter, deps } = harness([OK]);
    await runEvaluation(plan([file()]), deps);
    const sent = (prepareForReading(UNKNOWN_LAYOUT) as { lines: { n: number; text: string }[] }).lines;
    expect(adapter.received).toEqual([{ lines: sent.map(({ n, text }) => ({ n, text })), today: '2026-10-13' }]);
  });

  it('a reply that matches the ground truth: every bar field exact, the bar met', async () => {
    const { out, deps } = harness([OK]);
    const totals = await runEvaluation(plan([file()]), deps);
    expect(totals.scored).toBe(1);
    expect(BAR_FIELDS.every((f) => totals.wrong[f] === 0)).toBe(true);
    expect(out).toContain('  load number   verified · exact');
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('ZIP verified exact');
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('appointment exact');
    expect(out.at(-1)).toMatch(/^The bar: met/);
  });

  it('a verified value that is not what the PDF says is WRONG, and the bar is not met', async () => {
    const want = { ...WANT, stops: [{ ...WANT.stops[0]!, zip: '58103' }, { ...WANT.stops[1]!, city: 'Superior' }] };
    const { out, deps } = harness([OK]);
    const totals = await runEvaluation(plan([file(want)]), deps);
    expect(totals.wrong).toMatchObject({ ZIP: 1, city: 1, street: 0, 'load number': 0 });
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('ZIP verified WRONG');
    expect(out.at(-1)).toBe('The bar: NOT met (2 WRONG). The reader stays off.');
  });

  it('a stop count that differs is WRONG', async () => {
    const want = { ...WANT, stops: [...WANT.stops, WANT.stops[1]!] };
    const { out, deps } = harness([OK]);
    const totals = await runEvaluation(plan([file(want)]), deps);
    expect(totals.wrong['stop count']).toBe(1);
    expect(out).toContain('  stop 3        missing');
  });

  it('a value the verifier refuses is blank and marked, never WRONG', async () => {
    const reply = structuredClone(MODEL_REPLY);
    reply.stops[0]!.zip = { value: '58109', quote: { line: 13, text: 'Fargo, ND 58102' } };
    const { out, deps } = harness([{ reply, usage: USAGE }]);
    const totals = await runEvaluation(plan([file()]), deps);
    expect(totals.wrong.ZIP).toBe(0);
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('ZIP blank-and-marked marked');
  });

  it('outcomes that never reach the fill are codes, and the bar is not called a pass', async () => {
    const { out, deps } = harness([{ reply: { junk: true } }, { fail: 'refused', usage: USAGE }, { fail: 'unavailable', vendorStatus: 503 }]);
    const totals = await runEvaluation(plan([file()], 3), deps);
    expect(totals.scored).toBe(0);
    expect(out.filter((l) => l.startsWith('sample 7 run')).map((l) => l.split(' · ')[0])).toEqual([
      'sample 7 run 1: invalid_output',
      'sample 7 run 2: refused',
      'sample 7 run 3: unavailable (HTTP 503)',
    ]);
    expect(out.at(-1)).toMatch(/not every planned run was scored\. Not a pass\./);
  });

  it.each([
    ['filled, unmarked, right', 'x', null, 'x', 'verified', 'exact'],
    ['filled, unmarked, wrong', 'x', null, 'y', 'verified', 'WRONG'],
    ['filled and marked', 'x', 'Check it.', 'y', 'filled-and-marked', 'marked'],
    ['blank and marked', '', 'Not found in the PDF.', 'y', 'blank-and-marked', 'marked'],
    ['blank, unmarked, and the truth is blank', '', null, '', 'blank-unmarked', 'exact'],
    ['blank, unmarked, and the truth is not', '', undefined, 'y', 'blank-unmarked', 'WRONG'],
  ] as const)('scoreField: %s', (_, value, check, truth, status, score) => {
    expect(scoreField(value, check, truth)).toEqual({ status, score });
  });
});

describe('single reads are diagnosed per read too', () => {
  it('read A: its bar WRONGs and its appointment parts, by name', async () => {
    const r = structuredClone(MODEL_REPLY);
    r.stops[0]!.appointment = {
      kind: 'exact',
      date: '2026-10-14',
      time: '08:00',
      flag: 'APPT',
      dateQuote: { line: 14, text: 'Pick up 10/14/2026 0800-1000 APPT' },
      timeQuote: { line: 14, text: '0800-1000' },
    };
    const { out, deps } = harness([OK, { reply: r, usage: USAGE }]);
    await runEvaluation(plan([file()], 2), deps);
    expect(out).toContain('  read A: 0 WRONG on the bar · appointments: stop 1 same, stop 2 same');
    expect(out).toContain('  read A: 0 WRONG on the bar · appointments: stop 1 (window), stop 2 same');
    expect(out.some((l) => l.startsWith('  read B'))).toBe(false);
  });
});

describe('the dropped-stop cue, measured per run', () => {
  it('a full read: silent', async () => {
    const { out, deps } = harness([OK]);
    const totals = await runEvaluation(plan([file()]), deps);
    expect(out).toContain('  address cue   silent: 0 uncited address-like lines');
    expect(totals.cueFired).toBe(0);
  });

  it('a dropped stop: it would fire, with the line numbers', async () => {
    const dropped = { ...MODEL_REPLY, stops: [MODEL_REPLY.stops[0]!] };
    const { out, deps } = harness([{ reply: dropped, usage: USAGE }, OK]);
    const totals = await runEvaluation(plan([file()], 2), deps);
    expect(out).toContain('  address cue   would fire: 1 uncited address-like line: L18');
    expect(totals.cueFired).toBe(1);
    expect(out).toContain('Address cue: would fire on 1 of 2 scored runs.');
  });
});

describe('the output: counts and codes, never a value or a line of text', () => {
  it('prints no value, quote, sentinel or ground truth, through every kind of outcome', async () => {
    const wrongWant = { ...WANT, loadNumber: 'EX-99417', stops: [{ ...WANT.stops[0]!, street: '9 Elm Example Ave', zip: '58103' }, WANT.stops[1]!] };
    const leaky = structuredClone(MODEL_REPLY);
    leaky.stops[0]!.street = { value: `4001 Main St ${SENTINEL}`, quote: { line: 12, text: `4001 Main St ${SENTINEL}` } };
    const { out, deps } = harness([
      OK,
      { reply: leaky, usage: USAGE },
      { reply: { loadNumber: SENTINEL } },
      { fail: 'refused', usage: USAGE },
    ]);
    await runEvaluation(plan([file(WANT, 7), file(wrongWant, 8)], 2), deps);
    const all = out.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const text of [
      SENTINEL,
      'EX-40417',
      'EX-99417',
      'Main',
      'Elm',
      'Harbor',
      'Fargo',
      'Duluth',
      '58102',
      '58103',
      '55802',
      'Prairie',
      'Lakeside',
      'Dana',
      'Riley',
      '10/14',
      '2026-10-14',
      '0800',
      'Pick up',
      'Deliver',
      'Load #',
    ]) {
      expect(all).not.toContain(text);
    }
    // Every line is one of the known shapes, so nothing free-form can carry text.
    for (const line of out) {
      expect(line).toMatch(
        /^(|sample \d+ run \d+: [a-z_]+( \(HTTP \d+\))?( · \d+ values stood, \d+ did not)? · tokens .+ · \$\d+\.\d{4}|  (load number|stop count|stop \d+) .+|  read A: \d+ WRONG on the bar · appointments: stop \d+ (same|missing|\([a-z ,-]+\))(, stop \d+ (same|missing|\([a-z ,-]+\)))*|  (read [AB] )?(street|city), stop \d+: [a-z0-9 -]+ \(.+\)|  address cue   (silent: 0 uncited address-like lines|would fire: \d+ uncited address-like lines?: L\d+(, L\d+)*)|STOPPED EARLY: [a-z-]+\.|Calls: .+|Tokens: .+|Runs scored: \d+\.|Address cue: would fire on \d+ of \d+ scored runs\.|WRONG on the bar's fields: .+|The bar: .+)$/,
      );
    }
    for (const line of out.filter((l) => /^ {2}(load number|stop)/.test(l))) {
      expect(line).toMatch(/^ {2}[a-z0-9 ]+?( {2,}| )([a-zA-Z0-9 +·-]|, )+$/);
    }
  });
});

describe('the verdict, and the exit code that follows it', () => {
  const totals = (over: Partial<EvalTotals> = {}): EvalTotals => ({
    calls: 18,
    inputTokens: 0,
    outputTokens: 0,
    dollars: 0,
    stopped: null,
    wrong: Object.fromEntries(BAR_FIELDS.map((f) => [f, 0])) as EvalTotals['wrong'],
    scored: 18,
    cueFired: 0,
    pairs: { agreed: 0, differed: 0, wrongReadA: Object.fromEntries(BAR_FIELDS.map((f) => [f, 0])) as EvalTotals['wrong'], wrongReadB: Object.fromEntries(BAR_FIELDS.map((f) => [f, 0])) as EvalTotals['wrong'] },
    ...over,
  });

  it('met only when every planned run was made and scored, and nothing on the bar is WRONG', () => {
    expect(barVerdict(totals(), { runs: 18, calls: 18 })).toEqual({ verdict: 'met', exitCode: 0 });
  });

  it.each([
    ['a WRONG on the bar', { wrong: { ...totals().wrong, 'stop count': 1 } }, 'not-met'],
    ['a run not scored', { scored: 17 }, 'incomplete'],
    ['a ceiling stopped it', { stopped: 'dollar-ceiling' as const, calls: 10, scored: 10 }, 'incomplete'],
    ['fewer calls than planned', { calls: 17, scored: 17 }, 'incomplete'],
  ])('%s: exit 1', (_, over, verdict) => {
    expect(barVerdict(totals(over), { runs: 18, calls: 18 })).toEqual({ verdict, exitCode: 1 });
  });

  it('the command sets its exit code from the verdict, whatever stopped it or not', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'ratecon-eval-ai.mts'), 'utf8');
    expect(source).toMatch(/process\.exitCode = barVerdict\(totals, [^)]+\)\.exitCode;/);
    expect(source).not.toMatch(/if \(totals\.stopped !== null\) process\.exitCode/);
  });
});

describe('--pairs: two reads a run, merged by agreement', () => {
  const pairs = (files: EvalFile[], runs = 1, ceilings: EvalPlan['ceilings'] = CEILINGS): EvalPlan => ({ files, runs, ceilings, pairs: true });
  const reply = (change: (r: typeof MODEL_REPLY) => void): FakeStep => {
    const r = structuredClone(MODEL_REPLY);
    change(r);
    return { reply: r, usage: USAGE };
  };
  /** Stop 1's street read as stop 2's: in the text, so it verifies, and it differs. */
  const otherStreet = reply((r) => {
    r.stops[0]!.street = { value: '220 Harbor Rd', quote: { line: 17, text: '220 Harbor Rd' } };
  });
  /** Stop 1's appointment as one time, not a range: it verifies, and it differs. */
  const otherAppt = reply((r) => {
    r.stops[0]!.appointment = {
      kind: 'exact',
      date: '2026-10-14',
      time: '08:00',
      flag: 'APPT',
      dateQuote: { line: 14, text: 'Pick up 10/14/2026 0800-1000 APPT' },
      timeQuote: { line: 14, text: '0800-1000' },
    };
  });
  /** Stop 1's ZIP read from stop 2's city line: it verifies, and it is WRONG. */
  const wrongZip = reply((r) => {
    r.stops[0]!.zip = { value: '55802', quote: { line: 18, text: 'Duluth, MN 55802' } };
  });
  const dropped = reply((r) => {
    r.stops = [r.stops[0]!];
  });
  /** A reply none of whose quotes is in the text: `nothing_confirmed`. */
  const NOTHING: FakeStep = {
    reply: { schemaVersion: 1, loadNumber: null, stops: [{ type: { value: 'PU', quote: { line: 1, text: 'not in the text' } }, street: null, city: null, state: null, zip: null, appointment: { kind: 'none' } }] },
    usage: USAGE,
  };

  it('each read on its own: the appointment parts it got wrong, by name, and its bar WRONGs', async () => {
    const { out, deps } = harness([otherAppt, OK]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(out).toContain('  read A: 0 WRONG on the bar · appointments: stop 1 (window), stop 2 same');
    expect(out).toContain('  read B: 0 WRONG on the bar · appointments: stop 1 same, stop 2 same');
    // The merge blanked it: its own diagnosis names every part, which is why the reads are diagnosed apart.
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('appointment marked, filled differently (date, time, window)');
    expect(totals.pairs.wrongReadB).toMatchObject({ ZIP: 0 });
  });

  it("read B's own bar WRONGs are counted too", async () => {
    const { out, deps } = harness([OK, wrongZip]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(out).toContain('  read B: 1 WRONG on the bar · appointments: stop 1 same, stop 2 same');
    expect(totals.pairs.wrongReadB.ZIP).toBe(1);
    expect(totals.pairs.wrongReadA.ZIP).toBe(0);
    expect(out).toContain("Read B alone, WRONG on the bar's fields: load number 0, stop count 0, order + type 0, street 0, ZIP 1, city 0, state 0 (1 in all).");
  });

  it('the flag: --pairs, and off by default', () => {
    expect(parseEvalArgs(['--approved=2026-10-14', '--files=1', '--pairs'], '2026-10-14')).toMatchObject({ ok: true, args: { pairs: true } });
    expect(parseEvalArgs(['--approved=2026-10-14', '--files=1'], '2026-10-14')).toMatchObject({ ok: true, args: { pairs: false } });
    expect(parseEvalArgs(['--approved=2026-10-14', '--files=1', '--pairs', '--pairs'], '2026-10-14')).toMatchObject({ ok: false });
  });

  it('two agreeing reads: two calls, "pair: agree", scored as one run', async () => {
    const { adapter, out, deps } = harness([OK, OK]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(adapter.received).toHaveLength(2);
    expect(adapter.received[0]).toEqual(adapter.received[1]);
    expect(totals).toMatchObject({ calls: 2, scored: 1, pairs: { agreed: 1, differed: 0 } });
    expect(out).toContain('  pair: agree');
    expect(out).toContain('  read A: 0 WRONG on the bar · appointments: stop 1 same, stop 2 same');
    expect(out).toContain('  read B: 0 WRONG on the bar · appointments: stop 1 same, stop 2 same');
    expect(out.at(-1)).toMatch(/^The bar: met/);
    expect(out[0]).toMatch(/^sample 7 run 1: ok · A 10 values stood, 0 did not; B 10 stood, 0 did not · tokens 2 calls, 6000 in \/ 3000 out · \$/);
  });

  it('a street that differs: blanked and marked in the merge, named by field', async () => {
    const { out, deps } = harness([OK, otherStreet]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(out).toContain('  pair: differ (fields that differed: street x1)');
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('street blank-and-marked marked');
    expect(totals.pairs.differed).toBe(1);
  });

  it('an appointment that differs: the whole of it blanked and marked', async () => {
    const { out, deps } = harness([OK, otherAppt]);
    await runEvaluation(pairs([file()]), deps);
    expect(out).toContain('  pair: differ (fields that differed: appointment x1)');
    expect(out.find((l) => l.startsWith('  stop 1'))).toContain('appointment marked, filled differently (date, time, window)');
  });

  it('read A drops a stop and read B does not: the merge has both stops, and read A alone shows the WRONG agreement removed', async () => {
    const { out, deps } = harness([dropped, OK]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(out).toContain('  pair: differ (stop count 1/2)');
    expect(out).toContain('  stop count    2 read, 2 expected · exact');
    expect(out).toContain('  read A: 1 WRONG on the bar · appointments: stop 1 same, stop 2 missing');
    expect(out).toContain('  read B: 0 WRONG on the bar · appointments: stop 1 same, stop 2 same');
    expect(totals.wrong['stop count']).toBe(0);
    expect(totals.pairs.wrongReadA['stop count']).toBe(1);
    expect(out).toContain("Read A alone, WRONG on the bar's fields: load number 0, stop count 1, order + type 0, street 0, ZIP 0, city 0, state 0 (1 in all).");
    expect(out.at(-1)).toMatch(/^The bar: met/);
  });

  it('a WRONG value in one read, right in the other: blank and marked in the merge, not WRONG', async () => {
    const { out, deps } = harness([wrongZip, OK]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(totals.wrong.ZIP).toBe(0);
    expect(totals.pairs.wrongReadA.ZIP).toBe(1);
    expect(out).toContain('  pair: differ (fields that differed: zip x1)');
  });

  it('both reads WRONG the same way: agreement cannot see it, and it stays WRONG', async () => {
    const { deps } = harness([wrongZip, wrongZip]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(totals.wrong.ZIP).toBe(1);
    expect(totals.pairs.agreed).toBe(1);
  });

  it.each([
    ['read B fails at the adapter', [OK, { fail: 'timeout' }], 'timeout (pair: A ok, B timeout)'],
    ['read A fails the schema', [{ reply: { junk: true }, usage: USAGE }, OK], 'invalid_output (pair: A invalid_output, B ok)'],
    ['read B has nothing confirmed', [OK, NOTHING], 'nothing_confirmed (pair: A ok, B nothing_confirmed)'],
    ["both fail: read A's code", [{ fail: 'unavailable', usage: USAGE }, { fail: 'refused', usage: USAGE }], 'unavailable (pair: A unavailable, B refused)'],
  ] as [string, FakeStep[], string][])('a pair where %s FAILS AS A WHOLE with that code, fills nothing, and is not scored', async (_, steps, said) => {
    const { out, deps } = harness(steps);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(totals.scored).toBe(0);
    expect(out[0]!.startsWith(`sample 7 run 1: ${said} · tokens 2 calls`)).toBe(true);
    // Nothing of either read is printed or scored: no per-read line, no field line.
    expect(out.some((l) => /^ {2}(read [AB]|load number|stop)/.test(l))).toBe(false);
    expect(barVerdict(totals, { runs: 1, calls: 2 }).exitCode).toBe(1);
  });

  it('the call ceiling counts calls: a pair that would pass it is not made', async () => {
    const { adapter, deps } = harness([OK, OK, OK, OK]);
    const totals = await runEvaluation(pairs([file()], 2, { calls: 3, dollars: 1 }), deps);
    expect(adapter.received).toHaveLength(2);
    expect(totals.stopped).toBe('call-ceiling');
  });

  it('the dollar ceiling: both calls of the pair at their bound, before the pair', async () => {
    const { adapter, deps } = harness([OK, OK], {
      price: { inputPerMTok: 100, outputPerMTok: 100, maxInputTokens: 100_000 },
      bound: () => ({ inputTokens: 1000, outputTokens: 1000 }),
    });
    // One call's bound is $0.20, a pair's $0.40: over $0.35, so no call is made.
    const totals = await runEvaluation(pairs([file()], 1, { calls: 75, dollars: 0.35 }), deps);
    expect(adapter.received).toHaveLength(0);
    expect(totals.stopped).toBe('dollar-ceiling');
  });

  it('plans: a pair is two calls against the 75', () => {
    const f = file();
    expect(planProblem(pairs(Array.from({ length: 12 }, () => f), 3))).toBeNull();
    expect(planProblem(pairs(Array.from({ length: 13 }, () => f), 3))).toContain('78 calls planned');
  });

  it('prints no value or text, and every line has a known shape', async () => {
    const { out, deps } = harness([OK, OK, OK, otherStreet, dropped, OK, wrongZip, OK, OK, { fail: 'refused', usage: USAGE }]);
    await runEvaluation(pairs([file()], 5), deps);
    const all = out.join('\n');
    for (const text of [SENTINEL, 'EX-40417', 'Main', 'Harbor', 'Fargo', 'Duluth', '58102', '55802', '10/14', '2026-10-14', '0800']) {
      expect(all).not.toContain(text);
    }
    for (const line of out) {
      expect(line).toMatch(
        /^(|sample \d+ run \d+: (ok · A \d+ values stood, \d+ did not; B \d+ stood, \d+ did not|[a-z_]+ \(pair: A [a-z_]+, B [a-z_]+\)) · tokens .+ · \$\d+\.\d{4}|  pair: (agree|differ \((stop count \d+\/\d+)?(; )?(fields that differed: [a-z ]+ x\d+(, [a-z ]+ x\d+)*)?\))|  read [AB]: \d+ WRONG on the bar · appointments: stop \d+ (same|missing|\([a-z ,-]+\))(, stop \d+ (same|missing|\([a-z ,-]+\)))*|  (load number|stop count|stop \d+) .+|  (read [AB] )?(street|city), stop \d+: [a-z0-9 -]+ \(.+\)|  address cue   (silent: 0 uncited address-like lines|would fire: \d+ uncited address-like lines?: L\d+(, L\d+)*)|Calls: .+|Tokens: .+|Runs scored: \d+\.|Address cue: .+|Pairs: \d+ agreed, \d+ differed\.|Read [AB] alone, WRONG on the bar's fields: .+|WRONG on the bar's fields, merged: .+|The bar: .+)$/,
      );
    }
  });
});

describe('how a wrong street or city differs, by code and counts (phase 3o)', () => {
  const pairs = (files: EvalFile[], runs = 1): EvalPlan => ({ files, runs, ceilings: CEILINGS, pairs: true });
  const wantWith = (street: string, city = 'Duluth') => ({
    ...WANT,
    stops: [{ ...WANT.stops[0]!, street }, { ...WANT.stops[1]!, city }],
  });
  const reply = (change: (r: typeof MODEL_REPLY) => void): FakeStep => {
    const r = structuredClone(MODEL_REPLY);
    change(r);
    return { reply: r, usage: USAGE };
  };
  /** Stop 1's street read as stop 2's: in the text, so it verifies, and it differs from stop 1's truth. */
  const otherStreet = reply((r) => {
    r.stops[0]!.street = { value: '220 Harbor Rd', quote: { line: 17, text: '220 Harbor Rd' } };
  });
  const relationLines = (out: string[]) => out.filter((l) => /^ {2}(read [AB] )?(street|city), stop \d+: /.test(l));

  it('a WRONG street and a WRONG city: one line each, right after the stop line, with a code and the two word counts', async () => {
    const { out, deps } = harness([OK]);
    const want = { ...WANT, stops: [{ ...WANT.stops[0]!, street: '4001 Main Street' }, { ...WANT.stops[1]!, city: 'Superior' }] };
    await runEvaluation(plan([file(want)]), deps);
    const at = (prefix: string) => out.findIndex((l) => l.startsWith(prefix));
    expect(out[at('  stop 1') + 1]).toBe('  street, stop 1: different words (1 of 3 words differ; read 3, truth 3)');
    expect(out[at('  stop 2') + 1]).toBe('  city, stop 2: different words (1 of 1 words differ; read 1, truth 1)');
  });

  it('a read with extra words at the end says so, and how many', async () => {
    const { out, deps } = harness([OK]);
    await runEvaluation(plan([file(wantWith('4001 Main'))]), deps);
    expect(relationLines(out)).toEqual(['  street, stop 1: read has 1 extra trailing word (read 3, truth 2)']);
  });

  it('only a WRONG cell gets a line: exact, and blank-and-marked, get none', async () => {
    const { out, deps } = harness([OK]);
    await runEvaluation(plan([file()]), deps);
    expect(relationLines(out)).toEqual([]);

    const unconfirmed = reply((r) => {
      r.stops[0]!.street = { value: '4001 Main St', quote: { line: 1, text: 'not in the text' } };
    });
    const marked = harness([unconfirmed]);
    await runEvaluation(plan([file(wantWith('9 Elm Example Ave'))]), marked.deps);
    expect(marked.out.find((l) => l.startsWith('  stop 1'))).toContain('street blank-and-marked marked');
    expect(relationLines(marked.out)).toEqual([]);
  });

  it('a single read is scored once: its relation is the merged line only, not repeated as a read line', async () => {
    const { out, deps } = harness([OK]);
    await runEvaluation(plan([file(wantWith('4001 Main Street'))]), deps);
    expect(relationLines(out)).toHaveLength(1);
    expect(out.some((l) => /^ {2}read [AB] (street|city)/.test(l))).toBe(false);
  });

  it('--pairs: both reads wrong the same way gives the merged line and a line for each read, after its read line', async () => {
    const { out, deps } = harness([otherStreet, otherStreet]);
    await runEvaluation(pairs([file()]), deps);
    const want = '(3 of 3 words differ; read 3, truth 3)';
    expect(relationLines(out)).toEqual([
      `  street, stop 1: different words ${want.replace(/^/, '')}`,
      `  read A street, stop 1: different words ${want}`,
      `  read B street, stop 1: different words ${want}`,
    ]);
    const readA = out.findIndex((l) => l.startsWith('  read A: '));
    expect(out[readA + 1]).toBe(`  read A street, stop 1: different words ${want}`);
    const readB = out.findIndex((l) => l.startsWith('  read B: '));
    expect(out[readB + 1]).toBe(`  read B street, stop 1: different words ${want}`);
  });

  it('--pairs: one read wrong and the other right is blanked in the merge, so only the wrong read has a line', async () => {
    const { out, deps } = harness([otherStreet, OK]);
    const totals = await runEvaluation(pairs([file()]), deps);
    expect(totals.wrong.street).toBe(0);
    expect(relationLines(out)).toEqual(['  read A street, stop 1: different words (3 of 3 words differ; read 3, truth 3)']);
  });

  it('prints no value, word or sentinel: a value that carries the sentinel is counted, never shown', async () => {
    const leaky = reply((r) => {
      r.stops[0]!.street = { value: `4001 Main St ${SENTINEL}`, quote: { line: 12, text: `4001 Main St ${SENTINEL}` } };
    });
    const { out, deps } = harness([leaky, leaky]);
    await runEvaluation(pairs([file()]), deps);
    expect(relationLines(out)).toEqual([
      '  street, stop 1: read has 1 extra trailing word (read 4, truth 3)',
      '  read A street, stop 1: read has 1 extra trailing word (read 4, truth 3)',
      '  read B street, stop 1: read has 1 extra trailing word (read 4, truth 3)',
    ]);
    const all = out.join('\n');
    for (const text of [SENTINEL, 'Main', 'Harbor', 'Fargo', 'Duluth', 'Elm']) expect(all).not.toContain(text);
    // Every one of the new lines is a code and counts.
    for (const line of relationLines(out)) {
      expect(line).toMatch(/^ {2}(read [AB] )?(street|city), stop \d+: [a-z0-9 -]+ \((\d+ of \d+ words differ; )?read \d+, truth \d+\)$/);
    }
  });

  it('adds lines and changes none: the same run scored against a truth that is right has the same lines but for these', async () => {
    const wrong = harness([OK]);
    await runEvaluation(plan([file(wantWith('4001 Main Street'))]), wrong.deps);
    const right = harness([OK]);
    await runEvaluation(plan([file()]), right.deps);
    const strip = (lines: string[]) => lines.filter((l) => !/^ {2}(read [AB] )?(street|city), stop \d+: /.test(l));
    // Only the lines that say WRONG differ between the two; the number of lines does not.
    expect(strip(wrong.out)).toHaveLength(right.out.length);
  });
});
