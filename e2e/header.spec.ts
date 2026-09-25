import { expect, test, type Page } from '@playwright/test';
import { connect, resetWorld } from './fixtures';

/**
 * §12.79. The header's chip row fits, whole, at the widths dispatchers use —
 * with the feed healthy AND with it down (§12.80), when the sync label is at
 * its longest.
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

async function feedDown(): Promise<void> {
  const sql = connect();
  try {
    await sql`update feed_health
              set newest_position_at = now() - interval '25 minutes',
                  last_success_at = now() - interval '25 minutes'`;
  } finally {
    await sql.end();
  }
}

async function expectRowFits(page: Page): Promise<void> {
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

  for (const name of [/^All/, /^Data/, /^Inactive/, /^Drivers only/]) {
    await expect(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole('link', { name: 'Assignments' })).toBeInViewport({ ratio: 1 });
}

/**
 * §12.83. The worst case a saved view can put in the header: a 40-character
 * name (VIEW_NAME_MAX) that matches the board as it loads, so it is ACTIVE.
 */
const LONG_VIEW = 'Late on the I-80 and I-94 corridors west';

async function withActiveView(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    try {
      localStorage.setItem('ft.tour.seen', '1');
      localStorage.setItem('ft.views', JSON.stringify([{ id: 'v1', name, query: '', chips: [] }]));
    } catch {
      // A browser without storage simply has no views; the test would then fail on the label.
    }
  }, LONG_VIEW);
}

for (const width of [1440, 1680, 1920]) {
  for (const feed of ['healthy', 'down'] as const) {
    test(`with a view active it still fits at ${width}px, feed ${feed}`, async ({ page }) => {
      if (feed === 'down') await feedDown();
      await withActiveView(page);
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      await page.locator('[data-row-id]').first().waitFor();

      const trigger = page.getByRole('button', { name: `Views: ${LONG_VIEW}` });
      await expect(trigger).toBeVisible();
      // The words at 1680 and up; the compact mark below.
      if (width >= 1680) await expect(trigger).toContainText(/^Views: Late on the/);
      else await expect(trigger.locator('[data-view-mark]')).toBeVisible();
      // The list title names the view at every width.
      await expect(page.locator('[data-view-title]')).toHaveText(LONG_VIEW);

      await expectRowFits(page);
    });
  }

  test(`the whole chip row fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expectRowFits(page);
  });

  test(`it still fits at ${width}px with the feed down`, async ({ page }) => {
    await feedDown();
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();

    // The spec's wording (§9.1), no zone suffix — the dispatch clock beside
    // it names the zone — stacked on two lines like the clocks (§12.80).
    const label = page.locator('header [data-sync-label]');
    await expect(label).toHaveText(/^Last sync \d{2}:\d{2} · \d+m ago$/);
    // What is SEEN on each line: the separator is screen-reader-only.
    const lines = await label.evaluate((el) =>
      [...el.children].map((line) => {
        const seen = line.cloneNode(true) as HTMLElement;
        seen.querySelectorAll('.sr-only').forEach((n) => n.remove());
        return (seen.textContent ?? '').trim();
      }),
    );
    expect(lines[0]).toMatch(/^Last sync \d{2}:\d{2}$/);
    expect(lines[1]).toMatch(/^\d+m ago$/);

    await expectRowFits(page);
  });
}

/**
 * §12.83. The Views menu is SEEN, not merely open. It sat in the header's
 * scrolling track and was clipped to nothing — aria-expanded true, items in
 * the DOM, every component test green — so this asks the browser what is
 * actually painted at points inside the menu.
 */
for (const width of [1440, 1680]) {
  test(`the Views menu is visible when open at ${width}px`, async ({ page }) => {
    await withActiveView(page);
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await page.getByRole('button', { name: `Views: ${LONG_VIEW}` }).click();
    const menu = page.getByRole('menu', { name: 'Saved views' });
    await expect(menu).toBeVisible();

    const painted = await menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const points = [
        [box.left + 12, box.top + 12],
        [box.right - 12, box.bottom - 12],
      ] as const;
      return points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && el.contains(hit);
      });
    });
    expect(painted).toBe(true);
    await expect(menu.getByRole('menuitem', { name: new RegExp(LONG_VIEW) })).toBeInViewport();
  });
}
