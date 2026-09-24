import { expect, test } from '@playwright/test';
import { TRUCK_NUMBERS, resetWorld } from './fixtures';

test.beforeEach(async () => {
  await resetWorld();
});

/**
 * §12.29's second bug, and the direct reason this file exists.
 *
 * `useSearchParams` opted the subtree out of server rendering and silently
 * discarded the `loadFleet()` prefetch, so the console arrived empty and
 * filled in a moment later. There is no server render in Vitest to opt out of,
 * so no unit test can see this — the assertion has to be made against the
 * HTML the server actually sent.
 */
test('the first paint carries the fleet, before any JavaScript runs', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Truck numbers in the server-rendered markup, not fetched afterwards.
  for (const number of Object.values(TRUCK_NUMBERS)) {
    expect(html, `truck ${number} should be in the server render`).toContain(String(number));
  }
});

/**
 * §12.29's first bug, across the RSC boundary. Vitest can assert render
 * PURITY; it cannot render `page.tsx`.
 */
test('the console hydrates without a React hydration error', async ({ page }) => {
  const complaints: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/hydrat|did not match|Text content does not match/i.test(text)) complaints.push(text);
  });
  page.on('pageerror', (error) => {
    if (/hydrat/i.test(error.message)) complaints.push(error.message);
  });

  await page.goto('/');
  await expect(page.getByLabel('Search the fleet')).toBeVisible();
  await page.waitForTimeout(1_500); // hydration warnings arrive after paint

  expect(complaints, complaints.join('\n')).toEqual([]);
});

test('search narrows the list to one truck and clears back', async ({ page }) => {
  await page.goto('/');
  const rows = page.locator('[data-row-id]');
  await expect(rows).toHaveCount(3);

  await page.getByLabel('Search the fleet').fill(String(TRUCK_NUMBERS.dallas));
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(String(TRUCK_NUMBERS.dallas));

  await page.getByLabel('Search the fleet').fill('');
  await expect(rows).toHaveCount(3);
});

/**
 * Mapbox GL needs WebGL, which happy-dom does not have. This is the only place
 * the map can be observed at all.
 */
test('the map canvas renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas.mapboxgl-canvas')).toBeVisible({ timeout: 20_000 });
});
