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

/**
 * Proves the eight-column layout is really on before anything asserts about a
 * cell that only exists there.
 *
 * Without this the failure mode is silent in the direction that matters: if
 * `wideList` ever stops working, an assertion about the ETA column becomes an
 * assertion about nothing, and the honest way to stop that is to check the
 * precondition rather than to trust it.
 */
async function expectEtaColumn(page: import('@playwright/test').Page): Promise<void> {
  await expect(
    page.getByRole('row').first(),
    'the list is not in its eight-column layout, so there is no ETA cell to assert on',
  ).toContainText('ETA');
}

test('a fresh feed shows no banner and leaves the ETAs alone', async ({ page }) => {
  await resetWorld({ feedAgeMinutes: 1 });
  await wideList(page);
  await page.goto('/');
  await expect(page.getByLabel('Search the fleet')).toBeVisible();

  await expect(page.getByText(banner)).toHaveCount(0);
  await expectEtaColumn(page);
  /**
   * Substring, not `/\bstale\b/`, and the difference is load-bearing.
   *
   * A row's textContent concatenates its cells with no whitespace between
   * them, so the ETA reads `…11:07 CDTstale1m` and a word boundary has nothing
   * to sit on. In a NEGATIVE assertion like this one that is invisible: a
   * matcher that can never match trivially satisfies `toHaveCount(0)`, so the
   * test passes whatever the app does.
   *
   * Measured rather than argued. With `feedStale` inverted in `etaText`, so a
   * fresh feed wrongly claims `stale` on every row:
   *
   *     hasText: 'stale'     FAILS   — catches the defect
   *     /\bstale\b/          PASSES  — green-lights a broken console
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

  await expectEtaColumn(page);

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
