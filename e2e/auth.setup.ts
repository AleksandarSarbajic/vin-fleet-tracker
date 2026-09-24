import { expect, test as setup } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * Signs in once and saves the session for the specs that are not about
 * signing in.
 *
 * The login flow itself is asserted in `auth.spec.ts` against a clean context.
 * Repeating it before every spec would add a real round trip to hosted
 * Supabase per file and test the same thing five times.
 */
const FILE = 'e2e/.auth/dispatcher.json';

setup('sign in as the dispatcher', async ({ page }) => {
  await resetWorld();

  await page.goto('/login');
  await page.getByLabel('Work email').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The console, not the login page: proof the session and the profile row
  // agree. A user with a session but no profile is treated as no user at all.
  await page.waitForURL('/', { timeout: 30_000 });
  await expect(page.getByLabel('Search the fleet')).toBeVisible();

  await page.context().storageState({ path: FILE });
});
