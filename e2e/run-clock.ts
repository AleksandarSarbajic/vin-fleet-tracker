import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
