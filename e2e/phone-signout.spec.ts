import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * §12.96 — sign-out, on a phone, ends THIS device's session and no other.
 *
 * Supabase's default sign-out is global: it ended every session of the
 * account, so signing out on a phone signed the dispatcher's desktop out
 * too. It is local now (`signOut({ scope: 'local' })`).
 *
 * Still its own Playwright project, run after every other spec: if the scope
 * ever went back to global, this would end the session the other specs share,
 * and they would fail for a reason that is not theirs. Here it fails alone,
 * on the assertion that names it. The e2e teardown still signs the account out
 * everywhere afterwards (§12.93).
 */

const PHONE = { width: 390, height: 844 };

async function signedIn(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Work email').fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await page.getByLabel('Password').press('Enter');
  await page.waitForURL('/', { timeout: 30_000 });
  return { context, page };
}

/** Where this browser lands on `/`, and what the fleet API answers it. */
async function session(page: Page): Promise<{ path: string; fleet: number }> {
  await page.goto('/');
  const fleet = await page.evaluate(async () => (await fetch('/api/fleet')).status);
  return { path: new URL(page.url()).pathname, fleet };
}

test('on a 390px phone, the account menu signs this device out and no other', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await resetWorld();
  // Two sign-ins: two sessions of the same account, as a phone and a desktop.
  const phone = await signedIn(browser);
  const other = await signedIn(browser);
  // And the session every other spec has used all run.
  const shared = await browser.newContext({ storageState: 'e2e/.auth/dispatcher.json' });
  const sharedPage = await shared.newPage();

  await phone.page.locator('[data-phone-account]').tap({ timeout: 5_000 });
  await phone.page.getByRole('menuitem', { name: 'Sign out' }).tap();
  await phone.page.waitForURL(/\/login/, { timeout: 15_000 });

  // This device is out: the console sends it to sign in, the API refuses it.
  expect(await session(phone.page)).toEqual({ path: '/login', fleet: 401 });

  // The other two sessions of the same account are not.
  expect(await session(other.page)).toEqual({ path: '/', fleet: 200 });
  expect(await session(sharedPage)).toEqual({ path: '/', fleet: 200 });

  await Promise.all([phone.context.close(), other.context.close(), shared.close()]);
});
