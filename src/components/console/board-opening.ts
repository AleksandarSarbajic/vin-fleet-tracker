import { EASING, MOTION_MS } from '@/design/tokens';
import { play } from '@/lib/motion';

/**
 * §12.149. The board draws in once per page load: the rows in view fade in, one just
 * after the other, 300ms in all. Opacity only, so nothing moves and every row is live from
 * its first frame: a click on a row still at nothing selects it.
 *
 * Once per load and not once per mount, so coming back from another page does not replay
 * it, which is why the flag is the module's. It waits for there to be rows: a board that
 * opens on a chip with nothing in it takes it when rows first arrive.
 *
 * Nothing here touches what is rendered. The rows are not in the server's HTML at all, the
 * virtualizer draws them after mount, and this runs in the layout effect of that commit,
 * ahead of the frame they first appear in. So hydration has nothing to compare (§12.124).
 *
 * Pinned rows do not take it: they are not in the list, and they are about to be read.
 */
let opened = false;

export function openBoardOnce(scroller: HTMLElement, body: HTMLElement): void {
  if (opened) return;
  opened = true;
  const view = scroller.getBoundingClientRect();
  const seen = [...body.children].filter((wrapper) => {
    const box = wrapper.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
  });
  const gap =
    seen.length > 1
      ? Math.min(
          MOTION_MS.boardOpenGapMax,
          (MOTION_MS.boardOpen - MOTION_MS.boardOpenRow) / (seen.length - 1),
        )
      : 0;
  seen.forEach((wrapper, i) => {
    play(wrapper, [{ opacity: 0 }, { opacity: 1 }], {
      duration: MOTION_MS.boardOpenRow,
      delay: i * gap,
      easing: EASING.fade,
      fill: 'backwards',
    });
  });
}
