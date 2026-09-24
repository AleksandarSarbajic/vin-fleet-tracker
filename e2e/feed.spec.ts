import { expect, test } from '@playwright/test';
import { makeFeedStale, resetWorld } from './fixtures';

/**
 * §5.9. When the feed is stale the console withdraws schedule colour
 * FLEET-WIDE, because an ETA projected from a position nobody trusts is worse
 * than no ETA at all.
 *
 * The fleet-wide part is what earns a browser. `feedStale` rides along with
 * the fleet payload precisely so that the banner and every row agree about one
 * fact, rather than each row deciding for itself from data already on screen —
 * and "every row agrees" is not a thing a single-component test can observe.
 */

const banner = /Position feed unreachable since|No position has ever reached/;

/**
 * Give the list enough of the split to render its eight-column layout.
 *
 * At the default split the list is narrow and drops to six columns, so the ETA
 * cell — the thing §5.9 is actually about — is not in the DOM at all. Asserting
 * on an element that does not exist is not a passing test, it is a test that
 * cannot fail, so the width is set deliberately rather than hoped for.
 */
async function wideList(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ft.splitPct', '82'));
}

test('a fresh feed shows no banner and leaves the ETAs alone', async ({ page }) => {
  await resetWorld({ feedAgeMinutes: 1 });
  await wideList(page);
  await page.goto('/');
  await expect(page.getByLabel('Search the fleet')).toBeVisible();

  await expect(page.getByText(banner)).toHaveCount(0);
  // The list really is in its eight-column layout, so the check below is
  // looking at a cell that exists.
  await expect(page.getByRole('row').first()).toContainText('ETA');
  /**
   * Substring, not `/\bstale\b/`. A row's textContent concatenates its cells
   * with no whitespace between them, so the ETA reads `…11:07 CDTstale1m` and
   * a word boundary never matches. The first version of this looked correct
   * and asserted nothing.
   */
  await expect(page.locator('[data-row-id]').filter({ hasText: 'stale' })).toHaveCount(0);
  await expect(page.locator('[data-row-id] .rail-dotted')).toHaveCount(0);
});

test('an old feed announces itself and withdraws every ETA at once', async ({ page }) => {
  await resetWorld({ feedAgeMinutes: 1 });
  await makeFeedStale(180);
  await wideList(page);

  await page.goto('/');
  await expect(page.getByLabel('Search the fleet')).toBeVisible();

  // The fleet-wide statement, at alert severity — §9.8 is red for a reason:
  // an ETA read off this screen must not be quoted to a broker.
  await expect(page.getByText(banner)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/do not quote an ETA from this screen/)).toBeVisible();

  /**
   * And the part that is actually fleet-wide: EVERY row's ETA reads `stale`,
   * not just the trucks whose own GPS is old. One stale row would be
   * STALE_GPS; all of them is the feed.
   */
  const rows = page.locator('[data-row-id]');
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  await expect(rows.filter({ hasText: 'stale' })).toHaveCount(total);

  /**
   * And the colour itself. Every rail is the withdrawn one — not the LATE red
   * or ON_TIME green those rows carried a moment ago. One dotted rail would be
   * a single truck's STALE_GPS; all of them is the feed.
   */
  await expect(page.locator('[data-row-id] .rail-dotted')).toHaveCount(total);
});
