import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Did the machine sleep during this run? (2026-10-09)
 *
 * A Mac with its lid closed on battery sleeps however busy it is: the server,
 * the browser and its timers all stop, and the run fails in ways that look
 * like the app — polls that never fire, requests never answered, a suite
 * twice as long. That happened on 2026-10-08 and cost an evening. This says
 * so at the end of the run, so the next one is recognised in a line.
 *
 * Wall-clock time against a clock that STOPS while the machine sleeps. On
 * macOS that is not Node's: `process.hrtime` runs on through sleep there
 * (measured: 192.76 h since boot, the same as the wall clock, on a Mac that
 * had slept for days of it). `CLOCK_UPTIME_RAW` does stop, and the Python
 * that ships with macOS reads it. On Linux, Node's monotonic clock already
 * stops during suspend.
 */

export interface ClockReading {
  /** Date.now(). */
  wallMs: number;
  /** A clock that does not advance while the machine sleeps. */
  awakeMs: number;
}

const FILE = 'test-results/.run-clock.json';

/** Time asleep between two readings: wall time that passed while the awake clock did not. Never negative. */
export function sleptMs(start: ClockReading, end: ClockReading): number {
  return Math.max(0, end.wallMs - start.wallMs - (end.awakeMs - start.awakeMs));
}

/** The line for the end of a run, or the all-clear. Under a minute is noise, not sleep. */
export function sleepLine(start: ClockReading, end: ClockReading): string {
  const minutes = Math.round(sleptMs(start, end) / 60_000);
  return minutes >= 1
    ? `e2e: the Mac slept ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} during this run; failures may be from that.`
    : 'e2e: the machine stayed awake for the whole run.';
}

export function readClock(): ClockReading {
  const wallMs = Date.now();
  if (process.platform === 'darwin') {
    const seconds = execFileSync('python3', ['-I', '-c', 'import time; print(time.clock_gettime(time.CLOCK_UPTIME_RAW))'], {
      encoding: 'utf8',
    });
    return { wallMs, awakeMs: Number(seconds.trim()) * 1000 };
  }
  return { wallMs, awakeMs: Number(process.hrtime.bigint() / 1_000_000n) };
}

/** At the start of a run (global setup). */
export function markRunStart(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(readClock()));
}

/** At the end (global teardown): the line, or why there is none. Never fails the run. */
export function runSleepReport(): string {
  try {
    if (!existsSync(FILE)) return 'e2e: no start reading, so no sleep check for this run.';
    const start = JSON.parse(readFileSync(FILE, 'utf8')) as ClockReading;
    return sleepLine(start, readClock());
  } catch (error) {
    return `e2e: the sleep check could not read the clock (${error instanceof Error ? error.message : 'unknown error'}).`;
  }
}

/**
 * Did macOS run the suite in DarkWake? (phase 3bv; 3bu's found wrong 2)
 *
 * With the lid closed, no external display and `caffeinate -dims`, macOS keeps the run going
 * in DarkWake. Both clocks above keep running, so the sleep line says "awake", while the page
 * runs about 3x slower (3bu: a simple evaluate's median 6.5ms against 2.0ms in full wake) and
 * a timing test can fail for that alone.
 *
 * `pmset -g systemstate` answers in about 13ms and names what the system can do. In full
 * wake on this Mac (2026-11-14) its first line is
 *
 *   Current System Capabilities are: CPU Graphics Audio Network
 *
 * and in DarkWake Graphics is expected to be missing from it. That is UNVERIFIED on this
 * Mac: no lid-closed run has been sampled yet. (`pmset -g log` would say for certain, and
 * takes over two minutes.)
 *
 * Sampled at the start (global setup), once a minute from the runner, and at the end (global
 * teardown), into a file beside the clock reading: setup and teardown share the file, not a
 * module. A sample that cannot be read is counted and named, never taken for full wake.
 * macOS only: elsewhere nothing is sampled and nothing is said.
 */

export interface PowerSample {
  /** Date.now() when pmset was asked. */
  atMs: number;
  /** The process that asked, so a stored run shows which one sampled it. */
  pid: number;
  /** What pmset printed, when it answered. */
  out?: string;
  /** Why it did not answer, when it did not. */
  error?: string;
}

export type PowerReading = { state: 'full' } | { state: 'dark' } | { state: 'unread'; why: string };

const POWER_FILE = 'test-results/.run-power.jsonl';
const PMSET_TIMEOUT_MS = 2_000;
const SAMPLE_EVERY_MS = 60_000;
/** A sample's output is a couple of lines; a long one is cut, not stored whole. */
const OUT_KEPT = 500;
const CAPABILITIES = /^\s*Current System Capabilities are:(.*)$/m;
const MIN_MS = 60_000;

/** One sample: Graphics listed (full), a capabilities line without it (dark), or nothing to read. */
export function readPowerSample(sample: PowerSample): PowerReading {
  if (sample.error !== undefined) return { state: 'unread', why: sample.error };
  const out = sample.out ?? '';
  if (out.trim() === '') return { state: 'unread', why: 'pmset printed nothing' };
  const line = CAPABILITIES.exec(out);
  if (!line) return { state: 'unread', why: 'no capabilities line' };
  return (line[1] ?? '').trim().split(/\s+/).includes('Graphics') ? { state: 'full' } : { state: 'dark' };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A part of the run, in words: "under a minute", "about 1 minute", "about 12 minutes". */
function aboutMinutes(ms: number): string {
  if (ms < MIN_MS) return 'under a minute';
  const m = Math.round(ms / MIN_MS);
  return `about ${m} ${plural(m, 'minute', 'minutes')}`;
}

function runOf(ms: number): string {
  return ms < MIN_MS ? 'a run under a minute long' : `a ${Math.round(ms / MIN_MS)}-minute run`;
}

/** Minutes into the run: "minute 3", "minutes 3 and 4", "minutes 1, 2, 3, 4, 5 and 7 more". */
function minuteList(minutes: readonly number[]): string {
  const head = plural(minutes.length, 'minute', 'minutes');
  const shown = minutes.slice(0, 5);
  const more = minutes.length - shown.length;
  if (more > 0) return `${head} ${shown.join(', ')} and ${more} more`;
  if (shown.length === 1) return `${head} ${shown[0]!}`;
  return `${head} ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]!}`;
}

/**
 * The lines for the end of a run, from every sample it stored and the stored lines that were
 * not a sample at all. Each sample stands for the time halfway to its neighbours, so the dark
 * samples' share is about how long the run had no graphics. A sample that cannot be read
 * stands for nothing: it is named, and counted as neither full wake nor dark.
 */
export function powerLines(stored: readonly PowerSample[], notSamples = 0): string[] {
  const total = stored.length + notSamples;
  if (total === 0) return ['e2e: no power samples for this run, so no DarkWake check.'];
  const samples = [...stored].sort((a, b) => a.atMs - b.atMs);
  const first = samples[0]?.atMs ?? 0;
  const span = (samples[samples.length - 1]?.atMs ?? first) - first;

  let full = 0;
  let dark = 0;
  let darkMs = 0;
  const unread = new Map<string, number[]>();
  samples.forEach((sample, i) => {
    const reading = readPowerSample(sample);
    if (reading.state === 'full') full += 1;
    else if (reading.state === 'dark') {
      dark += 1;
      darkMs += ((samples[i + 1]?.atMs ?? sample.atMs) - (samples[i - 1]?.atMs ?? sample.atMs)) / 2;
    } else {
      unread.set(reading.why, [...(unread.get(reading.why) ?? []), Math.round((sample.atMs - first) / MIN_MS)]);
    }
  });

  const lines: string[] = [];
  const of = `of ${total} power ${plural(total, 'sample', 'samples')}`;
  if (dark > 0) {
    lines.push(
      `e2e: ${dark} ${of} found macOS without graphics (DarkWake), ${aboutMinutes(darkMs)} of ${runOf(span)}: ` +
        'the page runs about 3x slower there, so timing failures may be from that.',
    );
  } else if (full > 0) {
    const which =
      full < total ? `${full} ${of}, every one that could be read` : total === 1 ? 'the one power sample' : `all ${total} power samples`;
    lines.push(`e2e: graphics were on in ${which}: no DarkWake.`);
  }
  const notRead = total - full - dark;
  if (notRead > 0) {
    const named = [...unread].map(([why, minutes]) => `${why} (${minuteList(minutes)})`);
    if (notSamples > 0) named.push(`${notSamples} stored ${plural(notSamples, 'line', 'lines')} not readable as a sample`);
    lines.push(
      `e2e: ${notRead} ${of} could not be read, so the DarkWake check does not cover ${plural(notRead, 'it', 'them')}: ${named.join('; ')}.`,
    );
  }
  return lines;
}

/** The stored file back as samples. A line that is not one is counted, never dropped. */
export function storedPowerSamples(text: string): { samples: PowerSample[]; notSamples: number } {
  const samples: PowerSample[] = [];
  let notSamples = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const sample = asPowerSample(line);
    if (sample) samples.push(sample);
    else notSamples += 1;
  }
  return { samples, notSamples };
}

function asPowerSample(line: string): PowerSample | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // Not silent: the caller counts it, and the end line names it.
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { atMs, pid, out, error } = value as Record<string, unknown>;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || typeof pid !== 'number') return null;
  if ((out !== undefined && typeof out !== 'string') || (error !== undefined && typeof error !== 'string')) return null;
  return { atMs, pid, ...(out !== undefined ? { out } : {}), ...(error !== undefined ? { error } : {}) };
}

export const powerSampleLine = (sample: PowerSample): string => `${JSON.stringify(sample)}\n`;

function pmsetFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'pmset failed';
  const code = 'code' in error ? error.code : undefined;
  const killed = 'killed' in error ? error.killed : undefined;
  if (code === 'ETIMEDOUT' || killed === true) return `pmset timed out after ${PMSET_TIMEOUT_MS} ms`;
  return `pmset failed: ${(error.message.split('\n')[0] ?? '').slice(0, 120)}`;
}

/** Asks pmset and waits for it: the first and the last sample. Never throws. */
export function takePowerSample(): PowerSample {
  const atMs = Date.now();
  try {
    const out = execFileSync('pmset', ['-g', 'systemstate'], {
      encoding: 'utf8',
      timeout: PMSET_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { atMs, pid: process.pid, out: out.slice(0, OUT_KEPT) };
  } catch (error) {
    return { atMs, pid: process.pid, error: pmsetFailure(error) };
  }
}

/** The once-a-minute sample: asks without blocking the runner, then stores what it got. */
function sampleInto(file: string): void {
  const atMs = Date.now();
  const store = (sample: PowerSample) => {
    try {
      appendFileSync(file, powerSampleLine(sample));
    } catch (failure) {
      console.warn(
        `e2e: a power sample could not be stored (${failure instanceof Error ? failure.message : 'unknown error'}); the DarkWake check misses it.`,
      );
    }
  };
  try {
    execFile('pmset', ['-g', 'systemstate'], { encoding: 'utf8', timeout: PMSET_TIMEOUT_MS }, (error, stdout) => {
      store(error ? { atMs, pid: process.pid, error: pmsetFailure(error) } : { atMs, pid: process.pid, out: stdout.slice(0, OUT_KEPT) });
    });
  } catch (error) {
    // A timer callback must never throw into the runner.
    store({ atMs, pid: process.pid, error: pmsetFailure(error) });
  }
}

/** The sampler's timer, on the process, so a runner that starts a second run (UI mode) stops the first's. */
type SamplerHolder = typeof globalThis & { __vinE2ePowerSampler?: ReturnType<typeof setInterval> };

/**
 * At the start of a run (global setup): a new file holding the first sample, then one sample
 * a minute until the end. The timer is unref'd, so it never holds the run open.
 */
export function startPowerSampling(file: string = POWER_FILE, everyMs: number = SAMPLE_EVERY_MS): void {
  if (process.platform !== 'darwin') return;
  const holder = globalThis as SamplerHolder;
  clearInterval(holder.__vinE2ePowerSampler);
  // Gone first, so a failed write leaves no earlier run's samples for the teardown to read.
  rmSync(file, { force: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, powerSampleLine(takePowerSample()));
  const timer = setInterval(() => sampleInto(file), everyMs);
  timer.unref();
  holder.__vinE2ePowerSampler = timer;
}

/** At the end (global teardown): the last sample, then the lines. Never fails the run; macOS only. */
export function runPowerReport(file: string = POWER_FILE): string[] {
  if (process.platform !== 'darwin') return [];
  try {
    clearInterval((globalThis as SamplerHolder).__vinE2ePowerSampler);
    if (!existsSync(file)) return powerLines([]);
    appendFileSync(file, powerSampleLine(takePowerSample()));
    const { samples, notSamples } = storedPowerSamples(readFileSync(file, 'utf8'));
    return powerLines(samples, notSamples);
  } catch (error) {
    return [`e2e: the DarkWake check could not read its samples (${error instanceof Error ? error.message : 'unknown error'}).`];
  }
}
