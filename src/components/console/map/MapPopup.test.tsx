// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fleetRow, type FleetRowOver } from '@/test/fleet-row';
import type { FleetRow } from '@/server/fleet-query';
import { StatusChip } from '../StatusChip';
import { TruckRow } from '../TruckRow';
import { TruckSheet } from '../phone/TruckSheet';
import { MapPopup } from './MapPopup';

/**
 * Phase 3av. The popup's chip is the row's chip: on a stale feed it withdraws
 * its colour as every row does (§5.9). Before 3av it drew `row.status` and
 * never knew the feed was down, so a dead feed could show a green "On time"
 * here over a dotted row.
 *
 * Phase 3aw. The popup's other lines on a dead feed read as the phone's
 * truck sheet does: "Last seen" on the position, the Feed down line under
 * the projection, and the override's Computed line muted (§12.146).
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

/* ------------------------- 3aw: the popup's other lines ------------------------- */

const after = (minutes: number) =>
  new Date(Date.parse(FETCHED_AT) + minutes * 60_000).toISOString();

/** A routed ETA to an appointment, so the popup has a Projected line. */
const ON_A_LOAD: FleetRowOver = {
  etaAbsence: 'has-eta',
  etaUtc: after(180),
  milesRemaining: 140,
  distanceBasis: 'routed',
  nextStop: { apptStartUtc: after(240), apptTz: 'America/Chicago', apptType: 'APPT' },
};
/** An override that hides a different computed status: Computed and Forced by show. */
const FORCED: FleetRowOver = { status: 'LATE', computed: 'ON_TIME', override: OVERRIDE };
const WHERE = '1 Broadway, Chicago, IL';
/** The wording, pinned here as well as kept in one place (FEED_DOWN_ETA). */
const FEED_DOWN = 'Feed down: built on positions we no longer trust.';

/** The value the popup prints beside a label (its `Row`). */
function popupValue(host: HTMLElement, label: string): HTMLElement | null {
  const labels = [...host.querySelectorAll<HTMLElement>('span.text-text-muted')];
  const found = labels.find((el) => el.textContent === label);
  return (found?.nextElementSibling as HTMLElement | null) ?? null;
}
const feedDownLines = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('span.block')].filter((el) =>
    el.textContent?.startsWith('Feed down'),
  );

const sheet = (row: FleetRow, feedStale: boolean) =>
  html(
    renderToStaticMarkup(
      <TruckSheet
        row={row}
        fetchedAt={FETCHED_AT}
        feedStale={feedStale}
        tel={null}
        onClose={() => {}}
        onTimeline={() => {}}
        onShowOnMap={() => {}}
      />,
    ),
  );

describe('the popup’s other lines on a dead feed (§5.9, §12.146)', () => {
  const host = () => popup(live({ ...ON_A_LOAD, ...FORCED }), true);

  it('Position says "Last seen"', () => {
    expect(popupValue(host(), 'Position')?.textContent).toBe(`Last seen ${WHERE}`);
  });

  it('Projected keeps the ETA, and adds the Feed down line in the risk ink', () => {
    const projected = popupValue(host(), 'Projected')!;
    expect(projected.textContent).toMatch(/^140 mi · ETA \d{2}:\d{2} /);
    const lines = feedDownLines(projected);
    expect(lines.map((l) => l.textContent)).toEqual([FEED_DOWN]);
    expect(lines[0]!.className).toBe('block text-status-risk-fg');
  });

  it('Computed loses its status colour; Forced by is still printed', () => {
    const el = host();
    const computed = popupValue(el, 'Computed')!.firstElementChild as HTMLElement;
    expect(computed.textContent).toBe('On time');
    expect(computed.className).toBe('text-text-muted');
    expect(computed.className).not.toMatch(/status/);
    expect(popupValue(el, 'Forced by')?.textContent).toBe(
      'Test Dispatcher — Receiver confirmed detention',
    );
  });
});

describe('the popup’s other lines on a live feed: as before', () => {
  it('a fresh truck: its position, no Feed down line, Computed in the risk ink', () => {
    const el = popup(live({ ...ON_A_LOAD, ...FORCED, recordedAt: before(2) }), false);
    expect(popupValue(el, 'Position')?.textContent).toBe(WHERE);
    expect(feedDownLines(el)).toEqual([]);
    expect(el.textContent).not.toContain('Feed down');
    const computed = popupValue(el, 'Computed')!.firstElementChild as HTMLElement;
    expect(computed.className).toBe('text-status-risk-fg');
  });

  /** The one change on a live feed: what the row and the sheet already say. */
  it('a truck whose own GPS is stale: "Last seen", and nothing else', () => {
    const el = popup(live({ ...ON_A_LOAD, status: 'STALE_GPS', computed: 'STALE_GPS' }), false);
    expect(popupValue(el, 'Position')?.textContent).toBe(`Last seen ${WHERE}`);
    expect(feedDownLines(el)).toEqual([]);
  });
});

describe('the popup and the sheet read the same', () => {
  const cases: [string, FleetRowOver, boolean][] = [
    ['dead feed, forced', { ...ON_A_LOAD, ...FORCED }, true],
    ['dead feed, its own stale GPS', { ...ON_A_LOAD, status: 'STALE_GPS', computed: 'STALE_GPS' }, true],
    ['dead feed, no fix', { ...ON_A_LOAD, ...FORCED, formattedLocation: null, cityState: null }, true],
    ['live feed, forced', { ...ON_A_LOAD, ...FORCED, recordedAt: before(2) }, false],
    ['live feed, its own stale GPS', { ...ON_A_LOAD, status: 'STALE_GPS', computed: 'STALE_GPS' }, false],
  ];

  it.each(cases)('%s: Position, the Feed down line, the Computed ink', (_name, over, feedStale) => {
    const row = live(over);
    const ours = popup(row, feedStale);
    const theirs = sheet(row, feedStale);

    expect(popupValue(ours, 'Position')?.textContent).toBe(
      theirs.querySelector('[data-sheet-field="position"]')?.textContent,
    );
    expect(feedDownLines(ours).map((l) => l.outerHTML)).toEqual(
      feedDownLines(theirs).map((l) => l.outerHTML),
    );
    expect(feedDownLines(ours)).toHaveLength(feedStale ? 1 : 0);
    const ourComputed = popupValue(ours, 'Computed')?.firstElementChild ?? null;
    const theirComputed = theirs.querySelector('[data-sheet-field="computed"] span');
    expect(ourComputed?.className).toBe(theirComputed?.className);
  });
});

/**
 * One place for the wording: no file under src/components but MapPopup.tsx
 * writes it, so a surface cannot drift to its own copy. Tests are left out;
 * this one pins the words.
 */
it('the Feed down wording is written in MapPopup.tsx alone', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
    });
  }
  const files = sources(join(process.cwd(), 'src/components')).map((f) =>
    relative(process.cwd(), f),
  );
  expect(files.length).toBeGreaterThan(50);
  expect(files.filter((f) => /Feed down: built on/.test(readFileSync(f, 'utf8')))).toEqual([
    'src/components/console/map/MapPopup.tsx',
  ]);
});
