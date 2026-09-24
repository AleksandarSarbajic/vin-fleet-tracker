import { expect, test } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * The middleware, and a real sign-in.
 *
 * Signed OUT on purpose: everything else in this suite runs with a saved
 * session, and the redirect can only be observed without one.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async () => {
  await resetWorld();
});

test('an unauthenticated visitor is redirected to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Fleet Tracker' })).toBeVisible();
});

/**
 * The distinction §12.x built the middleware around: a JSON client must never
 * be handed the login PAGE. A session that expires mid-shift would otherwise
 * surface as a parse error instead of a 401, which is exactly the 3am
 * confusion this console exists to avoid.
 */
test('an API route answers 401 as JSON rather than redirecting to HTML', async ({ request }) => {
  const response = await request.get('/api/fleet');
  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(await response.json()).toMatchObject({ error: expect.any(String) });
});

test('signing in with the wrong password says so and stays put', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('signing in reaches the console', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL('/', { timeout: 30_000 });
  await expect(page.getByLabel('Search the fleet')).toBeVisible();
});
