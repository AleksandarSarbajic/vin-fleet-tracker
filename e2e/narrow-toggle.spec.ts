import { expect, test, type Page } from '@playwright/test';
import { resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.105 — the map/list toggle at 768–1085px. One click is enough, and it
 * holds through the first poll; the choice is remembered per browser; the
 * phone's List | Map tabs are untouched and still open on the list.
 *
 * Nothing here retries a click. A click that is lost fails the test.
 */

const hideMap = (page: Page) => page.getByRole('button', { name: /^Hide map$/ });
const showMap = (page: Page) => page.getByRole('button', { name: /^Show map$/ });
const rows = (page: Page) => page.locator('[data-row-id]');
const listPane = (page: Page) => page.locator('[data-pane="list"]');
const mapPane = (page: Page) => page.locator('[data-pane="map"]');

test.beforeEach(async () => {
  await resetWorld({ extraTrucks: 12 });
});

for (const width of [768, 900, 1023]) {
  test(`${width}px: Hide map, clicked the moment it appears, holds through the first poll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(hideMap(page)).toBeVisible({ timeout: 15_000 });
    await hideMap(page).click();
    await expect(showMap(page)).toBeVisible();
    await expect(listPane(page)).toBeVisible();
    await expect(mapPane(page)).toBeHidden();
    const first = await rows(page).first().elementHandle();

    // The first poll after load brings new data; the click must survive it.
    await page.waitForResponse((r) => r.url().includes('/api/fleet') && r.ok(), {
      timeout: 30_000,
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await expect(showMap(page)).toBeVisible();
    await expect(listPane(page)).toBeVisible();
    await expect(mapPane(page)).toBeHidden();
    // The rows were not rebuilt under the click: the same element is there.
    expect(await first!.evaluate((el) => el.isConnected)).toBe(true);
  });
}

test('900px: the choice is remembered across a reload and a new tab', async ({ page, context }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  await hideMap(page).click();
  await expect(showMap(page)).toBeVisible();

  await page.reload();
  await expect(showMap(page)).toBeVisible({ timeout: 15_000 });
  await expect(listPane(page)).toBeVisible();
  await expect(mapPane(page)).toBeHidden();

  const second = await context.newPage();
  await second.setViewportSize({ width: 1023, height: 800 });
  await second.goto('/');
  await expect(showMap(second)).toBeVisible({ timeout: 15_000 });

  // And back to the map, remembered the same way.
  await showMap(second).click();
  await second.reload();
  await expect(hideMap(second)).toBeVisible({ timeout: 15_000 });
  await expect(mapPane(second)).toBeVisible();
});

test('1086px and up: no toggle, and the stored choice changes nothing', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ft.narrowPane', 'list');
    } catch {
      // No storage: the assertion below still holds.
    }
  });
  await page.setViewportSize({ width: 1086, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('separator', { name: 'Resize list and map' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Hide|Show) map$/ })).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('canvas.mapboxgl-canvas')).toBeVisible();
});

test("the phone's tabs: list first whatever the desktop chose, and not remembered", async ({
  browser,
}) => {
  const { context, page } = await onPhone(browser, SIZES[3]);
  try {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('ft.narrowPane', 'map');
      } catch {
        // No storage: the phone opens on the list regardless.
      }
    });
    await page.goto('/');
    await page.locator('[data-phone-topbar]').waitFor();
    await expect(page.locator('[data-phone-card]').first()).toBeVisible();
    await expect(mapPane(page)).toBeHidden();
    await expect(page.getByRole('button', { name: /^(Hide|Show) map$/ })).toBeHidden();

    await page.getByRole('tab', { name: 'Map' }).tap();
    await expect(mapPane(page)).toBeVisible();
    await page.reload();
    await page.locator('[data-phone-topbar]').waitFor();
    await expect(page.locator('[data-phone-card]').first()).toBeVisible();
    await expect(mapPane(page)).toBeHidden();
  } finally {
    await context.close();
  }
});
