import { expect, test, type Page } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * Phase 3bd, the new motion (§12.149), in a real browser with motion on and a real
 * pointer. The suite's default is reduced (playwright.config.ts), so this file turns
 * it back on, as `dialog-motion.spec.ts` does.
 *
 * What every motion here is held to, by `watchFrames`: nothing grows a scroller on
 * any frame, and nothing is left when it ends.
 */
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test.beforeEach(async () => {
  await resetWorld();
});

type Frames = {
  __stop: boolean;
  __count: number;
  /** For each scroller: the most it could scroll on any frame, across and down. */
  __peak: Map<Element, [number, number]>;
  __start: Map<Element, [number, number]>;
};

const OVERFLOWS = /auto|scroll|hidden/;

/**
 * Every scroller on the page, read on every frame. A thing moving past its box makes
 * the box able to scroll further for that frame, and the bars appear: §12.148, 3bb's
 * live bug. Hidden boxes count too, since what moves past one still counts against it.
 * The map's own insides do not.
 *
 * Growth is measured against the larger of the two ends, because a list that changes
 * length has really changed its size.
 */
async function watchFrames(page: Page) {
  await page.evaluate((pattern) => {
    const overflows = new RegExp(pattern);
    const w = window as unknown as Frames;
    w.__stop = false;
    w.__count = 0;
    w.__peak = new Map();
    w.__start = new Map();
    const find = () => [
      document.documentElement,
      document.body,
      ...[...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
        if (el.closest('.mapboxgl-map')) return false;
        const cs = getComputedStyle(el);
        return overflows.test(cs.overflowX) || overflows.test(cs.overflowY);
      }),
    ];
    let scrollers = find();
    const read = () => {
      if (w.__stop) return;
      w.__count += 1;
      // The list of them changes rarely, and finding them is the one slow part.
      if (w.__count % 30 === 0) scrollers = find();
      for (const el of scrollers) {
        const x = el.scrollWidth - el.clientWidth;
        const y = el.scrollHeight - el.clientHeight;
        if (!w.__start.has(el)) w.__start.set(el, [x, y]);
        const peak = w.__peak.get(el);
        w.__peak.set(el, peak ? [Math.max(peak[0], x), Math.max(peak[1], y)] : [x, y]);
      }
      requestAnimationFrame(read);
    };
    read();
  }, OVERFLOWS.source);

  return async () =>
    page.evaluate(() => {
      const w = window as unknown as Frames;
      w.__stop = true;
      const grew: string[] = [];
      for (const [el, [px, py]] of w.__peak) {
        if (!el.isConnected) continue;
        const [sx, sy] = w.__start.get(el)!;
        const ex = el.scrollWidth - el.clientWidth;
        const ey = el.scrollHeight - el.clientHeight;
        if (px > Math.max(sx, ex) || py > Math.max(sy, ey)) {
          const name = `${el.tagName} ${String(el.className).slice(0, 60)}`;
          grew.push(`${name}: ${sx},${sy} -> peak ${px},${py} -> ${ex},${ey}`);
        }
      }
      return { frames: w.__count, grew };
    });
}

test.describe('the watch itself', () => {
  /** A sweep that cannot fail has tested nothing. */
  test('a control: something planted past the edge of a box is found', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    const stop = await watchFrames(page);
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
          const planted = document.createElement('div');
          planted.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px';
          planted.style.transform = 'translateY(5000px)';
          scroller.querySelector('[style*="relative"]')!.append(planted);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              planted.remove();
              requestAnimationFrame(() => done());
            }),
          );
        }),
    );
    const { grew } = await stop();
    expect(grew.join('\n')).toContain('overflow-y-auto');
  });
});

test.describe('step 1, the map toggle is a long thing', () => {
  const toggle = (page: Page) => page.getByRole('button', { name: /^(Hide|Show) map$/ });
  const transformOf = (el: Element) => getComputedStyle(el).transform;
  const scaleOf = (matrix: string) =>
    matrix === 'none' ? 1 : Number(/matrix\(([^,]+)/.exec(matrix)![1]);

  test('pressed, it shrinks by half a percent and does not lift, and the stored split stays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto('/');
    await toggle(page).waitFor();
    const stored = () =>
      page.evaluate(() => [
        window.localStorage.getItem('ft.splitPct'),
        window.localStorage.getItem('ft.narrowPane'),
      ]);
    const before = await stored();
    const box = (await toggle(page).boundingBox())!;
    const stop = await watchFrames(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    expect(await toggle(page).evaluate(transformOf)).toBe('none');

    await page.mouse.down();
    await expect.poll(async () => scaleOf(await toggle(page).evaluate(transformOf))).toBeCloseTo(0.995, 3);
    const held = (await toggle(page).boundingBox())!;
    expect(box.width - held.width).toBeLessThan(box.width * 0.006);
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await expect.poll(() => toggle(page).evaluate(transformOf)).toBe('none');

    const { frames, grew } = await stop();
    expect(frames).toBeGreaterThan(5);
    expect(grew).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  test('a click still toggles it, and the stored split still stays', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto('/');
    await toggle(page).waitFor();
    const split = () => page.evaluate(() => window.localStorage.getItem('ft.splitPct'));
    const before = await split();
    const name = await toggle(page).textContent();
    await toggle(page).click();
    await expect(toggle(page)).not.toHaveText(name!);
    expect(await split()).toBe(before);
  });
});
