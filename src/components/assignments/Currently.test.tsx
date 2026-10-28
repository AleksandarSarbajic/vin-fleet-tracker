// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Currently } from './Currently';
import { TruckRow } from '@/components/console/TruckRow';
import { fleetRow, type FleetRowOver } from '@/test/fleet-row';
import { boardElement, testQueryClient } from '@/test/assignment-board';
import type { FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';
import type { AssignmentBoard as Board, BoardDriver } from '@/server/assignments';
import type { Role } from '@/lib/roles';

/**
 * §12.145. The board's Currently column: the console row's chip and the
 * truck's position, for the SAVED assignment, from the console's own poll.
 *
 * Invented data only (the repo is public).
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const FETCHED_AT = '2026-10-28T12:00:00.000Z';
/** 48 minutes before the fetch: the age a stale chip prints. */
const FIX_AT = '2026-10-28T11:12:00.000Z';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  client = testQueryClient();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The board's merge prompt asks for candidates on mount.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
});

const live = (over: FleetRowOver = {}): FleetRow =>
  fleetRow({
    recordedAt: FIX_AT,
    formattedLocation: 'I-80 E, Joliet, IL, 60431',
    cityState: 'Joliet, IL',
    ...over,
  });

/** The cell alone, as the board lays it out. */
function cell(row: FleetRow | undefined, feedStale = false): HTMLElement {
  act(() => {
    root.render(
      <div data-currently="">
        <Currently row={row} feedStale={feedStale} fetchedAt={FETCHED_AT} />
      </div>,
    );
  });
  return container.querySelector<HTMLElement>('[data-currently]')!;
}

const chipOf = (el: Element) => el.querySelector<HTMLElement>('span[class*="h-[21px]"]');

/** The console's own row for the same truck, in its own root. */
function consoleRow(row: FleetRow, feedStale: boolean): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const other = createRoot(host);
  act(() => {
    other.render(
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
    );
  });
  const copy = host.cloneNode(true) as HTMLElement;
  act(() => other.unmount());
  host.remove();
  return copy;
}

const OVERRIDE = {
  forcedStatus: 'LATE' as const,
  reason: 'RECEIVER_CONFIRMED_DETENTION' as const,
  reasonNote: null,
  setByName: 'Test Dispatcher',
  setAtUtc: '2026-10-28T10:00:00.000Z',
  expiresAtUtc: '2026-10-28T18:00:00.000Z',
};

describe('the chip is the console row’s chip (§12.145)', () => {
  const cases: [string, FleetRowOver, boolean][] = [
    ['on time', { status: 'ON_TIME' }, false],
    ['at risk', { status: 'AT_RISK' }, false],
    ['late', { status: 'LATE' }, false],
    ['arrived', { status: 'ARRIVED' }, false],
    ['no appointment', { status: 'NO_APPT' }, false],
    ['upcoming, no day', { status: 'TOMORROW', upcoming: null }, false],
    ['upcoming tomorrow', { status: 'TOMORROW', upcoming: { day: '2026-10-29', tomorrow: true } }, false],
    ['upcoming on a later day', { status: 'TOMORROW', upcoming: { day: '2026-10-31', tomorrow: false } }, false],
    ['its own stale GPS', { status: 'STALE_GPS' }, false],
    ['forced late', { status: 'LATE', override: OVERRIDE }, false],
    ['on time, feed stale', { status: 'ON_TIME' }, true],
    ['forced late, feed stale', { status: 'LATE', override: OVERRIDE }, true],
    ['upcoming, feed stale', { status: 'TOMORROW', upcoming: { day: '2026-10-29', tomorrow: true } }, true],
  ];

  it.each(cases)('%s: the same chip and the same position as the console row', (_name, over, feedStale) => {
    const row = live(over);
    const theirs = consoleRow(row, feedStale);
    const theirChips = theirs.querySelectorAll('span[class*="h-[21px]"]');
    expect(theirChips).toHaveLength(1);
    const theirPosition = theirs.querySelector('[title="I-80 E, Joliet, IL, 60431"]')!;

    const ours = cell(row, feedStale);
    expect(chipOf(ours)!.outerHTML).toBe(theirChips[0]!.outerHTML);
    const position = ours.querySelector('[data-position]')!;
    expect(position.textContent).toBe(theirPosition.textContent);
    expect(position.getAttribute('title')).toBe('I-80 E, Joliet, IL, 60431');
  });
});

describe('what the cell says (§12.145)', () => {
  it.each([
    ['ON_TIME', 'On time', 'text-status-ontime-fg'],
    ['AT_RISK', 'At risk', 'text-status-risk-fg'],
    ['LATE', 'Late', 'text-status-late-fg'],
    ['ARRIVED', 'Arrived', 'text-status-arrived-fg'],
    ['NO_APPT', 'No appt', 'border-dashed'],
    ['TOMORROW', 'Upcoming', 'text-status-tomorrow-fg'],
    ['STALE_GPS', '48m', 'border-dotted'],
  ] as const)('%s: the chip says "%s"', (status, word, mark) => {
    const el = cell(live({ status }));
    const chip = chipOf(el)!;
    expect(chip.textContent).toBe(word);
    expect(chip.className).toContain(mark);
    expect(el.querySelector('[data-position]')!.textContent).toBe(
      status === 'STALE_GPS' ? 'Last seen Joliet, IL' : 'Joliet, IL',
    );
  });

  it('an upcoming load names its day, as the console row does (§12.82)', () => {
    expect(chipOf(cell(live({ status: 'TOMORROW', upcoming: { day: '2026-10-29', tomorrow: true } })))!.textContent).toBe(
      'Tomorrow',
    );
    expect(chipOf(cell(live({ status: 'TOMORROW', upcoming: { day: '2026-10-31', tomorrow: false } })))!.textContent).toBe(
      'Sat 10/31',
    );
  });

  it('a forced chip says so (§9.5)', () => {
    expect(chipOf(cell(live({ status: 'LATE', override: OVERRIDE })))!.textContent).toBe('Late · forced');
  });

  it('no driver on the truck: "—", never the Unassigned chip, even with a load', () => {
    const el = cell(live({ driverName: null, status: 'UNASSIGNED', openLoadCount: 1 }));
    expect(el.textContent).toBe('—');
    expect(chipOf(el)).toBeNull();
    expect(el.textContent).not.toContain('Unassigned');
    expect(el.querySelector('[data-position]')).toBeNull();
  });

  it('no open load: the position only, no chip', () => {
    const el = cell(live({ status: 'NO_APPT', openLoadCount: 0, nextStop: null }));
    expect(chipOf(el)).toBeNull();
    const position = el.querySelector('[data-position]')!;
    expect(position.textContent).toBe('Joliet, IL');
    expect(position.className).toContain('text-text-muted');
    expect(el.textContent).toBe('Joliet, IL');
  });

  it('a stale feed withdraws the colour: the dotted neutral chip with the age, the position "Last seen" (§5.9)', () => {
    const el = cell(live({ status: 'ON_TIME' }), true);
    const chip = chipOf(el)!;
    expect(chip.textContent).toBe('48m');
    expect(chip.className).toContain('border-dotted');
    expect(chip.className).toContain('text-status-neutral-fg');
    expect(chip.className).not.toContain('ontime');
    const position = el.querySelector('[data-position]')!;
    expect(position.textContent).toBe('Last seen Joliet, IL');
    expect(position.className).toContain('text-status-neutral-fg');
  });

  it('a stale feed and no load: "Last seen", no chip', () => {
    const el = cell(live({ status: 'NO_APPT', openLoadCount: 0, nextStop: null }), true);
    expect(chipOf(el)).toBeNull();
    expect(el.textContent).toBe('Last seen Joliet, IL');
  });

  it('a truck with no fix says "—" where the position goes', () => {
    const el = cell(live({ status: 'NO_APPT', openLoadCount: 0, nextStop: null, cityState: null, formattedLocation: null }));
    expect(el.textContent).toBe('—');
    expect(el.querySelector('[data-position]')!.hasAttribute('title')).toBe(false);
  });

  it('a truck the poll did not carry: nothing', () => {
    expect(cell(undefined).innerHTML).toBe('');
  });

  it('shows the server’s status as given, even where the row’s own facts say otherwise', () => {
    // An appointment a week out and a fresh fix: an engine run here would
    // say Upcoming. The server said Late, so Late it is.
    const el = cell(
      live({
        status: 'LATE',
        computed: 'LATE',
        recordedAt: '2026-10-28T11:59:00.000Z',
        nextStop: { apptStartUtc: '2026-11-04T15:00:00.000Z', apptEndUtc: null },
      }),
    );
    expect(chipOf(el)!.textContent).toBe('Late');
  });
});

/* ------------------------------ on the board ----------------------------- */

const driver = (id: string, name: string): BoardDriver => ({
  id,
  name,
  active: true,
  source: 'samsara',
  samsaraDriverId: `sam-${id}`,
  phone: null,
  truckId: null,
  truckLabel: null,
});

const truck = (id: string, n: number, d: BoardDriver | null): Board['trucks'][number] => ({
  id,
  truckNumber: n,
  samsaraName: `Truck ${n}`,
  driverId: d?.id ?? null,
  driverName: d?.name ?? null,
  driverSource: d ? 'samsara' : null,
  driverSamsaraId: d?.samsaraDriverId ?? null,
  since: null,
});

const ANA = driver('d-ana', 'Ana Test');
const BEN = driver('d-ben', 'Ben Test');
const CY = driver('d-cy', 'Cy Free');

const BOARD: Board = {
  trucks: [truck('t-401', 401, ANA), truck('t-402', 402, BEN), truck('t-403', 403, null), truck('t-404', 404, null)],
  drivers: [ANA, BEN, CY],
};

const fleetOf = (rows: FleetRow[], over: Partial<FleetResponse> = {}): FleetResponse => ({
  fleet: rows,
  fetchedAt: FETCHED_AT,
  feedStale: false,
  feedNewestAt: FETCHED_AT,
  ...over,
});

const FLEET = fleetOf([
  live({ id: 't-401', truckNumber: 401, driverName: 'Ana Test', status: 'ON_TIME' }),
  live({ id: 't-402', truckNumber: 402, driverName: 'Ben Test', status: 'LATE', cityState: 'Peoria, IL', formattedLocation: 'Peoria, IL' }),
  live({ id: 't-403', truckNumber: 403, driverName: null, status: 'NO_APPT', openLoadCount: 0, nextStop: null }),
  // 404 is on the board and not in the poll. 999 is in the poll and not on the board.
  live({ id: 't-999', truckNumber: 999, driverName: 'Stray Test', status: 'LATE', cityState: 'Nowhere, ZZ', formattedLocation: 'Nowhere, ZZ' }),
]);

async function board(fleet: FleetResponse = FLEET, role: Role = 'dispatcher') {
  await act(async () => {
    root.render(boardElement(client, { board: BOARD, role, initialFleet: fleet }));
  });
}

const currently = (n: number) =>
  container
    .querySelector(`input[aria-label="Driver for truck ${n}"]`)!
    .closest('[class*="grid-cols"]')!
    .querySelector<HTMLElement>('[data-currently]')!;

async function pick(n: number, option: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="Driver for truck ${n}"]`)!;
  await act(async () => input.click());
  // A driver is an option; "Unassigned — clear this truck" is a plain button in the list.
  const choice = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="listbox"] button, [role="option"]'),
  ].find((o) => o.textContent?.includes(option))!;
  await act(async () => choice.click());
}

describe('Currently on the board (§12.145)', () => {
  it('joins each row to its own truck’s live row by id, and ignores a truck not on the board', async () => {
    await board();
    expect(chipOf(currently(401))!.textContent).toBe('On time');
    expect(currently(401).textContent).toContain('Joliet, IL');
    expect(chipOf(currently(402))!.textContent).toBe('Late');
    expect(currently(402).textContent).toContain('Peoria, IL');
    expect(currently(403).textContent).toBe('—');
    // On the board, not in the poll: nothing to say yet.
    expect(currently(404).innerHTML).toBe('');
    // In the poll, not on the board: no row, and its place appears nowhere.
    expect(container.querySelectorAll('[data-currently]')).toHaveLength(4);
    expect(container.textContent).not.toContain('Nowhere, ZZ');
    expect(container.textContent).not.toContain('999');
  });

  it('a draft change does not change it: it is the SAVED assignment’s live state', async () => {
    await board();
    const before401 = currently(401).innerHTML;
    // Clear 401 in the draft, and put a driver on 403 in the draft.
    await pick(401, 'Unassigned');
    await pick(403, 'Cy Free');
    // The draft took: both rows are marked changed, with their "was".
    expect(currently(401).closest('[class*="grid-cols"]')!.querySelector('[data-was]')).not.toBeNull();
    expect(currently(403).closest('[class*="grid-cols"]')!.querySelector('[data-was]')).not.toBeNull();
    // Currently did not move.
    expect(currently(401).innerHTML).toBe(before401);
    expect(chipOf(currently(401))!.textContent).toBe('On time');
    expect(currently(403).textContent).toBe('—');
  });

  it('a viewer sees the column, and nothing in it can be pressed or typed in', async () => {
    await board(FLEET, 'viewer');
    const header = container.querySelector('[class*="sticky"][class*="grid-cols"]')!;
    expect(header.textContent).toContain('Currently');
    for (const el of container.querySelectorAll('[data-currently]')) {
      expect(el.querySelector('button, a, input, select, textarea, [tabindex], [role="button"]')).toBeNull();
    }
    expect(chipOf(currently(402))!.textContent).toBe('Late');
  });

  it('a stale feed withdraws the colour on every row of the board', async () => {
    await board({ ...FLEET, feedStale: true });
    expect(chipOf(currently(401))!.textContent).toBe('48m');
    expect(chipOf(currently(402))!.className).toContain('border-dotted');
    expect(chipOf(currently(402))!.className).not.toContain('late');
  });

  it('the console’s 20s poll updates the cell', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const later = fleetOf(
      [live({ id: 't-401', truckNumber: 401, driverName: 'Ana Test', status: 'AT_RISK', cityState: 'Morris, IL', formattedLocation: 'Morris, IL' })],
      { fetchedAt: '2026-10-28T12:00:20.000Z' },
    );
    const asked: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      return url.startsWith('/api/fleet')
        ? new Response(JSON.stringify(later), { status: 200 })
        : new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await board();
    expect(chipOf(currently(401))!.textContent).toBe('On time');
    expect(asked.filter((u) => u.startsWith('/api/fleet'))).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      // The query tells its observers on a 0ms timer, also fake here.
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(asked.filter((u) => u.startsWith('/api/fleet'))).toHaveLength(1);
    expect(chipOf(currently(401))!.textContent).toBe('At risk');
    expect(currently(401).textContent).toContain('Morris, IL');
  });

  it('a refresh that brings a newer fleet is shown at once; an older one is not', async () => {
    await board();
    const newer = fleetOf(
      [live({ id: 't-403', truckNumber: 403, driverName: 'Cy Free', status: 'ON_TIME', cityState: 'Ottawa, IL', formattedLocation: 'Ottawa, IL' })],
      { fetchedAt: '2026-10-28T12:00:05.000Z' },
    );
    await board(newer);
    expect(chipOf(currently(403))!.textContent).toBe('On time');
    expect(currently(403).textContent).toContain('Ottawa, IL');

    const older = fleetOf([], { fetchedAt: '2026-10-28T11:59:00.000Z' });
    await board(older);
    // The query still holds the first fleet (12:00:00), which is newer than 11:59.
    expect(chipOf(currently(401))!.textContent).toBe('On time');
  });
});

/* -------------------------------- guards -------------------------------- */

const PAGE_SOURCES = [
  ...readdirSync(join(process.cwd(), 'src/components/assignments'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => join('src/components/assignments', f)),
  'src/app/assignments/page.tsx',
];

describe('guards (§12.145)', () => {
  it('no "Off duty" and no "Parked": not in the page’s output, not in its sources', async () => {
    for (const fleet of [FLEET, { ...FLEET, feedStale: true }]) {
      for (const role of ['dispatcher', 'viewer'] as const) {
        await board(fleet, role);
        const html = container.innerHTML.toLowerCase();
        expect(html).not.toContain('off duty');
        expect(html).not.toContain('off-duty');
        expect(html).not.toContain('parked');
      }
    }
    for (const file of PAGE_SOURCES) {
      const text = readFileSync(join(process.cwd(), file), 'utf8').toLowerCase();
      expect(text, file).not.toMatch(/off[ -]duty|parked/);
    }
  });

  it('no second status engine: the page draws the server’s status and never computes one', () => {
    expect(PAGE_SOURCES.length).toBeGreaterThan(5);
    for (const file of PAGE_SOURCES) {
      // The code, not the prose: a comment may name the engine it relies on.
      const code = readFileSync(join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(
        /\b(evaluate|applyStatus|isFeedStale|needsRecompute|statusConfig|STATUS_DEFAULTS|parseFleetRows)\b/,
      );
    }
  });
});
