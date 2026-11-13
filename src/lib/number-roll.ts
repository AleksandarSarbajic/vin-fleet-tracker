import { EASING, MOTION_MS } from '@/design/tokens';
import { clearStyle, mayMove, play, whenOver } from './motion';

/**
 * §12.149. A count that changed rolls: the old number goes out as the new one comes in.
 *
 * What React rendered is the new number from the first frame, and it is the only number
 * a screen reader can reach. The old one is a copy, `aria-hidden`, gone when it lands.
 * The width changes once, at the start, which is the same step it always took: only the
 * numbers move, and only inside their own box, which clips them for those frames and
 * has nothing on it afterwards.
 *
 * A poll landing mid-roll ends the roll it finds at once, so there are never three.
 */
export const ROLL_COPY = 'data-roll-copy';

const rolling = new WeakMap<HTMLElement, () => void>();

/** Ends a roll in flight in `box` at once, on the number React drew: what changed it was no cause. */
export function settleRoll(box: HTMLElement): void {
  rolling.get(box)?.();
}

/** `ms` is the count's own unless a caller has its own token (§12.156, the list footer's). */
export function rollNumber(
  box: HTMLElement,
  number: HTMLElement,
  from: number,
  ms: number = MOTION_MS.countRoll,
): void {
  rolling.get(box)?.();
  if (!mayMove(box) || document.hidden || box.offsetWidth === 0) return;
  const to = Number(number.textContent);
  const way = to > from ? 1 : -1;

  const copy = document.createElement('span');
  copy.setAttribute(ROLL_COPY, '');
  copy.setAttribute('aria-hidden', 'true');
  copy.textContent = String(from);
  Object.assign(copy.style, { position: 'absolute', top: '0', right: '0' });
  Object.assign(box.style, { display: 'inline-block', position: 'relative', overflow: 'clip' });
  number.style.display = 'inline-block';
  box.append(copy);

  const options = { duration: ms, easing: EASING.dialog };
  const coming = play(
    number,
    [{ transform: `translateY(${way * 100}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
    options,
  );
  const going = play(
    copy,
    [{ transform: 'none', opacity: 1 }, { transform: `translateY(${-way * 100}%)`, opacity: 0 }],
    options,
  );

  const end = () => {
    if (rolling.get(box) !== end) return;
    rolling.delete(box);
    coming?.cancel();
    going?.cancel();
    copy.remove();
    clearStyle(box);
    clearStyle(number);
  };
  rolling.set(box, end);
  if (coming) whenOver(coming, end);
  else end();
}
