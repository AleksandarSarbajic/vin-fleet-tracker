import { expect, test, type Page } from '@playwright/test';
import { FREE, NOW, seedBoard } from './assignments-seed';

/**
 * §12.129–§12.132, §12.137–§12.141, §12.145 — the assignment board, pixel for pixel, at the six desktop
 * widths the console's baselines use, once with the driver picker open at
 * 1024 (the narrow-desktop layout, the width the list was too narrow at), and
 * once at 1440 with changed rows and a double-booking (3am).
 *
 * Held still by:
 *
 *   - a fixed, INVENTED board, seeded in `assignments-seed.ts`: made-up truck
 *     numbers, made-up names, 555-01xx phones. No real driver, phone or truck
 *     is in it;
 *   - Currently's live values (3ap) chosen so they cannot move: each status
 *     is one the server's real clock cannot change, and the one age on the
 *     page (a Stale GPS chip) is measured from the seed, so it reads "2d" on
 *     every run (`assignments-seed.ts` says how). Nothing needs hiding;
 *   - the browser clock frozen. The page shows no time of day; the clock is
 *     frozen anyway so a later addition cannot move the picture silently;
 *   - no merge candidates (the tables are emptied), so the merge prompt
 *     renders nothing.
 *
 * The first run is `--update-snapshots`, and it is Alex's: e2e signs in
 * through hosted Supabase Auth. No colour tolerance, no pixel allowance
 * (playwright.config.ts).
 */

const WIDTHS = [768, 1024, 1280, 1440, 1680, 1920] as const;
const HEIGHT = 900;

async function open(page: Page, width: number) {
  await seedBoard();
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto('/assignments');
  await page.getByRole('combobox', { name: 'Driver for truck 401' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, HEIGHT - 2);
}

for (const width of WIDTHS) {
  test(`assignments at ${width}px matches its baseline`, async ({ page }) => {
    await open(page, width);
    await expect(page).toHaveScreenshot(`assignments-${width}.png`, { stylePath: 'e2e/screenshot.css' });
  });
}

/**
 * 3am: the states the first seven do not show, at 1440, nothing saved.
 *
 *   - 410, empty, takes the free driver: a "was —" row (§12.130);
 *   - 404 takes 401's driver: a "was" row with its old driver struck and the
 *     No ELD tag not (§12.133), and a double-booking, so 401 and 404 are on
 *     the conflicted ground and the footer names both, in primary ink.
 *
 * Focus is taken off the last picker before the shot, so no field shows its
 * focus box.
 */
test('changed rows and a double-booking at 1440px match their baseline', async ({ page }) => {
  await open(page, 1440);
  const pick = async (truck: number, driver: string) => {
    await page.getByRole('combobox', { name: `Driver for truck ${truck}` }).click();
    await page.getByRole('option', { name: new RegExp(`^${driver}`) }).click();
  };
  await pick(410, FREE);
  await pick(404, 'Ada Okonkwo-Lindqvist');
  await expect(page.getByText('2 rows changed · a driver is on trucks 401 and 404')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(2, HEIGHT - 2);
  await expect(page).toHaveScreenshot('assignments-changed-1440.png', {
    stylePath: 'e2e/screenshot.css',
  });
});

test('the driver picker open at 1024px matches its baseline', async ({ page }) => {
  await open(page, 1024);
  // An empty truck: the list opens on "Unassigned — clear this truck", the
  // free driver first, then everyone on a truck (§12.129).
  await page.getByRole('combobox', { name: 'Driver for truck 410' }).click();
  await page.getByRole('listbox').waitFor();
  await page.mouse.move(2, HEIGHT - 2);
  await expect(page).toHaveScreenshot('assignments-picker-open-1024.png', {
    stylePath: 'e2e/screenshot.css',
  });
});
