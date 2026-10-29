import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fleetRow, type FleetRowOver } from '@/test/fleet-row';
import type { FleetRow } from '@/server/fleet-query';
import { STATUSES, type Status } from '@/lib/status';
import { chipProps } from './chip-props';

/**
 * Phase 3av. The status chip's props, built once for every surface that
 * draws the chip: the row, the phone's card and sheet, the map popup and the
 * board's Currently column. Invented data only (the repo is public).
 */

afterEach(() => {
  vi.useRealTimers();
});

/** The poll's instant. Any instant will do: every age is measured from it. */
const FETCHED_AT = new Date().toISOString();
const before = (minutes: number) =>
  new Date(Date.parse(FETCHED_AT) - minutes * 60_000).toISOString();

/** A fix 48 minutes before the poll: the age a stale chip prints. */
const live = (over: FleetRowOver = {}): FleetRow =>
  fleetRow({ recordedAt: before(48), ...over });

const OVERRIDE = {
  forcedStatus: 'LATE' as const,
  reason: 'RECEIVER_CONFIRMED_DETENTION' as const,
  reasonNote: null,
  setByName: 'Test Dispatcher',
  setAtUtc: before(120),
  expiresAtUtc: new Date(Date.parse(FETCHED_AT) + 6 * 3_600_000).toISOString(),
};

const DAY_MS = 86_400_000;
/** `YYYY-MM-DD` of a day `days` after the poll, and the chip's words for it. */
function laterDay(days: number): { day: string; words: string } {
  const at = new Date(Date.parse(FETCHED_AT) + days * DAY_MS);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(at);
  return {
    day: at.toISOString().slice(0, 10),
    words: `${weekday} ${at.getUTCMonth() + 1}/${at.getUTCDate()}`,
  };
}

describe('a stale feed withdraws every chip (§5.9)', () => {
  it.each(STATUSES)('%s becomes the dotted Stale GPS with the fix’s age', (status) => {
    expect(chipProps(live({ status, computed: status }), true, FETCHED_AT)).toEqual({
      status: 'STALE_GPS',
      forced: false,
      label: '48m',
    });
  });

  it('an override is not "forced" while the feed is stale', () => {
    const row = live({ status: 'LATE', computed: 'ON_TIME', override: OVERRIDE });
    expect(chipProps(row, true, FETCHED_AT)).toEqual({
      status: 'STALE_GPS',
      forced: false,
      label: '48m',
    });
  });

  it('an upcoming load gets the age, not its day', () => {
    for (const upcoming of [
      { day: laterDay(1).day, tomorrow: true },
      { day: laterDay(3).day, tomorrow: false },
    ]) {
      const row = live({ status: 'TOMORROW', computed: 'TOMORROW', upcoming });
      expect(chipProps(row, true, FETCHED_AT).label).toBe('48m');
    }
  });

  it('no fix at all: no age, so the chip keeps its word', () => {
    expect(chipProps(live({ recordedAt: null }), true, FETCHED_AT)).toEqual({
      status: 'STALE_GPS',
      forced: false,
      label: undefined,
    });
  });
});

describe('a fresh feed (§5.1, §12.82, §9.5)', () => {
  it('a truck’s own Stale GPS carries its age, in §5.1’s one format', () => {
    const row = live({ status: 'STALE_GPS', computed: 'STALE_GPS', recordedAt: before(160) });
    expect(chipProps(row, false, FETCHED_AT)).toEqual({
      status: 'STALE_GPS',
      forced: false,
      label: '2h 40m',
    });
  });

  it('an upcoming load names its day: "Tomorrow", or the weekday and date', () => {
    const tomorrow = { day: laterDay(1).day, tomorrow: true };
    expect(
      chipProps(live({ status: 'TOMORROW', computed: 'TOMORROW', upcoming: tomorrow }), false, FETCHED_AT),
    ).toEqual({ status: 'TOMORROW', forced: false, label: 'Tomorrow' });

    const later = laterDay(3);
    expect(
      chipProps(
        live({ status: 'TOMORROW', computed: 'TOMORROW', upcoming: { day: later.day, tomorrow: false } }),
        false,
        FETCHED_AT,
      ),
    ).toEqual({ status: 'TOMORROW', forced: false, label: later.words });
  });

  it('an upcoming load with no day: no label, so the chip says "Upcoming"', () => {
    const row = live({ status: 'TOMORROW', computed: 'TOMORROW', upcoming: null });
    expect(chipProps(row, false, FETCHED_AT).label).toBeUndefined();
  });

  it('an override is forced, and keeps the status it forced', () => {
    const row = live({ status: 'LATE', computed: 'ON_TIME', override: OVERRIDE });
    expect(chipProps(row, false, FETCHED_AT)).toEqual({
      status: 'LATE',
      forced: true,
      label: undefined,
    });
  });

  const PLAIN: Status[] = STATUSES.filter((s) => s !== 'STALE_GPS' && s !== 'TOMORROW');
  it.each(PLAIN)('%s: its own status, not forced, no label', (status) => {
    expect(chipProps(live({ status, computed: status }), false, FETCHED_AT)).toEqual({
      status,
      forced: false,
      label: undefined,
    });
  });
});

it('the age is measured from the poll’s instant, not the clock', () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(FETCHED_AT) + 5 * 3_600_000);
  expect(chipProps(live(), true, FETCHED_AT).label).toBe('48m');
});

/**
 * The guard. A sixth hand-built copy of the stale rule fails here, however it
 * is spaced or quoted. The pattern is a regex so this file does not contain
 * the text it looks for.
 *
 * `map/geo.ts` is the one other file allowed it: the map's markers take the
 * status alone, with no "forced" and no label, so the chip's props are not
 * what they need (3av, HANDOFF).
 */
describe('one copy of the rule (3av)', () => {
  const STALE_BY_HAND = /feedStale\s*\?\s*['"`]STALE_GPS['"`]/;
  const ALLOWED = ['src/components/console/chip-props.ts', 'src/components/console/map/geo.ts'];

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it('no file under src/components builds the stale status by hand, but the helper (and geo.ts)', () => {
    const files = sources(join(process.cwd(), 'src/components')).map((f) =>
      relative(process.cwd(), f),
    );
    expect(files.length).toBeGreaterThan(100);
    const copies = files.filter((f) => STALE_BY_HAND.test(readFileSync(f, 'utf8')));
    expect(copies.sort()).toEqual([...ALLOWED].sort());
  });
});
