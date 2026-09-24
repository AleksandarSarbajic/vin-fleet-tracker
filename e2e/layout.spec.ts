import { expect, test } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * §12.17 and §14: the shell is the viewport, the ROW LIST scrolls inside its
 * own box, and the header and map stay where they are.
 *
 * This regressed and shipped. §14 feature 5 wrapped the list in a new flex
 * container so the density toolbar could sit above it, and that wrapper had
 * `h-full` without `min-h-0` inside a grid whose single implicit row was
 * `auto`-sized. `height: 100%` of a row sized by its own content is circular,
 * so the row grew to fit 40 trucks, the overflow escaped to the document, and
 * the whole page scrolled: header off the top, map attribution sliding past
 * the bottom.
 *
 * **It cannot be asked of a short list.** Three rows fit, nothing overflows,
 * and every container measures correctly bounded — which is why the existing
 * specs were green throughout. The fleet is ~34 trucks; these seed 40.
 */
const TALL = { extraTrucks: 40 };

test('the page itself does not scroll', async ({ page }) => {
  await resetWorld(TALL);
  await page.goto('/');
  await expect(page.getByLabel('Search the fleet')).toBeVisible();

  const doc = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    rows: document.querySelectorAll('[data-row-id]').length,
  }));

  expect(doc.rows, 'the fixture must overflow the viewport or this proves nothing').toBeGreaterThan(
    10,
  );
  expect(
    doc.scrollHeight,
    'the document is taller than the viewport, so the whole app scrolls as one page',
  ).toBeLessThanOrEqual(doc.clientHeight + 1);
});

test('the header stays pinned when the list is scrolled', async ({ page }) => {
  await resetWorld(TALL);
  await page.goto('/');
  const search = page.getByLabel('Search the fleet');
  await expect(search).toBeVisible();

  const before = await search.boundingBox();
  await page.mouse.move(400, 500);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(400);
  const after = await search.boundingBox();

  expect(await page.evaluate(() => window.scrollY), 'the window scrolled').toBe(0);
  expect(after?.y, 'the header moved — it is scrolling with the page').toBeCloseTo(
    before?.y ?? -1,
    0,
  );
  await expect(search, 'the header scrolled out of view').toBeInViewport();
});

test('the row list scrolls inside its own container', async ({ page }) => {
  await resetWorld(TALL);
  await page.goto('/');
  await expect(page.getByLabel('Search the fleet')).toBeVisible();

  const scroller = page.locator('.overflow-y-auto').first();
  const box = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

  /**
   * The container must be SHORTER than its contents. When the bug was present
   * this read `client 1920 / scroll 1920`: the scroll container existed and
   * was never smaller than what it held, so it had nothing to scroll.
   */
  expect(box.clientHeight, 'the list container is not bounded — it grew to fit its rows')
    .toBeLessThan(box.scrollHeight);

  await page.mouse.move(400, 500);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(400);
  expect(
    await scroller.evaluate((el) => el.scrollTop),
    'the list did not scroll internally',
  ).toBeGreaterThan(0);
});

test('the map pane stays inside its own bounds', async ({ page }) => {
  await resetWorld(TALL);
  await page.goto('/');
  const canvas = page.locator('canvas.mapboxgl-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  const view = page.viewportSize()!;
  const box = (await canvas.boundingBox())!;
  // The symptom at the bottom of the screen: the map's own footer sliding up
  // past its boundary because the page, not the list, was scrolling.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'the map extends past the bottom of the viewport').toBeLessThanOrEqual(
    view.height + 2,
  );
});
