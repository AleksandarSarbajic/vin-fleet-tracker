import { expect, test, type Page } from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';

/**
 * The satellite toggle (§12.70).
 *
 * One truck, so the map fits to it and its marker starts at the centre of
 * the canvas (and stays within a nudge of it — see `markerAt`). "Is the marker drawn?" is then asked BEHAVIOURALLY — click the
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

/**
 * Where the truck's marker is on screen. The map's centre at first — the fit
 * puts a lone truck there — and after that wherever the popup's tip says.
 *
 * Since §12.89 selecting a truck can move the map a little to keep its popup
 * inside the map and off the controls. This one's popup is taller than the
 * room above the centre, so selecting it nudges the map ~48px down, and a
 * click on the old centre then lands beside the marker. The tip sits 18px
 * (the popup's offset) above the marker it points at.
 */
let markerAt: { x: number; y: number } | null = null;

async function clickMarker(page: Page): Promise<void> {
  if (!markerAt) {
    const box = (await page.locator('canvas.mapboxgl-canvas').boundingBox())!;
    markerAt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  await page.mouse.click(markerAt.x, markerAt.y);
}

/** Where the tip settles once any nudge has finished. */
async function recordMarker(page: Page): Promise<void> {
  const tip = page.locator('.ft-popup .mapboxgl-popup-tip');
  let last = '';
  await expect
    .poll(
      async () => {
        const box = await tip.boundingBox();
        const now = box ? `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height)}` : '';
        const settled = now !== '' && now === last;
        last = now;
        return settled;
      },
      { intervals: [250], timeout: 10_000 },
    )
    .toBe(true);
  const [x, y] = last.split(',').map(Number);
  markerAt = { x: x!, y: y! + 18 };
}

/** Retries, because a style load is asynchronous and markers return with it. */
async function expectMarkerClickable(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await clickMarker(page);
    await expect(row(page)).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await recordMarker(page);
}

test('switching to satellite keeps every marker drawn and clickable', async ({ page }) => {
  markerAt = null;
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
  await expectMarkerClickable(page);

  const before = await canvas.elementHandle();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Satellite' }).click();
  await expect(page.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true');

  /**
   * The failure this guards: `setStyle` drops every `addImage`d marker,
   * react-map-gl restores the layers but not the images, and the fleet
   * disappears from the map while the list keeps showing it.
   */
  await expectMarkerClickable(page);

  // Switch back and forth, then count what was billed.
  await page.getByRole('button', { name: 'Map' }).click();
  await page.getByRole('button', { name: 'Satellite' }).click();
  await expectMarkerClickable(page);

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
