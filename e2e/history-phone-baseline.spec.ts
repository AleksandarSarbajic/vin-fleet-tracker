import { expect, test } from '@playwright/test';
import { HISTORY_NOW, seedHistory } from './history-seed';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.102 — the driver history page's phone layout, pixel for pixel, at the
 * six phone sizes. The same fixed history and frozen clock as the desktop
 * baselines (`history-baseline.spec.ts`); the header's sync age is hidden
 * for the shot because it is measured against the server's real time. The
 * console's own baselines are untouched by this file.
 */

for (const size of SIZES) {
  test(`driver history on a phone at ${size.name} matches its baseline`, async ({ browser }) => {
    await seedHistory();
    const { context, page } = await onPhone(browser, size);
    try {
      await page.clock.setFixedTime(HISTORY_NOW);
      await page.goto('/history?week=2026-W40');
      await page.locator('[data-history-phone]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1300);
      await page.evaluate(() =>
        document
          .querySelectorAll('[data-history-phone] [data-sync-label]')
          .forEach((el) => el.setAttribute('data-shot-hide', '')),
      );
      await expect(page).toHaveScreenshot(`history-phone-W40-${size.name}.png`, {
        stylePath: 'e2e/screenshot.css',
      });
    } finally {
      await context.close();
    }
  });
}
