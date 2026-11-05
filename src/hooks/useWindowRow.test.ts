// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { renderHook } from './test-render';
import { useWindowRow } from './useWindowRow';

const A = fleetRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', truckNumber: 101 });
const B = fleetRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', truckNumber: 202 });

type Arg = { id: string | null; all: readonly (typeof A)[] };
const start = (arg: Arg) =>
  renderHook<Arg, typeof A | null>(({ id, all }) => useWindowRow(id, all), arg);

describe('the truck behind an open window', () => {
  it('is nothing while no window is open', () => {
    expect(start({ id: null, all: [A, B] }).current()).toBeNull();
  });

  it('is this poll’s row, so what the window shows stays live', () => {
    const { current, rerender } = start({ id: A.id, all: [A, B] });
    expect(current()).toBe(A);
    const moved = { ...A, status: 'ARRIVED' as const };
    rerender({ id: A.id, all: [moved, B] });
    expect(current()).toBe(moved);
  });

  it('stays on the last row it had when the truck is missing from the answer', () => {
    const { current, rerender } = start({ id: A.id, all: [A, B] });
    rerender({ id: A.id, all: [B] });
    expect(current()).toBe(A);
    rerender({ id: A.id, all: [] });
    expect(current()).toBe(A);
  });

  it('picks the live row up again when the truck comes back', () => {
    const { current, rerender } = start({ id: A.id, all: [A] });
    rerender({ id: A.id, all: [] });
    const back = { ...A, active: false };
    rerender({ id: A.id, all: [back] });
    expect(current()).toBe(back);
  });

  it('forgets the row once the window closes: reopening never finds the old one', () => {
    const { current, rerender } = start({ id: A.id, all: [A] });
    rerender({ id: null, all: [A] });
    expect(current()).toBeNull();
    rerender({ id: A.id, all: [] });
    expect(current()).toBeNull();
  });

  it('never answers for one truck with another truck’s row', () => {
    const { current, rerender } = start({ id: A.id, all: [A, B] });
    rerender({ id: B.id, all: [A] });
    expect(current()).toBeNull();
  });

  it('never has an id with no truck behind it on the first read', () => {
    expect(start({ id: A.id, all: [] }).current()).toBeNull();
  });
});
