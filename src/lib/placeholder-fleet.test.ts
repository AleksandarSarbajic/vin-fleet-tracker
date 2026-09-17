import { describe, expect, it } from 'vitest';
import { STATUSES, type Status } from '@/lib/status';
import { applyPlaceholders, type Placeholdable } from './placeholder-fleet';

const fleet = (n: number): Placeholdable[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    truckNumber: 1100 + i,
    driverName: null,
    status: 'ON_TIME' as Status,
    driverIsPlaceholder: false,
  }));

const drivers = ['R. Nowak', 'D. Petrov', 'M. Kowalczyk', 'P. Ziółkowski'];

describe('applyPlaceholders', () => {
  it('shows every status at least once on a 23-truck fleet', () => {
    // The whole point: see the full palette on real tiles before phase 5.
    const seen = new Set(applyPlaceholders(fleet(23), drivers).map((r) => r.status));
    for (const s of STATUSES) expect(seen).toContain(s);
  });

  it('includes STALE_GPS so the hatched marker is visible', () => {
    // The hatch is the marker most likely to read badly at small sizes.
    const out = applyPlaceholders(fleet(23), drivers);
    expect(out.filter((r) => r.status === 'STALE_GPS').length).toBeGreaterThan(0);
  });

  it('is deterministic — a reload does not reshuffle the colours', () => {
    const a = applyPlaceholders(fleet(23), drivers).map((r) => r.status);
    const b = applyPlaceholders(fleet(23), drivers).map((r) => r.status);
    expect(a).toEqual(b);
  });

  it('assigns by truck number, so database order does not change the result', () => {
    const forward = applyPlaceholders(fleet(23), drivers);
    const reversed = applyPlaceholders([...fleet(23)].reverse(), drivers);
    const byId = new Map(reversed.map((r) => [r.id, r.status]));
    for (const row of forward) expect(byId.get(row.id)).toBe(row.status);
  });

  it('never hands a driver to an UNASSIGNED truck', () => {
    // The row reads "Unassigned" in the driver cell (design-spec §5.8) — a
    // name there would contradict the status chip beside it.
    for (const row of applyPlaceholders(fleet(23), drivers)) {
      if (row.status === 'UNASSIGNED') expect(row.driverName).toBeNull();
    }
  });

  it('a real assignment always beats the placeholder', () => {
    const rows = fleet(3);
    rows[1]!.driverName = 'REAL PERSON';
    const out = applyPlaceholders(rows, drivers);
    const real = out.find((r) => r.id === 'id-1')!;
    expect(real.driverName).toBe('REAL PERSON');
    expect(real.driverIsPlaceholder).toBe(false);
  });

  it('flags fabricated drivers so the UI can tell them apart', () => {
    const out = applyPlaceholders(fleet(5), drivers);
    const fabricated = out.filter((r) => r.driverName !== null);
    expect(fabricated.every((r) => r.driverIsPlaceholder)).toBe(true);
  });

  it('survives an empty driver list', () => {
    const out = applyPlaceholders(fleet(5), []);
    expect(out.every((r) => r.driverName === null)).toBe(true);
  });
});
