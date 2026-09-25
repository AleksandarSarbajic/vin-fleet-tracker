import { expect, test } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * §12.79. The header's chip row fits, whole, at the widths dispatchers use.
 *
 * Measured against 33 trucks so the counts are two digits, as production's
 * are — single-digit fixture counts under-state the row by tens of pixels.
 *
 * Two properties, because the first attempt passed one and failed the other:
 * nothing in the middle track SCROLLS, and the row ENDS before the status
 * cluster starts. A row that overflows visibly instead of scrolling satisfies
 * the first and paints over "Synced 12s ago".
 */
test.beforeEach(async () => {
  await resetWorld({ extraTrucks: 30 });
});

for (const width of [1440, 1680, 1920]) {
  test(`the whole chip row fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();

    const m = await page.evaluate(() => {
      const header = document.querySelector('header')!;
      const middle = header.children[2] as HTMLElement;
      const cluster = header.children[3] as HTMLElement;
      const last = header.querySelector('a[href="/assignments"]')!;
      return {
        scrolls: middle.scrollWidth - middle.clientWidth,
        gapToCluster: cluster.getBoundingClientRect().left - last.getBoundingClientRect().right,
      };
    });
    expect(m.scrolls).toBe(0);
    expect(m.gapToCluster).toBeGreaterThan(0);

    for (const name of [/^All/, /^Data/, /^Inactive/, /^Drivers only/, /^Assignments$/]) {
      await expect(page.getByRole(name.source === '^Assignments$' ? 'link' : 'button', { name })).toBeInViewport({ ratio: 1 });
    }
  });
}
