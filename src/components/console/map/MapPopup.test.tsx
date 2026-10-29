// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fleetRow, type FleetRowOver } from '@/test/fleet-row';
import type { FleetRow } from '@/server/fleet-query';
import { StatusChip } from '../StatusChip';
import { TruckRow } from '../TruckRow';
import { MapPopup } from './MapPopup';

/**
 * Phase 3av. The popup's chip is the row's chip: on a stale feed it withdraws
 * its colour as every row does (§5.9). Before 3av it drew `row.status` and
 * never knew the feed was down, so a dead feed could show a green "On time"
 * here over a dotted row.
 *
 * The map's Popup is a pass-through: it needs a live map, and only what the
 * popup puts inside it is being read. Invented data only (the repo is public).
 */
vi.mock('react-map-gl/mapbox', () => ({
  Popup: ({ children }: { children: ReactNode }) => children,
}));

/** The poll's instant. Any instant will do: every age is measured from it. */
const FETCHED_AT = new Date().toISOString();
const before = (minutes: number) =>
  new Date(Date.parse(FETCHED_AT) - minutes * 60_000).toISOString();
const tomorrow = () => ({
  day: new Date(Date.parse(FETCHED_AT) + 86_400_000).toISOString().slice(0, 10),
  tomorrow: true,
});

/** A fix 48 minutes before the poll: the age a stale chip prints. */
const live = (over: FleetRowOver = {}): FleetRow => fleetRow({ recordedAt: before(48), ...over });

const OVERRIDE = {
  forcedStatus: 'LATE' as const,
  reason: 'RECEIVER_CONFIRMED_DETENTION' as const,
  reasonNote: null,
  setByName: 'Test Dispatcher',
  setAtUtc: before(120),
  expiresAtUtc: new Date(Date.parse(FETCHED_AT) + 6 * 3_600_000).toISOString(),
};

/** The override glyph's first stroke (StatusChip): a hand. */
const HAND = 'M12 11V5.5a1.5 1.5 0 0 1 3 0V12';

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

const chipOf = (el: Element): HTMLElement => {
  const chips = el.querySelectorAll<HTMLElement>('span[class*="h-[21px]"]');
  expect(chips).toHaveLength(1);
  return chips[0]!;
};

const popup = (row: FleetRow, feedStale: boolean) =>
  html(
    renderToStaticMarkup(
      <MapPopup
        row={row}
        fetchedAt={FETCHED_AT}
        feedStale={feedStale}
        onEdit={() => {}}
        onTimeline={() => {}}
        onClose={() => {}}
      />,
    ),
  );

/** The console's own row for the same truck. */
const consoleRow = (row: FleetRow, feedStale: boolean) =>
  html(
    renderToStaticMarkup(
      <TruckRow
        row={row}
        fetchedAt={FETCHED_AT}
        feedStale={feedStale}
        columns={8}
        density="comfortable"
        selected={false}
        checked={false}
        onCheck={() => {}}
        flash={null}
        reducedMotion={false}
        pinned={false}
        onPin={() => {}}
        query=""
        onSelect={() => {}}
        onEdit={() => {}}
      />,
    ),
  );

describe('the popup’s chip on a stale feed (§5.9)', () => {
  const withdrawn = chipOf(html(renderToStaticMarkup(<StatusChip status="STALE_GPS" label="48m" />)));

  it.each([
    ['On time', live({ status: 'ON_TIME' }), 'ontime'],
    ['a forced Late', live({ status: 'LATE', computed: 'ON_TIME', override: OVERRIDE }), 'late'],
  ])('%s becomes the dotted Stale GPS with the age, and no hand', (_name, row, colour) => {
    const chip = chipOf(popup(row, true));
    expect(chip.outerHTML).toBe(withdrawn.outerHTML);
    expect(chip.textContent).toBe('48m');
    expect(chip.className).toContain('border-dotted');
    expect(chip.className).not.toContain(colour);
    expect(chip.innerHTML).not.toContain(HAND);
    expect(chip.textContent).not.toContain('forced');
  });

  it('an upcoming load shows the age, not its day', () => {
    const chip = chipOf(popup(live({ status: 'TOMORROW', computed: 'TOMORROW', upcoming: tomorrow() }), true));
    expect(chip.textContent).toBe('48m');
  });
});

describe('the popup’s chip on a fresh feed: row.status, as before', () => {
  it('On time', () => {
    const chip = chipOf(popup(live({ status: 'ON_TIME' }), false));
    expect(chip.textContent).toBe('On time');
    expect(chip.className).toContain('ontime');
  });

  it('Late · forced, with the hand', () => {
    const chip = chipOf(popup(live({ status: 'LATE', computed: 'ON_TIME', override: OVERRIDE }), false));
    expect(chip.textContent).toBe('Late · forced');
    expect(chip.innerHTML).toContain(HAND);
  });

  it('an upcoming load names its day', () => {
    const chip = chipOf(popup(live({ status: 'TOMORROW', computed: 'TOMORROW', upcoming: tomorrow() }), false));
    expect(chip.textContent).toBe('Tomorrow');
  });

  /**
   * The one change on a fresh feed, and a fix: §5.1 gives Stale GPS one chip
   * word everywhere, the elapsed age. Before 3av the popup printed "Stale
   * GPS" here while the row printed the age.
   */
  it('a truck’s own Stale GPS prints its age, as the row does (§5.1)', () => {
    const chip = chipOf(popup(live({ status: 'STALE_GPS', computed: 'STALE_GPS', recordedAt: before(160) }), false));
    expect(chip.textContent).toBe('2h 40m');
  });
});

describe('the popup’s chip is the console row’s chip', () => {
  const cases: [string, FleetRowOver, boolean][] = [
    ['on time', { status: 'ON_TIME' }, false],
    ['at risk', { status: 'AT_RISK' }, false],
    ['late', { status: 'LATE' }, false],
    ['arrived', { status: 'ARRIVED' }, false],
    ['no appointment', { status: 'NO_APPT' }, false],
    ['upcoming, no day', { status: 'TOMORROW', upcoming: null }, false],
    ['upcoming tomorrow', { status: 'TOMORROW', upcoming: tomorrow() }, false],
    ['its own stale GPS', { status: 'STALE_GPS' }, false],
    ['forced late', { status: 'LATE', override: OVERRIDE }, false],
    ['on time, feed stale', { status: 'ON_TIME' }, true],
    ['forced late, feed stale', { status: 'LATE', override: OVERRIDE }, true],
    ['upcoming, feed stale', { status: 'TOMORROW', upcoming: tomorrow() }, true],
  ];

  it.each(cases)('%s', (_name, over, feedStale) => {
    const row = live(over);
    expect(chipOf(popup(row, feedStale)).outerHTML).toBe(chipOf(consoleRow(row, feedStale)).outerHTML);
  });
});
