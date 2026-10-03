import { describe, expect, it } from 'vitest';
import { buildHistoryWeek, type HistoryAssignment, type HistoryLoad, type HistoryStop } from './history';
import { addDays, mondayOf, zonedWallToUtc } from './history-week';

/**
 * §12.101 — what the week page says, from the records it is given. Every
 * instant is built as a wall time at the dispatch office and converted, so a
 * test reads like the week it describes.
 */

const TZ = 'America/Chicago';
const WEEK = { year: 2026, week: 40 }; // Mon Sep 28 – Sun Oct 4, 2026
const MON = mondayOf(WEEK);

/** Day 0–6 of the week (or outside it), at a wall time in Chicago, as ISO. */
const at = (day: number, hh: number, mm = 0) =>
  zonedWallToUtc(addDays(MON, day), hh, mm, TZ).toISOString();

let n = 0;
const stop = (over: Partial<HistoryStop> & Pick<HistoryStop, 'type'>): HistoryStop => ({
  sequence: 1,
  city: null,
  state: null,
  arrivedAt: null,
  departedAt: null,
  ...over,
});
const load = (over: Partial<HistoryLoad> & { stops: HistoryStop[] }): HistoryLoad => ({
  id: `load-${(n += 1)}`,
  number: null,
  status: 'DELIVERED',
  truckId: 'truck-1147',
  truckLabel: '1147',
  createdAt: at(0, 6),
  ...over,
});
const assignment = (over: Partial<HistoryAssignment>): HistoryAssignment => ({
  driverId: 'marcus',
  driverName: 'Marcus Reyes',
  truckId: 'truck-1147',
  truckLabel: '1147',
  startedAt: at(-30, 8),
  endedAt: null,
  ...over,
});

const build = (loads: HistoryLoad[], assignments: HistoryAssignment[] = [assignment({})]) =>
  buildHistoryWeek({ week: WEEK, timeZone: TZ, loads, assignments });

const cellTexts = (view: ReturnType<typeof build>, name: string) =>
  view.rows
    .find((r) => r.name === name)!
    .cells.map((c) => c.entries.map((e) => `${e.number ?? '—'} ${e.route.full}`));

describe('which day a load sits on', () => {
  it('the day of its first arrival, in Chicago — Sunday 23:30 is Sunday', () => {
    const view = build([
      load({ number: '1', stops: [stop({ type: 'DEL', city: 'Fargo', state: 'ND', arrivedAt: at(6, 23, 30) })] }),
    ]);
    expect(cellTexts(view, 'Marcus Reyes')[6]).toEqual(['1 DEL Fargo, ND']);
  });

  it('the first arrival among its stops, not the stop listed first', () => {
    const view = build([
      load({
        number: '2',
        stops: [
          stop({ type: 'PU', sequence: 1, city: 'Joliet', state: 'IL', arrivedAt: at(2, 9) }),
          stop({ type: 'DEL', sequence: 2, city: 'Fargo', state: 'ND', arrivedAt: at(1, 9) }),
        ],
      }),
    ]);
    expect(cellTexts(view, 'Marcus Reyes')[1]).toEqual(['2 Joliet, IL → Fargo, ND']);
  });

  it('falls back to the departure when no arrival was recorded', () => {
    const view = build([
      load({ number: '3', stops: [stop({ type: 'PU', city: 'Joliet', state: 'IL', departedAt: at(3, 14) })] }),
    ]);
    expect(cellTexts(view, 'Marcus Reyes')[3]).toEqual(['3 PU Joliet, IL']);
  });

  it('leaves a load that falls in another week out of this one', () => {
    const view = build([
      load({ number: '4', stops: [stop({ type: 'DEL', city: 'Fargo', arrivedAt: at(7, 0, 1) })] }),
    ]);
    expect(view.rows[0]!.cells.every((c) => c.entries.length === 0)).toBe(true);
  });
});

describe('the stop as entered', () => {
  it.each([
    [{ city: 'Fargo', state: 'ND' }, 'DEL Fargo, ND'],
    [{ city: 'Fargo', state: null }, 'DEL Fargo'],
    [{ city: null, state: 'ND' }, 'DEL ND'],
    [{ city: null, state: null }, 'DEL, no place entered'],
  ])('%j reads "%s"', (place, text) => {
    const view = build([load({ stops: [stop({ type: 'DEL', ...place, arrivedAt: at(0, 9) })] })]);
    expect(view.rows[0]!.cells[0]!.entries[0]!.route.full).toBe(text);
  });
});

describe('a pickup and a delivery pair only under all four rules', () => {
  const pu = (over: Partial<HistoryLoad> = {}, arrived = at(0, 7)) =>
    load({ number: '48213', stops: [stop({ type: 'PU', city: 'Melrose Park', state: 'IL', arrivedAt: arrived })], ...over });
  const del = (over: Partial<HistoryLoad> = {}, arrived: string | null = at(1, 16)) =>
    load({ number: '48213', stops: [stop({ type: 'DEL', city: 'Fargo', state: 'ND', arrivedAt: arrived })], ...over });

  it('pairs: same number, same truck, both reached, pickup first — one entry, on the pickup day', () => {
    const view = build([pu(), del()]);
    const days = cellTexts(view, 'Marcus Reyes');
    expect(days[0]).toEqual(['48213 Melrose Park, IL → Fargo, ND']);
    expect(days[1]).toEqual([]);
    // Both stops, both dates, in the tooltip.
    expect(view.rows[0]!.cells[0]!.entries[0]!.tip.stops.map((s) => [s.kind, s.arrived])).toEqual([
      ['Pickup', 'Mon 28 · 07:00 CDT'],
      ['Delivery', 'Tue 29 · 16:00 CDT'],
    ]);
  });

  it.each([
    ['different numbers', [pu(), del({ number: '48214' })]],
    ['no number on either', [pu({ number: null }), del({ number: null })]],
    ['different trucks', [pu(), del({ truckId: 'truck-1162', truckLabel: '1162' })]],
    ['delivery reached first', [pu({}, at(2, 7)), del({}, at(1, 16))]],
  ] as const)('does not pair with %s', (_, loads) => {
    // Every row: a load on a truck nobody drives is under "No driver assigned".
    const view = build([...loads]);
    const all = view.rows.flatMap((r) => cellTexts(view, r.name).flat());
    expect(all).toHaveLength(2);
    expect(all.some((t) => t.includes('→'))).toBe(false);
  });

  it('does not pair with a delivery not reached — the pickup stands alone', () => {
    const view = build([pu(), del({}, null)]);
    expect(cellTexts(view, 'Marcus Reyes').flat()).toEqual(['48213 PU Melrose Park, IL']);
  });
});

describe('who the load belongs to', () => {
  it('the driver assigned to its truck at that moment — across a mid-week truck change', () => {
    const assignments = [
      // Dana drives 1162 Mon–Tue, then 1188 from Wednesday.
      assignment({ driverId: 'dana', driverName: 'Dana Kowalski', truckId: 'truck-1162', truckLabel: '1162', startedAt: at(-10, 8), endedAt: at(2, 6) }),
      assignment({ driverId: 'dana', driverName: 'Dana Kowalski', truckId: 'truck-1188', truckLabel: '1188', startedAt: at(2, 6) }),
      // Luis takes 1162 over from Wednesday.
      assignment({ driverId: 'luis', driverName: 'Luis Ortega', truckId: 'truck-1162', truckLabel: '1162', startedAt: at(2, 7) }),
    ];
    const view = build(
      [
        load({ number: 'A', truckId: 'truck-1162', truckLabel: '1162', stops: [stop({ type: 'DEL', city: 'Milwaukee', state: 'WI', arrivedAt: at(0, 10) })] }),
        load({ number: 'B', truckId: 'truck-1188', truckLabel: '1188', stops: [stop({ type: 'DEL', city: 'Rockford', state: 'IL', arrivedAt: at(2, 10) })] }),
        load({ number: 'C', truckId: 'truck-1162', truckLabel: '1162', stops: [stop({ type: 'DEL', city: 'Gary', state: 'IN', arrivedAt: at(3, 10) })] }),
      ],
      assignments,
    );
    const dana = view.rows.find((r) => r.name === 'Dana Kowalski')!;
    expect(dana.trucks).toEqual([
      { label: '1162', days: 'Mon–Wed', partial: true },
      { label: '1188', days: 'Wed–Sun', partial: true },
    ]);
    expect(cellTexts(view, 'Dana Kowalski')[0]).toEqual(['A DEL Milwaukee, WI']);
    expect(cellTexts(view, 'Dana Kowalski')[2]).toEqual(['B DEL Rockford, IL']);
    // Truck shown on each load only when the driver used more than one.
    expect(dana.cells[0]!.entries[0]!.truck).toBe('1162');
    expect(cellTexts(view, 'Luis Ortega')[3]).toEqual(['C DEL Gary, IN']);
    expect(view.rows.find((r) => r.name === 'Luis Ortega')!.cells[3]!.entries[0]!.truck).toBeNull();
  });

  it('says "No truck" on days the driver had none, and only on days without a load', () => {
    const view = build([], [assignment({ startedAt: at(-5, 8), endedAt: at(2, 18) })]);
    expect(view.rows[0]!.cells.map((c) => c.noTruck)).toEqual([false, false, false, true, true, true, true]);
    expect(view.rows[0]!.trucks).toEqual([{ label: '1147', days: 'Mon–Wed', partial: true }]);
  });

  it('lists a load on a truck nobody was assigned to under "No driver assigned"', () => {
    const view = build(
      [load({ truckId: 'truck-9', truckLabel: '9', number: 'X', stops: [stop({ type: 'DEL', city: 'Gary', arrivedAt: at(1, 9) })] })],
      [],
    );
    expect(view.rows.map((r) => [r.name, r.driverId])).toEqual([['No driver assigned', null]]);
  });

  it('lists an assigned driver with no loads, as a row with nothing in it', () => {
    const view = build([], [assignment({ driverId: 'tomasz', driverName: 'Tomasz Wiśniewski' })]);
    expect(view.rows.map((r) => [r.name, r.loadCount])).toEqual([['Tomasz Wiśniewski', 0]]);
  });
});

describe('the two lists under the table', () => {
  it('"Not reached this week": loads created this week with no stop reached, labelled with the day', () => {
    const view = build([
      load({ number: '48231', createdAt: at(0, 6), status: 'DISPATCHED', stops: [stop({ type: 'PU', city: 'Melrose Park', state: 'IL' })] }),
      // Created last week: it belongs to last week's list.
      load({ number: '48100', createdAt: at(-3, 6), stops: [stop({ type: 'DEL', city: 'Gary' })] }),
    ]);
    expect(view.notReached).toEqual([
      {
        loadId: expect.any(String),
        number: '48231',
        route: { pre: 'PU', full: 'PU Melrose Park, IL' },
        driver: 'Marcus Reyes',
        truck: '1147',
        created: 'created Mon Sep 28, no arrival recorded',
      },
    ]);
  });

  it('"No load number": every entry in the table without one, by day', () => {
    const view = build([load({ number: null, stops: [stop({ type: 'DEL', city: 'Green Bay', state: 'WI', arrivedAt: at(1, 9) })] })]);
    expect(view.noNumber.map((x) => [x.day, x.route.full, x.driver, x.truck, x.status])).toEqual([
      ['Tue 29', 'DEL Green Bay, WI', 'Marcus Reyes', '1147', 'delivered'],
    ]);
  });
});

describe('the status each load shows', () => {
  it.each([
    ['DELIVERED', 'delivered'],
    ['CANCELLED', 'cancelled'],
    ['TONU', 'tonu'],
    ['LOADED', 'progress'],
    ['DISPATCHED', 'progress'],
  ] as const)('%s → %s', (status, kind) => {
    const view = build([load({ status, stops: [stop({ type: 'DEL', city: 'Gary', arrivedAt: at(1, 9) })] })]);
    expect(view.rows[0]!.cells[1]!.entries[0]!.status).toBe(kind);
  });

  it('says why a stop has no time: "Not yet" in progress, "Not reached" cancelled', () => {
    const multi = (status: HistoryLoad['status']) =>
      build([
        load({
          status,
          stops: [
            stop({ type: 'PU', sequence: 1, city: 'Joliet', arrivedAt: at(1, 9), departedAt: at(1, 10) }),
            stop({ type: 'DEL', sequence: 2, city: 'Fargo' }),
          ],
        }),
      ]).rows[0]!.cells[1]!.entries[0]!.tip.stops[1]!.arrived;
    expect(multi('LOADED')).toBe('Not yet');
    expect(multi('CANCELLED')).toBe('Not reached');
  });
});
