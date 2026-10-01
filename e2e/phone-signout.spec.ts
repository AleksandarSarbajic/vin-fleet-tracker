import { expect, test } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * §12.96 — sign-out on a phone. Its own Playwright project, run after every
 * other spec: the app's sign-out ends EVERY session of the account (Supabase's
 * default global scope), including the one the other specs share, so this
 * signs in by itself and goes last. The e2e teardown copes with the stale
 * session file it leaves (§12.93).
 *
 * Expected to fail until stage 1 puts the account menu in the phone's top
 * bar; `PHONE_REPORT=1` runs it unmarked.
 */
test('on a 390px phone, the account menu signs out', async ({ browser }) => {
  test.fail(
    !process.env['PHONE_REPORT'],
    'stage 1: the account menu is off-screen on a phone',
  );
  await resetWorld();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ft.tour.seen', '1');
    } catch {
      // No storage: the tour may cover the board, and the tap below fails.
    }
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Work email').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await page.getByLabel('Password').press('Enter');
  await page.waitForURL('/', { timeout: 30_000 });

  await page.locator('[data-phone-account]').tap({ timeout: 5_000 });
  await page.getByRole('menuitem', { name: 'Sign out' }).tap();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
