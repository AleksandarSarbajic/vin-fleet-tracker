import type { FleetHealth } from '@/server/health';

/**
 * §14 feature 8, the part worth testing away from the DOM: what the strip
 * says, and how the bar is proportioned.
 *
 * ## The fourth case §14.4 did not have
 *
 * The token table names **three** treatments — "solid · hatched · hollow" —
 * and the data has four states. An arrival with no appointment on file cannot
 * be scored: calling it on time flatters the board, calling it late invents a
 * failure, and dropping it from the bar makes "11 of 31 done" disagree with
 * the segments beside it.
 *
 * So it gets a segment of its own in `status.neutral.fg`, which measures 8.25
 * on `surface.raised` — inside §14.4's own stated 7.06–8.91 band, so the
 * measured range does not move. It is a fourth INK, not a fourth treatment:
 * still solid, told apart from on-time by position and by the words printed
 * beside the bar rather than by hue alone (§5.1).
 */

export type Segment = 'onTime' | 'late' | 'unscheduled' | 'remaining';

export interface HealthBar {
  /** In draw order, left to right. Zero-count segments are kept, at zero width. */
  segments: { key: Segment; count: number }[];
  /** Everything today: done plus still to do. */
  total: number;
  /** Finished, however it went. */
  done: number;
  /** One line, for a tooltip and for assistive tech. */
  label: string;
}

const WORDS: Record<Segment, string> = {
  onTime: 'on time',
  late: 'late',
  unscheduled: 'no appointment',
  remaining: 'still to go',
};

export function healthBar(health: FleetHealth): HealthBar {
  const { onTime, late, unscheduled, remaining } = health;
  const done = onTime + late + unscheduled;
  const total = done + remaining;

  /**
   * Draw order is outcome first, worst-known last before the remainder: on
   * time, late, then the ones nothing can be said about, then what is left.
   * Fixed rather than sorted by size — a bar whose segments swap places as
   * the day goes on cannot be read at a glance.
   */
  const segments: { key: Segment; count: number }[] = [
    { key: 'onTime', count: onTime },
    { key: 'late', count: late },
    { key: 'unscheduled', count: unscheduled },
    { key: 'remaining', count: remaining },
  ];

  const parts = segments
    .filter((s) => s.count > 0)
    .map((s) => `${s.count} ${WORDS[s.key]}`);

  return {
    segments,
    total,
    done,
    label:
      total === 0
        ? 'No stops scheduled today'
        : `Today: ${done} of ${total} stops done — ${parts.join(', ')}`,
  };
}

/**
 * The short form printed beside the bar.
 *
 * Late is named even at zero, because "0 late" is the fact a dispatcher wants
 * and an absent word reads as a strip that has not loaded. `unscheduled` is
 * the opposite: it is a data gap rather than an outcome, so it appears only
 * when there is one.
 */
export function healthText(bar: HealthBar, health: FleetHealth): string {
  if (bar.total === 0) return 'No stops today';
  const tail = health.unscheduled > 0 ? ` · ${health.unscheduled} unscheduled` : '';
  return `${bar.done} of ${bar.total} done · ${health.late} late${tail}`;
}
