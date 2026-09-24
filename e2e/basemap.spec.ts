import { expect, test, type Page } from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';

/**
 * The satellite toggle (§12.70).
 *
 * One truck, so the map fits to it and its marker sits at the centre of the
 * canvas. "Is the marker drawn?" is then asked BEHAVIOURALLY — click the
 * centre, and see whether that truck becomes the selection — rather than by
 * guessing at pixel colours under a city label. A symbol whose image is
 * missing is not placed, and a symbol that is not placed cannot be clicked,
 * so this also proves the markers are still interactive after `setStyle`.
 */
async function soloTruck(): Promise<void> {
  await resetWorld();
  const sql = connect();
  try {
    // Cascades to its loads, stops, positions and assignments.
    await sql`delete from trucks where id <> ${IDS.truckAtZipStop}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const row = (page: Page) => page.locator(`[data-row-id="${IDS.truckAtZipStop}"]`);

async function clickMapCentre(page: Page): Promise<void> {
  const box = (await page.locator('canvas.mapboxgl-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Retries, because a style load is asynchronous and markers return with it. */
async function expectMarkerAtCentre(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await clickMapCentre(page);
    await expect(row(page)).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test('switching to satellite keeps every marker drawn and clickable', async ({ page }) => {
  const missing: string[] = [];
  page.on('console', (m) => {
    const hit = /Image "([^"]+)" could not be loaded/.exec(m.text());
    if (hit) missing.push(hit[1]!);
  });
  /**
   * The BILLED event, observed directly. Mapbox GL reports each map load it
   * charges for as a `map.load` telemetry event; a style switch reports
   * `style.load` and nothing billable. Counting the former is the cost check.
   */
  const mapLoads: string[] = [];
  page.on('request', (r) => {
    if (/events\.mapbox\.com/.test(r.url()) && /"event"\s*:\s*"map\.load"/.test(r.postData() ?? '')) {
      mapLoads.push(r.url());
    }
  });

  await soloTruck();
  await page.goto('/');
  const canvas = page.locator('canvas.mapboxgl-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expectMarkerAtCentre(page);

  const before = await canvas.elementHandle();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Satellite' }).click();
  await expect(page.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true');

  /**
   * The failure this guards: `setStyle` drops every `addImage`d marker,
   * react-map-gl restores the layers but not the images, and the fleet
   * disappears from the map while the list keeps showing it.
   */
  await expectMarkerAtCentre(page);

  // Switch back and forth, then count what was billed.
  await page.getByRole('button', { name: 'Map' }).click();
  await page.getByRole('button', { name: 'Satellite' }).click();
  await expectMarkerAtCentre(page);

  /**
   * One billed map load for the page, however many times the basemap moves.
   * Measured when this was built: the page load sends `map.load` once, and
   * three switches send `style.load` three times and `map.load` never.
   */
  expect(mapLoads, 'a basemap switch was billed as a new map load').toHaveLength(1);

  /**
   * Same canvas element: the style changed on the existing map rather than a
   * new one being built. Not a billing check on its own — `reuseMaps` keeps
   * the Mapbox instance across a remount, which is exactly why it is set —
   * but a remount also dropped every marker when this was tried, so it is a
   * correctness check in its own right.
   */
  expect(await before!.evaluate((el) => el.isConnected), 'the map was remounted').toBe(true);

  /**
   * And no frame asked for an image that was not there — on the first load
   * or after the switch. The committed code before this change logged two of
   * these on EVERY page load, because images were registered in `onLoad`,
   * after the first frame had already drawn the symbol layers.
   */
  expect(missing, `marker images were missing: ${missing.join(', ')}`).toEqual([]);
});

test('the choice survives a reload, in both directions', async ({ page }) => {
  await soloTruck();
  await page.goto('/');
  await expect(page.locator('canvas.mapboxgl-canvas')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Satellite' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-credits')).toContainText('© Maxar');

  await page.getByRole('button', { name: 'Map' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-credits')).not.toContainText('Maxar');
});

/**
 * Mapbox's attribution terms, checked 2026-09-24: "© Mapbox" and
 * "© OpenStreetMap" must be LINKS, "Improve this map" must be present, and
 * satellite styles additionally require "© Maxar". The footer is the only
 * attribution in the product — the map's own control is disabled.
 */
test('the footer carries the credits the terms require, per basemap', async ({ page }) => {
  await soloTruck();
  await page.goto('/');
  const credits = page.getByTestId('map-credits');

  const required = {
    '© Mapbox': 'https://www.mapbox.com/about/maps',
    '© OpenStreetMap': 'https://www.openstreetmap.org/copyright',
    'Improve this map': 'https://apps.mapbox.com/feedback/',
  };
  for (const [label, href] of Object.entries(required)) {
    await expect(credits.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
  await expect(credits.getByRole('link', { name: '© Maxar' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Satellite' }).click();
  await expect(credits.getByRole('link', { name: '© Maxar' })).toHaveAttribute(
    'href',
    'https://www.maxar.com/',
  );
});
