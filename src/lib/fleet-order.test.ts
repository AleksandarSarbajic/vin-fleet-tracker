import { describe, expect, it } from 'vitest';
import { STATUSES, type Status } from './status';
import { compareFleet, type Sortable } from './fleet-order';

/**
 * This test owns the sort. It builds its own rows and imports nothing from
 * `placeholder-fleet`, so it still runs — unchanged — after phase 5 deletes
 * the placeholder and the real engine supplies these statuses.
 *
 * It exists because the sort was briefly unverifiable on screen: the
 * placeholder derived status from truck number in urgency order, so urgency
 * order and truck-number order were accidentally identical and the rendered
 * list looked correct whether or not the comparator did anything.
 */

const row = (
  truckNumber: number,
  status: Status,
  apptAt: string | null = null,
): Sortable => ({ truckNumber, status, apptAt });

const sorted = (rows: Sortable[], mode: 'urgency' | 'truck' = 'urgency') =>
  [...rows].sort(compareFleet(mode));

const numbers = (rows: Sortable[]) => rows.map((r) => r.truckNumber);

describe('compareFleet — urgency', () => {
  it('puts the bands in LATE … TOMORROW order from a shuffled input', () => {
    // Truck numbers run DOWN as urgency runs down, so a comparator that
    // silently fell through to truck number would produce exactly the
    // reverse of this and fail loudly.
    const shuffled: Sortable[] = [
      row(210, 'ON_TIME'),
      row(120, 'NO_APPT'),
      row(310, 'LATE'),
      row(140, 'ARRIVED'),
      row(110, 'TOMORROW'),
      row(260, 'AT_RISK'),
      row(280, 'UNASSIGNED'),
      row(290, 'STALE_GPS'),
    ];

    expect(sorted(shuffled).map((r) => r.status)).toEqual([...STATUSES]);
    expect(numbers(sorted(shuffled))).toEqual([310, 290, 280, 260, 120, 140, 210, 110]);
  });

  it('sorts by appointment time ascending within a band', () => {
    const band: Sortable[] = [
      row(101, 'AT_RISK', '2026-09-17T18:00:00.000Z'),
      row(102, 'AT_RISK', '2026-09-17T06:30:00.000Z'),
      row(103, 'AT_RISK', '2026-09-17T12:15:00.000Z'),
    ];
    // Ascending by APPOINTMENT, which here is the exact reverse of neither
    // truck number nor input order.
    expect(numbers(sorted(band))).toEqual([102, 103, 101]);
  });

  it('keeps appointment order inside a band without reordering the bands', () => {
    const mixed: Sortable[] = [
      row(150, 'ON_TIME', '2026-09-17T09:00:00.000Z'),
      row(151, 'LATE', '2026-09-17T23:00:00.000Z'),
      row(152, 'ON_TIME', '2026-09-17T07:00:00.000Z'),
      row(153, 'LATE', '2026-09-17T04:00:00.000Z'),
    ];
    // Both LATE rows first even though one holds the LATEST appointment of
    // the four: the band always outranks the clock.
    expect(numbers(sorted(mixed))).toEqual([153, 151, 152, 150]);
  });

  it('sorts a missing appointment last within its band, not first', () => {
    // A null must never read as epoch zero — that would park every
    // appointment-less truck at the top of its band.
    const band: Sortable[] = [
      row(201, 'ON_TIME', null),
      row(202, 'ON_TIME', '2026-09-17T20:00:00.000Z'),
      row(203, 'ON_TIME', '2026-09-17T08:00:00.000Z'),
    ];
    expect(numbers(sorted(band))).toEqual([203, 202, 201]);
  });

  it('treats an absent apptAt exactly like null', () => {
    // FleetRow has no apptAt until phase 4. Absent and null must not sort
    // differently, or the order will shift the day the field appears.
    const band: Sortable[] = [
      { truckNumber: 301, status: 'ON_TIME' },
      row(302, 'ON_TIME', null),
      row(303, 'ON_TIME', '2026-09-17T08:00:00.000Z'),
    ];
    expect(numbers(sorted(band))).toEqual([303, 301, 302]);
  });

  it('falls through to truck number when band and appointment match', () => {
    const appt = '2026-09-17T08:00:00.000Z';
    const tie = [row(147, 'LATE', appt), row(113, 'LATE', appt), row(126, 'LATE', appt)];
    expect(numbers(sorted(tie))).toEqual([113, 126, 147]);
  });

  it('sorts a truck with no number last, never as zero', () => {
    // One vehicle in the org is named literally "Truck" and carries no
    // digits (docs/samsara.md). As zero it would head the list.
    const rows: Sortable[] = [
      { truckNumber: null, status: 'ON_TIME' },
      row(140, 'ON_TIME'),
      row(113, 'ON_TIME'),
    ];
    expect(numbers(sorted(rows))).toEqual([113, 140, null]);
  });

  it('never returns NaN, so the order is total and stable', () => {
    // Infinity - Infinity is NaN, and a comparator returning NaN leaves the
    // array in an implementation-defined order.
    const pairs: Sortable[] = [
      { truckNumber: null, status: 'LATE' },
      { truckNumber: null, status: 'LATE' },
      row(100, 'TOMORROW', null),
      row(100, 'TOMORROW', null),
    ];
    const compare = compareFleet('urgency');
    for (const a of pairs) {
      for (const b of pairs) expect(Number.isNaN(compare(a, b))).toBe(false);
    }
  });

  it('is antisymmetric across every pair of statuses', () => {
    const compare = compareFleet('urgency');
    for (const a of STATUSES) {
      for (const b of STATUSES) {
        const forward = compare(row(100, a), row(100, b));
        const back = compare(row(100, b), row(100, a));
        // Summed rather than negated: -Math.sign(0) is -0, and toBe uses
        // Object.is, which separates -0 from 0.
        expect(Math.sign(forward) + Math.sign(back)).toBe(0);
      }
    }
  });

  it('does not order by truck number — the regression this file exists for', () => {
    // Every problem truck outranks every healthy one regardless of number.
    const fleet: Sortable[] = [
      row(113, 'ON_TIME'),
      row(116, 'LATE'),
      row(122, 'STALE_GPS'),
      row(124, 'TOMORROW'),
      row(140, 'LATE'),
      row(147, 'ON_TIME'),
    ];
    const order = numbers(sorted(fleet));
    expect(order).toEqual([116, 140, 122, 113, 147, 124]);
    expect(order).not.toEqual([...order].sort((a, b) => a! - b!));
  });
});

describe('compareFleet — truck', () => {
  it('ignores status entirely', () => {
    const fleet: Sortable[] = [
      row(147, 'LATE'),
      row(113, 'TOMORROW'),
      row(140, 'STALE_GPS'),
    ];
    expect(numbers(sorted(fleet, 'truck'))).toEqual([113, 140, 147]);
  });

  it('ignores appointment time', () => {
    const fleet: Sortable[] = [
      row(147, 'ON_TIME', '2026-09-17T01:00:00.000Z'),
      row(113, 'ON_TIME', '2026-09-17T23:00:00.000Z'),
    ];
    expect(numbers(sorted(fleet, 'truck'))).toEqual([113, 147]);
  });
});
