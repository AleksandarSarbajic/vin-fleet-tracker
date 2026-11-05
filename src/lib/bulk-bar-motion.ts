import { EASING, MOTION_MS } from '@/design/tokens';
import { makeInert } from '@/components/overlay/dialog-motion';
import { clearStyle, mayMove, play, whenOver } from './motion';

/**
 * §12.149. The bulk bar comes up into its slot, and goes down out of it.
 *
 * Both stay inside the slot, which clips them, so neither reaches past the panel or
 * makes anything scroll. Closing never waits: the bar is removed in that commit, the
 * footer is back and live, and what slides away is a copy nothing can use, as a closed
 * window's is. Opening again takes every copy away at once.
 */
export const BAR_COPY = 'data-bar-copy';

const OUT_OF_THE_SLOT = 'translateY(100%)';
const timing = { duration: MOTION_MS.bulkBar, easing: EASING.dialog };

const clearCopies = () => {
  document.querySelectorAll(`[${BAR_COPY}]`).forEach((n) => n.remove());
};

export function barOpened(slot: HTMLElement): void {
  clearCopies();
  const bar = slot.firstElementChild;
  if (!bar) return;
  const coming = play(bar, [{ transform: OUT_OF_THE_SLOT }, { transform: 'none' }], timing);
  if (!coming) return;
  slot.style.overflow = 'clip';
  whenOver(coming, () => clearStyle(slot));
}

/** Runs before the bar is removed, while it still has a box to copy. */
export function barClosing(slot: HTMLElement): void {
  const bar = slot.firstElementChild as HTMLElement | null;
  if (!bar || !mayMove(bar)) return;
  const { left, top, width, height } = slot.getBoundingClientRect();
  if (width === 0) return;
  clearCopies();

  const holder = document.createElement('div');
  holder.setAttribute(BAR_COPY, '');
  holder.setAttribute('aria-hidden', 'true');
  holder.setAttribute('inert', '');
  Object.assign(holder.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'clip',
    pointerEvents: 'none',
  });
  // Where it was drawn, so a bar closed on its way up goes down from there.
  const drawn = getComputedStyle(bar).transform;
  const copy = makeInert(bar);
  holder.append(copy);
  document.body.append(holder);
  const going = play(copy, [{ transform: drawn }, { transform: OUT_OF_THE_SLOT }], timing);
  if (going) whenOver(going, () => holder.remove());
  else holder.remove();
}
