import { timeInZone } from './format';
import type { Status } from './status';
import type { FleetSnapshot } from './toast';

/**
 * §14 feature 6 — highlight recently-changed rows.
 *
 * Pure, and it takes the previous poll as data rather than reading a ref, so
 * every suppression can be tested without a browser. Same shape as
 * `detectToasts`, and deliberately NOT the same rules: see below.
 *
 * ## Why this is not `detectToasts` with a different renderer
 *
 * A toast interrupts. A flash does not — it is 1.6 seconds of ground on a row
 * that is already on screen, and a dispatcher who is looking elsewhere pays
 * nothing for having missed one. Three of the six toast rules exist purely to
 * ration interruptions, and applying them here would hide changes for no gain:
 *
 *   - **Not LATE-only.** The toast set narrowed to LATE because four AT_RISK
 *     toasts a day taught people to ignore the fifth (§12.50). Every status
 *     change is worth a ground change; none of them is worth a notification.
 *   - **A forced status flashes.** `detectToasts` rule 5 suppresses it because
 *     the dispatcher does not need telling what they typed. Here it is the
 *     opposite: after a bulk force on four trucks, the flash is the only thing
 *     that says WHICH four it landed on. That is confirmation, not news.
 *   - **No once-per-day ledger.** Rule 6 exists because the real data flaps on
 *     a sixty-minute period and no debounce can catch it. A row re-tinting
 *     hourly is not the same cost as an hourly popup.
 *
 * Two rules DO carry over, because both are about changes that are not about
 * a truck at all:
 *
 *   - **First load.** No previous poll is a starting position, not a
 *     transition. Without this the whole board flashes on every page load.
 *   - **Either edge of feed staleness (§5.9).** When the feed dies every row
 *     becomes STALE_GPS at once and comes back just as together — twenty-three
 *     rows flashing about one event that happened to none of them.
 */

/**
 * The flash grounds are one per status FAMILY, not one per status: §14.4
 * defines four plus neutral, and the three neutral states are told apart by
 * border, icon and pattern, never by hue (§5.1). A fifth ground for
 * UNASSIGNED would be the first place in the console where they are not.
 */
export type FlashGround = 'late' | 'risk' | 'ontime' | 'arrived' | 'neutral';

export const FLASH_GROUND: Record<Status, FlashGround> = {
  LATE: 'late',
  AT_RISK: 'risk',
  ON_TIME: 'ontime',
  ARRIVED: 'arrived',
  TOMORROW: 'neutral',
  NO_APPT: 'neutral',
  STALE_GPS: 'neutral',
  UNASSIGNED: 'neutral',
};

export interface RowFlash {
  /** The status the row changed INTO — the ground is derived from this. */
  status: Status;
  /** When it was noticed, which is poll time, not event time. See below. */
  at: number;
}

export interface FlashInput {
  previous: Map<string, FleetSnapshot> | null;
  next: readonly FleetSnapshot[];
  /** §5.9. True on either side suppresses the whole poll. */
  feedStaleBefore: boolean;
  feedStaleNow: boolean;
  /** `Date.now()` at the caller, passed so the result is deterministic. */
  now: number;
}

/**
 * Rows whose status is not what it was a poll ago.
 *
 * `at` is when the console NOTICED, not when the truck crossed — the two are
 * up to twenty seconds apart and only the first one is knowable here. The
 * reduced-motion tag says "changed 04:11" for that reason and not "went late
 * at 04:11", which would be a claim the data cannot support.
 */
export function detectFlashes(input: FlashInput): Map<string, RowFlash> {
  const { previous, next, feedStaleBefore, feedStaleNow, now } = input;
  const out = new Map<string, RowFlash>();

  if (previous === null) return out;
  if (feedStaleBefore || feedStaleNow) return out;

  for (const row of next) {
    const before = previous.get(row.id);
    // A truck that was not on the board a poll ago has not crossed anything;
    // it has arrived in the query. Same reasoning as `detectToasts` rule 3.
    if (!before) continue;
    /*
     * `forced` is in the comparison, not just `status`. Forcing LATE onto a
     * truck that was already LATE changes nothing about `status` and
     * everything about the row: the chip gains the override glyph and the
     * word "forced". Without this, exactly the trucks a bulk override did
     * NOT visibly move are the ones that give no sign it worked.
     */
    if (row.status === before.status && row.forced === before.forced) continue;
    out.set(row.id, { status: row.status, at: now });
  }
  return out;
}

/**
 * The clock on the reduced-motion tag.
 *
 * Bare `HH:MM`, unlike every other time on the row, and that is the one place
 * in the console where a time carries no zone. It can: the tag lives for
 * sixty seconds and always says "a moment ago in the zone you are sitting in",
 * so there is no reading of it that lands in the wrong hour. The labelled form
 * with the abbreviation goes in the tooltip, derived at render time by
 * `timeInZone` — never stored, never concatenated (CLAUDE.md).
 */
export function flashClock(at: Date, dispatchTz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: dispatchTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/**
 * Everything a row needs to render its flash, resolved once per poll rather
 * than once per row.
 *
 * The dispatch zone and the motion preference both live at the top of the
 * console, and threading two more props through the list to every row so each
 * one can format the same string is how a row ends up re-rendering because a
 * preference it does not use changed.
 */
export interface RowFlashView {
  ground: FlashGround;
  /**
   * The restart key. A row that changes twice inside one flash must re-run
   * the decay from the top, and a CSS animation on an element that never
   * unmounted will not do that by itself.
   */
  at: number;
  /**
   * §14.4's static tag. Non-null ONLY under reduced motion — with motion the
   * ground carries the signal and a tag as well would be saying it twice.
   */
  tag: { clock: string; title: string } | null;
}

export function flashView(
  flash: RowFlash,
  dispatchTz: string,
  reducedMotion: boolean,
): RowFlashView {
  return {
    ground: FLASH_GROUND[flash.status],
    at: flash.at,
    tag: reducedMotion
      ? {
          clock: flashClock(new Date(flash.at), dispatchTz),
          // The labelled form, with the abbreviation derived at render time.
          title: `Status changed ${timeInZone(new Date(flash.at), dispatchTz)}`,
        }
      : null,
  };
}

/**
 * §14.5's re-sort hold. Ten seconds is the designer's number, and it is a
 * ceiling rather than a delay: the hold ends the moment the pointer leaves
 * the list or the last check is cleared, and this is only how long it may
 * last if neither ever happens.
 *
 * Not in `MOTION_MS` because it is not motion — nothing animates for ten
 * seconds. It is how long an offer waits for the cursor to be somewhere else.
 */
export const RESORT_HOLD_MS = 10_000;
