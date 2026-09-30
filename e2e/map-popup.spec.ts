import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * The map popup is never clipped by the map's edge and never opens under a
 * map control.
 *
 * Found by the Clear stop e2e (§12.88): after a reload with truck 101
 * selected, clicking its row did not move the map — the selection had not
 * changed — and the fleet fit had left 101 in the top-right corner, so its
 * popup opened half outside the map, under the Map/Satellite switcher.
 *
 * The fleet is placed so that the fit puts truck 101 exactly where each case
 * says: 102 and 103 at the centre, 101 offset from them. `fitBounds` then
 * lays 101 against that edge or corner of the map. The corners use a span
 * shaped like the map pane (taller than wide, and a degree of latitude is
 * ~1.25 of longitude at this latitude), so both edges bind and the truck
 * lands in the corner itself — under the switcher, or on the marker key —
 * rather than part-way along one edge.
 */

const CENTRE = { lat: 39.5, lng: -95.5 };
const PLACES = {
  'top-right': { dLat: 10, dLng: 9.5 },
  top: { dLat: 6, dLng: 0 },
  right: { dLat: 0, dLng: 12 },
  bottom: { dLat: -6, dLng: 0 },
  left: { dLat: 0, dLng: -12 },
  'bottom-right': { dLat: -10, dLng: 9.5 },
} as const;
type Place = keyof typeof PLACES;
const BASEMAPS = { dark: 'Map', satellite: 'Satellite' } as const;
type Basemap = keyof typeof BASEMAPS;

async function placeFleet(place: Place): Promise<void> {
  await resetWorld();
  const { dLat, dLng } = PLACES[place];
  const sql = connect();
  try {
    const at = (truckId: string, lat: number, lng: number) => sql`
      insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
      values (${truckId}, ${lat}, ${lng}, null, 0, ${new Date()}, ${'Somewhere, KS'})`;
    await at(IDS.truckChicago, CENTRE.lat + dLat, CENTRE.lng + dLng);
    await at(IDS.truckDallas, CENTRE.lat, CENTRE.lng);
    await at(IDS.truckAtZipStop, CENTRE.lat, CENTRE.lng);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Chooses the basemap the way a dispatcher does, and waits for it to stick. */
async function useBasemap(page: Page, basemap: Basemap): Promise<void> {
  const toggle = page.getByRole('group', { name: 'Basemap' });
  const button = toggle.getByRole('button', { name: BASEMAPS[basemap] });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/**
 * Everything wrong with where the popup is, as sentences — so a failure
 * names the edge or the control rather than printing two rectangles.
 */
async function popupProblems(page: Page): Promise<string[]> {
  const popup = await page.locator('.ft-popup').boundingBox();
  const map = await page.locator('.mapboxgl-map').boundingBox();
  if (!popup || !map) return ['no popup on the map'];
  const problems: string[] = [];
  if (popup.y < map.y)
    problems.push(`${Math.round(map.y - popup.y)}px past the top edge`);
  if (popup.x < map.x)
    problems.push(`${Math.round(map.x - popup.x)}px past the left edge`);
  if (popup.x + popup.width > map.x + map.width) {
    problems.push(
      `${Math.round(popup.x + popup.width - map.x - map.width)}px past the right edge`,
    );
  }
  if (popup.y + popup.height > map.y + map.height) {
    problems.push(
      `${Math.round(popup.y + popup.height - map.y - map.height)}px past the bottom edge`,
    );
  }
  const controls = {
    'the Map/Satellite switcher': page.getByRole('group', { name: 'Basemap' }),
    'the zoom buttons': page.getByRole('button', { name: 'Zoom in' }).locator('xpath=..'),
    'the marker key': page.getByText('Marker key', { exact: true }).locator('xpath=..'),
  };
  for (const [name, locator] of Object.entries(controls)) {
    const box = await locator.boundingBox();
    if (box && overlaps(popup, box)) problems.push(`under ${name}`);
  }
  return problems;
}

/** Polls, because the popup settles after a pan; fails naming what is wrong. */
async function expectPopupClear(page: Page): Promise<void> {
  await expect.poll(() => popupProblems(page), { timeout: 10_000 }).toEqual([]);
}

const mapShot = (page: Page, info: TestInfo, name: string) =>
  page
    .locator('.mapboxgl-map')
    .locator('xpath=..')
    .screenshot({ path: info.outputPath(`${name}.png`) });

for (const basemap of Object.keys(BASEMAPS) as Basemap[]) {
  test(`${basemap}: clicking the already-selected truck's row flies to it, popup clear`, async ({
    page,
  }, info) => {
    await placeFleet('top-right');
    await page.goto('/');
    await useBasemap(page, basemap);

    // Select 101, then reload: the selection survives in the URL.
    const row = page.locator(`[data-row-id="${IDS.truckChicago}"]`);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`truck=${TRUCK_NUMBERS.chicago}`));
    await page.reload();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.ft-popup')).toBeVisible();
    await page.waitForTimeout(500);
    await mapShot(page, info, `${basemap}-1-after-reload`);

    // The dispatcher clicks the row of the truck that is already selected.
    await row.click();
    await page.waitForTimeout(500);
    await mapShot(page, info, `${basemap}-2-after-row-click`);

    await expectPopupClear(page);
    // And the map went to the truck: the popup's tip — the marker — is at the
    // map's horizontal centre, as it is after selecting any other truck.
    const tip = (await page.locator('.ft-popup .mapboxgl-popup-tip').boundingBox())!;
    const map = (await page.locator('.mapboxgl-map').boundingBox())!;
    expect(Math.abs(tip.x + tip.width / 2 - (map.x + map.width / 2))).toBeLessThan(24);
  });

  for (const place of Object.keys(PLACES) as Place[]) {
    test(`${basemap}: a truck at the ${place} edge opens its popup clear of the edge and every control`, async ({
      page,
    }, info) => {
      await placeFleet(place);
      await page.goto('/');
      await useBasemap(page, basemap);
      await page.goto(`/?truck=${TRUCK_NUMBERS.chicago}`);
      await expect(page.locator(`[data-row-id="${IDS.truckChicago}"]`)).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('.ft-popup')).toBeVisible();
      await page.waitForTimeout(500);
      await mapShot(page, info, `${basemap}-${place}`);
      await expectPopupClear(page);
    });
  }
}
