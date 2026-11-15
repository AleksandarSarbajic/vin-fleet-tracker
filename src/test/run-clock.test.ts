import { describe, expect, it } from 'vitest';
import {
  powerLines,
  powerSampleLine,
  readLowPower,
  readPowerSample,
  readSource,
  sleepLine,
  sleptMs,
  storedPowerSamples,
  storedSupplySamples,
  supplyLines,
  supplySampleLine,
  type PmsetAnswer,
  type PowerSample,
  type SupplySample,
} from '../../e2e/run-clock';

/** The end-of-run sleep check's arithmetic, with invented readings. */

const at = (wallMs: number, awakeMs: number) => ({ wallMs, awakeMs });
const MIN = 60_000;

describe('time asleep during a run', () => {
  it('is the wall time the awake clock did not see', () => {
    // 40 minutes passed on the wall; the awake clock moved 12.
    expect(sleptMs(at(1_000_000, 500_000), at(1_000_000 + 40 * MIN, 500_000 + 12 * MIN))).toBe(28 * MIN);
  });

  it('is zero when both clocks agree', () => {
    expect(sleptMs(at(0, 0), at(18 * MIN, 18 * MIN))).toBe(0);
  });

  it('is never negative, whatever the clocks drift by', () => {
    expect(sleptMs(at(0, 0), at(10 * MIN, 10 * MIN + 250))).toBe(0);
  });
});

describe('the line at the end of a run', () => {
  it('names the minutes asleep, and that failures may come from it', () => {
    expect(sleepLine(at(0, 0), at(37 * MIN, 9 * MIN))).toBe(
      'e2e: the Mac slept 28 minutes during this run; failures may be from that.',
    );
    expect(sleepLine(at(0, 0), at(5 * MIN, 4 * MIN))).toBe(
      'e2e: the Mac slept 1 minute during this run; failures may be from that.',
    );
  });

  it('treats under a minute as awake: a clock read is not sleep', () => {
    expect(sleepLine(at(0, 0), at(18 * MIN, 18 * MIN - 25_000))).toBe('e2e: the machine stayed awake for the whole run.');
  });
});

/**
 * Phase 3bv. The DarkWake check: what `pmset -g systemstate` printed, read as full wake, dark
 * or unread, and the lines the end of a run says from it. Every string here is made up, in
 * the shape pmset prints.
 */

/** Today's full-wake output on this Mac (2026-11-14), its trailing space and all. */
const FULL_WAKE = 'Current System Capabilities are: CPU Graphics Audio Network \nCurrent Power State: 4\n';
/**
 * The shape DarkWake is EXPECTED to print: the same line without Graphics. UNVERIFIED on this
 * Mac, where no lid-closed run has been sampled yet.
 */
const DARK_WAKE = 'Current System Capabilities are: CPU Audio Network \nCurrent Power State: 4\n';
const TIMED_OUT = 'pmset timed out after 2000 ms';

const T0 = 1_000_000_000;
const said = (minute: number, out: string): PowerSample => ({ atMs: T0 + minute * MIN, pid: 4242, out });
const failed = (minute: number, error: string): PowerSample => ({ atMs: T0 + minute * MIN, pid: 4242, error });
/** A sample each minute from 0 to `last`, full wake but for the ones given. */
const run = (last: number, others: Record<number, PowerSample> = {}): PowerSample[] =>
  Array.from({ length: last + 1 }, (_, m) => others[m] ?? said(m, FULL_WAKE));

describe('a power sample', () => {
  it('is full wake when the capabilities line lists Graphics: today’s line on this Mac', () => {
    expect(readPowerSample(said(0, FULL_WAKE))).toEqual({ state: 'full' });
  });

  it('is dark when a capabilities line does not list Graphics: the shape DarkWake is expected to print, unverified on this Mac', () => {
    expect(readPowerSample(said(0, DARK_WAKE))).toEqual({ state: 'dark' });
    // Graphics as a word of the line, not a piece of one.
    expect(readPowerSample(said(0, 'Current System Capabilities are: CPU GraphicsPending Network\n'))).toEqual({ state: 'dark' });
    expect(readPowerSample(said(0, 'Current System Capabilities are:\n'))).toEqual({ state: 'dark' });
  });

  it('is unread, never full wake, when pmset printed nothing, printed something else, or failed', () => {
    expect(readPowerSample(said(0, ''))).toEqual({ state: 'unread', why: 'pmset printed nothing' });
    expect(readPowerSample(said(0, ' \n\n'))).toEqual({ state: 'unread', why: 'pmset printed nothing' });
    expect(readPowerSample(said(0, 'Current Power State: 4\n'))).toEqual({ state: 'unread', why: 'no capabilities line' });
    expect(readPowerSample(said(0, '%%garbage%% Graphics Audio\n'))).toEqual({ state: 'unread', why: 'no capabilities line' });
    expect(readPowerSample(failed(0, TIMED_OUT))).toEqual({ state: 'unread', why: TIMED_OUT });
    // An error with an answer beside it is still not an answer to read.
    expect(readPowerSample({ ...said(0, FULL_WAKE), error: 'pmset failed: spawn pmset ENOENT' }).state).toBe('unread');
  });
});

describe('the DarkWake lines at the end of a run', () => {
  it('dark 0 and unread 0: graphics were on in every sample', () => {
    expect(powerLines(run(10))).toEqual(['e2e: graphics were on in all 11 power samples: no DarkWake.']);
    expect(powerLines([said(0, FULL_WAKE)])).toEqual(['e2e: graphics were on in the one power sample: no DarkWake.']);
  });

  it('dark 1: how long, that the page runs about 3x slower there, and that timing failures may be from that', () => {
    expect(powerLines(run(10, { 4: said(4, DARK_WAKE) }))).toEqual([
      'e2e: 1 of 11 power samples found macOS without graphics (DarkWake), about 1 minute of a 10-minute run: the page runs about 3x slower there, so timing failures may be from that.',
    ]);
  });

  it('dark several: their share of the run, each sample standing for the time halfway to its neighbours', () => {
    const dark = { 4: said(4, DARK_WAKE), 5: said(5, DARK_WAKE), 6: said(6, DARK_WAKE) };
    expect(powerLines(run(10, dark))).toEqual([
      'e2e: 3 of 11 power samples found macOS without graphics (DarkWake), about 3 minutes of a 10-minute run: the page runs about 3x slower there, so timing failures may be from that.',
    ]);
    // Only the last sample dark: half a minute, said as under one.
    expect(powerLines(run(10, { 10: said(10, DARK_WAKE) }))[0]).toContain(
      '1 of 11 power samples found macOS without graphics (DarkWake), under a minute of a 10-minute run:',
    );
    // Every sample dark: the whole run.
    expect(powerLines(run(62).map((s) => ({ ...s, out: DARK_WAKE })))[0]).toContain(
      '63 of 63 power samples found macOS without graphics (DarkWake), about 62 minutes of a 62-minute run:',
    );
  });

  it('unread 1: named by its minute and why, and counted as neither full wake nor dark', () => {
    expect(powerLines(run(10, { 7: failed(7, TIMED_OUT) }))).toEqual([
      'e2e: graphics were on in 10 of 11 power samples, every one that could be read: no DarkWake.',
      'e2e: 1 of 11 power samples could not be read, so the DarkWake check does not cover it: pmset timed out after 2000 ms (minute 7).',
    ]);
  });

  it('unread several: each reason with its minutes, and a stored line that was not a sample at all', () => {
    const lost = { 2: failed(2, TIMED_OUT), 3: failed(3, TIMED_OUT), 5: said(5, DARK_WAKE), 8: said(8, 'Current Power State: 4\n') };
    expect(powerLines(run(10, lost), 1)).toEqual([
      'e2e: 1 of 12 power samples found macOS without graphics (DarkWake), about 1 minute of a 10-minute run: the page runs about 3x slower there, so timing failures may be from that.',
      'e2e: 4 of 12 power samples could not be read, so the DarkWake check does not cover them: pmset timed out after 2000 ms (minutes 2 and 3); no capabilities line (minute 8); 1 stored line not readable as a sample.',
    ]);
    // Seven for one reason: five minutes named, the rest counted.
    const seven = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((m) => [m, failed(m, 'pmset failed: spawn pmset ENOENT')]));
    expect(powerLines(run(10, seven))).toEqual([
      'e2e: graphics were on in 4 of 11 power samples, every one that could be read: no DarkWake.',
      'e2e: 7 of 11 power samples could not be read, so the DarkWake check does not cover them: pmset failed: spawn pmset ENOENT (minutes 1, 2, 3, 4, 5 and 2 more).',
    ]);
  });

  it('every sample unread: no all-clear, only what could not be read', () => {
    expect(powerLines(run(3).map((s) => ({ atMs: s.atMs, pid: s.pid, error: TIMED_OUT })))).toEqual([
      'e2e: 4 of 4 power samples could not be read, so the DarkWake check does not cover them: pmset timed out after 2000 ms (minutes 0, 1, 2 and 3).',
    ]);
  });

  it('no samples at all: says there is no check, rather than nothing', () => {
    expect(powerLines([])).toEqual(['e2e: no power samples for this run, so no DarkWake check.']);
  });

  it('reads the samples in time order, whatever order they were stored in', () => {
    const samples = run(10, { 4: said(4, DARK_WAKE), 7: failed(7, TIMED_OUT) });
    expect(powerLines([...samples].reverse())).toEqual(powerLines(samples));
  });
});

describe('the stored samples, which setup and teardown share as a file', () => {
  it('come back as they were written, one a line; a line that is not a sample is counted, never dropped', () => {
    const written = [said(0, FULL_WAKE), failed(1, TIMED_OUT)];
    const text = `${written.map(powerSampleLine).join('')}not json\n\n{"atMs":"soon","pid":1}\n`;
    expect(storedPowerSamples(text)).toEqual({ samples: written, notSamples: 2 });
  });
});

/**
 * Phase 3bw (§12.162). Battery and Low Power Mode, from `pmset -g` and `pmset -g batt` at the
 * start and the end of a run. Made-up output in the shape pmset prints, never this Mac's.
 */
const settings = (mode: string): PmsetAnswer => ({
  out: `System-wide power settings:\nCurrently in use:\n standby              1\n lowpowermode         ${mode}\n womp                 0\n`,
});
const source = (from: string): PmsetAnswer => ({
  out: `Now drawing from '${from}'\n -InternalBattery-0 (id=1234567)\t61%; discharging; 3:10 remaining present: true\n`,
});
const AC = source('AC Power');
const BATTERY = source('Battery Power');
const LOW_ON = settings('1');
const LOW_OFF = settings('0');
const supply = (minute: number, batt: PmsetAnswer, mode: PmsetAnswer): SupplySample => ({
  atMs: 1_800_000_000_000 + minute * MIN,
  pid: 4242,
  settings: mode,
  batt,
});
const SLOWER = 'a full run took 1.4 h like this in 3bv, against 1.1 h on AC in 3bu.';

describe('reading pmset -g and pmset -g batt', () => {
  it('Low Power Mode: 1 is on, 0 is off, anything else is named', () => {
    expect(readLowPower(LOW_ON)).toEqual({ state: 'on' });
    expect(readLowPower(LOW_OFF)).toEqual({ state: 'off' });
    expect(readLowPower(settings('2'))).toEqual({ state: 'unread', why: 'lowpowermode 2, not 0 or 1' });
    expect(readLowPower({ out: 'System-wide power settings:\n standby 1\n' })).toEqual({ state: 'unread', why: 'no lowpowermode line in pmset -g' });
    expect(readLowPower({ out: '  \n' })).toEqual({ state: 'unread', why: 'pmset -g printed nothing' });
    expect(readLowPower({ error: 'timed out after 2000 ms' })).toEqual({ state: 'unread', why: 'pmset -g: timed out after 2000 ms' });
  });

  it('the source: AC Power and Battery Power, anything else named', () => {
    expect(readSource(AC)).toEqual({ state: 'ac' });
    expect(readSource(BATTERY)).toEqual({ state: 'battery' });
    expect(readSource(source('UPS Power'))).toEqual({ state: 'unread', why: 'drawing from UPS Power' });
    expect(readSource({ out: 'garbage\n' })).toEqual({ state: 'unread', why: 'no power source line in pmset -g batt' });
    expect(readSource({ out: '' })).toEqual({ state: 'unread', why: 'pmset -g batt printed nothing' });
    expect(readSource({ error: 'failed: spawn pmset ENOENT' })).toEqual({ state: 'unread', why: 'pmset -g batt: failed: spawn pmset ENOENT' });
  });
});

describe('the battery and Low Power Mode line at the end of a run', () => {
  it('both, at the start and the end: the line the brief gave', () => {
    expect(supplyLines([supply(0, BATTERY, LOW_ON), supply(84, BATTERY, LOW_ON)])).toEqual([
      `e2e: ran on battery with Low Power Mode on (at the start and the end): ${SLOWER}`,
    ]);
  });

  it('battery only, and only at the start: the charger went in during the run', () => {
    expect(supplyLines([supply(0, BATTERY, LOW_OFF), supply(70, AC, LOW_OFF)])).toEqual([
      `e2e: ran on battery (at the start): ${SLOWER}`,
    ]);
  });

  it('Low Power Mode only, on AC, turned on during the run', () => {
    expect(supplyLines([supply(0, AC, LOW_OFF), supply(70, AC, LOW_ON)])).toEqual([
      `e2e: ran with Low Power Mode on (at the end): ${SLOWER}`,
    ]);
  });

  it('each at different times: each says when', () => {
    expect(supplyLines([supply(0, BATTERY, LOW_ON), supply(70, BATTERY, LOW_OFF)])).toEqual([
      `e2e: ran on battery (at the start and the end) with Low Power Mode on (at the start): ${SLOWER}`,
    ]);
  });

  it('neither, every answer read: an all-clear, so a run that sampled nothing is not mistaken for one that found nothing', () => {
    expect(supplyLines([supply(0, AC, LOW_OFF), supply(66, AC, LOW_OFF)])).toEqual([
      'e2e: on AC power with Low Power Mode off (at the start and the end).',
    ]);
  });

  it('an answer it could not read is named, and the all-clear is not claimed over it', () => {
    expect(supplyLines([supply(0, AC, LOW_OFF), supply(66, { error: 'timed out after 2000 ms' }, LOW_OFF)])).toEqual([
      'e2e: the battery and Low Power Mode check could not read 1 of 4 pmset answers: pmset -g batt: timed out after 2000 ms (at the end).',
    ]);
  });

  it('battery found beside an unread answer: both lines', () => {
    expect(supplyLines([supply(0, BATTERY, { out: '' }), supply(66, BATTERY, LOW_OFF)])).toEqual([
      `e2e: ran on battery (at the start and the end): ${SLOWER}`,
      'e2e: the battery and Low Power Mode check could not read 1 of 4 pmset answers: pmset -g printed nothing (at the start).',
    ]);
  });

  it('only the start sample, the end never stored: it is "the start" alone', () => {
    expect(supplyLines([supply(0, BATTERY, LOW_ON)])).toEqual([
      `e2e: ran on battery with Low Power Mode on (at the start): ${SLOWER}`,
    ]);
  });

  it('none stored: says there is no check, rather than nothing', () => {
    expect(supplyLines([])).toEqual(['e2e: no power-source samples for this run, so no battery or Low Power Mode check.']);
  });

  it('a stored line that is not a sample is named', () => {
    expect(supplyLines([supply(0, AC, LOW_OFF), supply(5, AC, LOW_OFF)], 1)).toEqual([
      'e2e: the battery and Low Power Mode check could not read its samples: 1 stored line not readable as a sample.',
    ]);
  });

  it('reads them in time order, whatever order they were stored in', () => {
    const samples = [supply(0, BATTERY, LOW_OFF), supply(70, AC, LOW_OFF)];
    expect(supplyLines([...samples].reverse())).toEqual(supplyLines(samples));
  });

  it('the stored file comes back as written; a line that is not a sample is counted, never dropped', () => {
    const written = [supply(0, BATTERY, LOW_ON), supply(70, { error: 'timed out after 2000 ms' }, LOW_ON)];
    const text = `${written.map(supplySampleLine).join('')}not json\n\n{"atMs":1,"pid":2,"settings":{},"batt":{"out":""}}\n`;
    expect(storedSupplySamples(text)).toEqual({ samples: written, notSamples: 2 });
  });
});
