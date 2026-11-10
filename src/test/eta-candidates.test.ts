import { describe, expect, it } from 'vitest';
import {
  MIN_GAIN_MINUTES,
  candidateErrors,
  fitConstant,
  judge,
  lateAtMarks,
} from '../../scripts/eta-candidates.mjs';
import type { Scored, StopRow, Variant } from '../../scripts/eta-trips.mjs';

/**
 * The 3bh candidates and their rule (§12.150). Invented rows only: no stop,
 * truck or time here is real.
 */

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5, 12);

/**
 * One scored row. `routeSpeed` and `capped` are minutes from T0 to that ETA;
 * the truck arrives `arrived` minutes after T0, `stopped` of them stationary.
 */
function row(over: {
  truck: number;
  routeSpeed: number;
  arrived: number;
  capped?: number;
  stopped?: number | null;
  mark?: number;
  basis?: string;
  deadline?: number | null;
}): Scored {
  const stop: StopRow = {
    stop_id: `stop-${over.truck}-${over.arrived}-${over.mark ?? 100}`,
    truck_id: `truck-${over.truck}`,
    truck_number: over.truck,
    city: null,
    state: null,
    zip: null,
    lat: 45,
    lng: -95,
    precision: 'street',
    arrived_at: new Date(T0 + over.arrived * MIN),
    arrived_source: 'detected',
    load_created_at: new Date(T0 - 24 * 60 * MIN),
  };
  const capped = T0 + (over.capped ?? over.routeSpeed) * MIN;
  const eta: Record<Variant, number | null> = {
    shown: capped,
    routed: capped,
    'lane-estimate': null,
    'straight-line': capped,
    'here-raw': T0 + over.routeSpeed * MIN,
    capped,
    'route-speed': T0 + over.routeSpeed * MIN,
    'zip-what-if': null,
  };
  return {
    stop,
    place: 'invented',
    mark: over.mark ?? 100,
    source: 'log',
    atMiles: 99,
    anchorMs: T0,
    basisShown: over.basis ?? 'routed',
    stopped: over.stopped === undefined ? 0 : over.stopped,
    deadlineMs: over.deadline === undefined || over.deadline === null ? null : T0 + over.deadline * MIN,
    eta,
  };
}

describe('the constant', () => {
  it('is the median driving-only error, in whole minutes', () => {
    const rows = [
      row({ truck: 1, routeSpeed: 100, arrived: 104 }),
      row({ truck: 2, routeSpeed: 100, arrived: 109.4 }),
      // 50 minutes after the ETA, 30 of them parked: 20 of driving.
      row({ truck: 3, routeSpeed: 100, arrived: 150, stopped: 30 }),
    ];
    expect(fitConstant(rows).all).toBe(9);
    expect(fitConstant(rows).rows).toBe(3);
  });

  it('is fitted for each truck without that truck', () => {
    const rows = [
      row({ truck: 1, routeSpeed: 100, arrived: 104 }),
      row({ truck: 1, routeSpeed: 100, arrived: 106 }),
      row({ truck: 2, routeSpeed: 100, arrived: 120 }),
      row({ truck: 3, routeSpeed: 100, arrived: 130 }),
    ];
    const fit = fitConstant(rows);
    // Without 1: 20 and 30. Without 2: 4, 6, 30. Without 3: 4, 6, 20.
    expect([fit.without.get(1), fit.without.get(2), fit.without.get(3)]).toEqual([25, 6, 6]);
  });

  it('is not fitted on a row with no route, or one whose stops are unknown', () => {
    const rows = [
      row({ truck: 1, routeSpeed: 100, arrived: 110 }),
      row({ truck: 2, routeSpeed: 100, arrived: 190, basis: 'straight-line' }),
      row({ truck: 3, routeSpeed: 100, arrived: 170, stopped: null }),
    ];
    expect(fitConstant(rows)).toMatchObject({ all: 10, rows: 1 });
  });

  it('has nothing to offer a truck when no other truck has a row', () => {
    const fit = fitConstant([row({ truck: 1, routeSpeed: 100, arrived: 110 })]);
    expect(fit.without.get(1)).toBeNull();
  });
});

describe('A and B on the same rows', () => {
  const rows = [
    row({ truck: 1, routeSpeed: 100, arrived: 110 }),
    row({ truck: 2, routeSpeed: 100, arrived: 112 }),
    row({ truck: 3, routeSpeed: 100, arrived: 114 }),
  ];

  it('adds each row’s constant once, to the ETA', () => {
    const e = candidateErrors(rows, fitConstant(rows), true);
    expect(e.a).toEqual([10, 12, 14]);
    // Constants without 1, 2, 3: 13, 12, 11. The ETA is later, so the error falls.
    expect(e.b).toEqual([-3, 0, 3]);
    expect(e.noFit).toBe(0);
  });

  it('leaves a straight-line row as it is', () => {
    const withStraight = [...rows, row({ truck: 4, routeSpeed: 100, arrived: 140, basis: 'straight-line' })];
    const e = candidateErrors(withStraight, fitConstant(withStraight), true);
    expect(e.a[3]).toBe(40);
    expect(e.b[3]).toBe(40);
  });

  it('keeps the minutes stopped in the as-seen error', () => {
    const stopped = [...rows, row({ truck: 4, routeSpeed: 100, arrived: 200, stopped: 90 })];
    const fit = fitConstant(stopped);
    expect(candidateErrors(stopped, fit, true).a[3]).toBe(10);
    expect(candidateErrors(stopped, fit, false).a[3]).toBe(100);
    // Fitted without truck 4: 12.
    expect(candidateErrors(stopped, fit, false).b[3]).toBe(88);
  });

  it('drops a row with no other truck to fit from out of both', () => {
    const alone = [row({ truck: 1, routeSpeed: 100, arrived: 110 })];
    expect(candidateErrors(alone, fitConstant(alone), true)).toEqual({ a: [], b: [], noFit: 1 });
  });
});

describe('the rule', () => {
  it('is three minutes', () => {
    expect(MIN_GAIN_MINUTES).toBe(3);
  });

  it('takes B when it gains 3 minutes at every distance and raises no worst case', () => {
    const v = judge([
      { mark: 200, a: [16, 18, 20], b: [7, 9, 11] },
      { mark: 25, a: [6, 7, 8], b: [3, 4, 5] },
    ]);
    expect(v.marks.map((m) => m.gain)).toEqual([9, 3]);
    expect(v.shipB).toBe(true);
  });

  it('takes A when one distance gains less than 3 minutes', () => {
    const v = judge([
      { mark: 200, a: [16, 18, 20], b: [7, 9, 11] },
      { mark: 25, a: [6, 7, 8], b: [3.5, 4.5, 5.5] },
    ]);
    expect(v.marks.map((m) => m.gainEnough)).toEqual([true, false]);
    expect(v.shipB).toBe(false);
  });

  it('takes A when B raises the worst case at any distance', () => {
    const v = judge([
      { mark: 200, a: [16, 18, 20], b: [7, 9, 11] },
      { mark: 25, a: [6, 7, 8], b: [-1, 1, -9] },
    ]);
    expect(v.marks[1]).toMatchObject({ gainEnough: true, worstRaised: true });
    expect(v.shipB).toBe(false);
  });

  it('takes A when there is nothing to judge', () => {
    expect(judge([]).shipB).toBe(false);
    expect(judge([{ mark: 200, a: [], b: [] }]).shipB).toBe(false);
  });
});

describe('LATE at the mark', () => {
  it('counts a warning the cap gave and the route’s speed does not', () => {
    const rows = [
      // Deadline at 120. The cap said 130, the route's speed 115, the truck took 125.
      row({ truck: 1, capped: 130, routeSpeed: 115, arrived: 125, deadline: 120 }),
      // The cap said 130; the truck made it at 118.
      row({ truck: 2, capped: 130, routeSpeed: 115, arrived: 118, deadline: 120 }),
      // Late under both.
      row({ truck: 3, capped: 140, routeSpeed: 125, arrived: 126, deadline: 120 }),
      // Parked on the way: neither saw it.
      row({ truck: 4, capped: 110, routeSpeed: 100, arrived: 300, deadline: 120 }),
    ];
    const [at] = lateAtMarks(rows, [100]);
    expect(at!.actuallyLate).toEqual({ n: 3, before: 2, after: 1, lost: 1, gained: 0 });
    expect(at!.onTime).toEqual({ n: 1, before: 1, after: 0, lost: 1, gained: 0 });
  });

  it('is LATE only past the deadline, as the engine is', () => {
    const [at] = lateAtMarks([row({ truck: 1, capped: 120, routeSpeed: 120, arrived: 119, deadline: 120 })], [100]);
    expect(at!.onTime).toMatchObject({ n: 1, before: 0, after: 0 });
  });

  it('does not replay a row with no deadline stored at the mark', () => {
    const rows = [
      row({ truck: 1, routeSpeed: 100, arrived: 110, deadline: null }),
      row({ truck: 2, routeSpeed: 100, arrived: 110, deadline: 105, mark: 50 }),
    ];
    const [at100, at50] = lateAtMarks(rows, [100, 50]);
    expect(at100).toMatchObject({ notReplayable: 1, actuallyLate: { n: 0 }, onTime: { n: 0 } });
    expect(at50).toMatchObject({ notReplayable: 0, actuallyLate: { n: 1 } });
  });

  it('says when the deadline had already passed at the mark', () => {
    const [at] = lateAtMarks([row({ truck: 1, routeSpeed: 100, arrived: 110, deadline: -30 })], [100]);
    expect(at!.pastAtMark).toBe(1);
    expect(at!.actuallyLate).toMatchObject({ n: 1, before: 1, after: 1 });
  });
});
