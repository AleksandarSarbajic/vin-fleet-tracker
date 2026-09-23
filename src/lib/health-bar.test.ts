import { describe, expect, it } from 'vitest';
import { healthBar, healthText } from './health-bar';
import type { FleetHealth } from '@/server/health';

/** §14 feature 8, away from the DOM. */

const health = (over: Partial<FleetHealth> = {}): FleetHealth => ({
  day: '2026-09-23',
  onTime: 0,
  late: 0,
  unscheduled: 0,
  remaining: 0,
  ...over,
});

const widthOf = (h: FleetHealth, key: string) =>
  healthBar(h).segments.find((s) => s.key === key)?.count ?? -1;

describe('the proportions', () => {
  it('counts everything finished as done, however it went', () => {
    const bar = healthBar(health({ onTime: 6, late: 3, unscheduled: 2, remaining: 9 }));
    expect(bar.done).toBe(11);
    expect(bar.total).toBe(20);
  });

  /**
   * Fixed order, never sorted by size. A bar whose segments swap places as
   * the day goes on cannot be read at a glance — and the one thing a
   * dispatcher checks is whether the hatched band is growing.
   */
  it('draws in a fixed order', () => {
    expect(healthBar(health({ onTime: 1, late: 9 })).segments.map((s) => s.key)).toEqual([
      'onTime',
      'late',
      'unscheduled',
      'remaining',
    ]);
  });

  it('keeps empty segments in the list, at zero', () => {
    expect(widthOf(health({ onTime: 4, remaining: 1 }), 'late')).toBe(0);
  });

  /**
   * The fourth case §14.4's three treatments did not have. Scoring it as on
   * time flatters the board; scoring it as late invents a failure. It gets
   * its own segment and is named in the text.
   */
  it('keeps an unjudgeable arrival out of both outcome segments', () => {
    const h = health({ onTime: 2, unscheduled: 5 });
    expect(widthOf(h, 'onTime')).toBe(2);
    expect(widthOf(h, 'late')).toBe(0);
    expect(widthOf(h, 'unscheduled')).toBe(5);
  });
});

describe('what it says', () => {
  it('names late even at zero', () => {
    // An absent word reads as a strip that has not loaded; "0 late" is the
    // fact the dispatcher came for.
    expect(
      healthText(
        healthBar(health({ onTime: 7, remaining: 2 })),
        health({ onTime: 7, remaining: 2 }),
      ),
    ).toBe('7 of 9 done · 0 late');
  });

  it('mentions unscheduled arrivals only when there are some', () => {
    const quiet = health({ onTime: 3, remaining: 1 });
    expect(healthText(healthBar(quiet), quiet)).not.toContain('unscheduled');
    const gap = health({ onTime: 3, unscheduled: 2, remaining: 1 });
    expect(healthText(healthBar(gap), gap)).toContain('2 unscheduled');
  });

  it('says so plainly when the day has nothing in it', () => {
    expect(healthText(healthBar(health()), health())).toBe('No stops today');
    expect(healthBar(health()).label).toBe('No stops scheduled today');
  });

  /** The tooltip spells out every non-zero segment, in the same order. */
  it('spells the whole day out for the tooltip', () => {
    expect(healthBar(health({ onTime: 6, late: 3, remaining: 9 })).label).toBe(
      'Today: 9 of 18 stops done — 6 on time, 3 late, 9 still to go',
    );
  });
});
