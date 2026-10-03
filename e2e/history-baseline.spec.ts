import { expect, test, type Page } from '@playwright/test';
import { HISTORY_NOW, seedHistory } from './history-seed';

/**
 * §12.101 — the driver history page, pixel for pixel, at the six desktop
 * widths the console's baselines use. Held still by:
 *
 *   - a fixed history (`history-seed.ts`) at fixed instants, week 2026-W40;
 *   - the browser clock frozen at Fri Oct 2, 2026, 10:42 CDT, so "today",
 *     the blank weekend and the week tag cannot move with the date; the shot
 *     is taken after the header's first tick onto that clock;
 *   - the header's sync age and clocks hidden (`e2e/screenshot.css`), as on
 *     the console: the age is measured against the server's real time.
 *
 * No colour tolerance, no pixel allowance (playwright.config.ts).
 */

const WIDTHS = [768, 1024, 1280, 1440, 1680, 1920] as const;
const HEIGHT = 900;

async function hideLiveValues(page: Page) {
  await page.evaluate(() => {
    const header = document.querySelector('[data-history-header]');
    if (!header) return;
    header.querySelectorAll('[data-sync-label]').forEach((el) => el.setAttribute('data-shot-hide', ''));
    [...header.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /^\d{2}:\d{2}$/.test((el.textContent ?? '').trim()))
      .forEach((el) => el.setAttribute('data-shot-hide', ''));
  });
}

for (const width of WIDTHS) {
  test(`driver history at ${width}px matches its baseline`, async ({ page }) => {
    await seedHistory();
    await page.clock.setFixedTime(HISTORY_NOW);
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto('/history?week=2026-W40');
    await page.locator('[data-history-toolbar]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1300);
    await page.mouse.move(2, HEIGHT - 2);
    await hideLiveValues(page);
    await expect(page).toHaveScreenshot(`history-W40-${width}.png`, { stylePath: 'e2e/screenshot.css' });
  });
}
