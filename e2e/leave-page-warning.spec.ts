import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';

/**
 * Phase 3bc follow-up 3. Reload and closing the tab lost typed work in the edit window
 * with no question. The browser now asks, on exactly the condition the Discard question
 * uses, and on nothing else.
 *
 * Client navigation is not here: `beforeunload` does not fire on it, by design of the
 * browser, and in-app Back is out of scope (HANDOFF, "Phase 3bc follow-up 3").
 */

const TYPED = 'TYPED-BEFORE-LEAVING';
const STORED = 'E2E-101';
/** Long enough for a dialog that is going to appear, which is what these wait out. */
const SETTLE_MS = 300;

const editModal = (page: Page) =>
  page.getByRole('dialog', { name: /^(Edit|New) load for truck 101$/ });
const loadNumber = (modal: Locator) => modal.getByLabel('Load number');

test.beforeEach(async () => {
  await resetWorld();
});

async function openEditor(page: Page) {
  await page.goto('/');
  await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();
  await page.keyboard.press('Enter');
  const modal = editModal(page);
  await expect(modal).toBeVisible();
  await expect(loadNumber(modal)).toHaveValue(STORED);
  return modal;
}

/** Every dialog the page raises, answered, so a wrong one cannot hang the test. */
function dialogsOn(page: Page) {
  const seen: string[] = [];
  page.on('dialog', (dialog) => {
    seen.push(dialog.type());
    void dialog.accept();
  });
  return seen;
}

test.describe('leaving the page', () => {
  test('typed work: Reload asks, Stay keeps the work, and Leave goes', async ({ page }) => {
    const modal = await openEditor(page);
    await loadNumber(modal).fill(TYPED);

    const asked = page.waitForEvent('dialog');
    // Never settles on Stay: the navigation it is waiting for was refused.
    void page.reload().catch(() => {});
    const stay = await asked;
    expect(stay.type()).toBe('beforeunload');
    await stay.dismiss();
    await expect(modal).toBeVisible();
    await expect(loadNumber(modal)).toHaveValue(TYPED);

    const askedAgain = page.waitForEvent('dialog');
    const reloaded = page.reload();
    const leave = await askedAgain;
    expect(leave.type()).toBe('beforeunload');
    await leave.accept();
    await reloaded;
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });

  test('typed work: closing the tab asks, and Stay keeps the work', async ({ page }) => {
    const modal = await openEditor(page);
    await loadNumber(modal).fill(TYPED);

    const asked = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const stay = await asked;
    expect(stay.type()).toBe('beforeunload');
    await stay.dismiss();
    await expect(modal).toBeVisible();
    await expect(loadNumber(modal)).toHaveValue(TYPED);
    expect(page.isClosed()).toBe(false);
  });

  test('nothing typed: Reload does not ask', async ({ page }) => {
    await openEditor(page);
    const seen = dialogsOn(page);
    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    expect(seen).toEqual([]);
  });

  test('typed and typed back to what it was: Reload does not ask', async ({ page }) => {
    const modal = await openEditor(page);
    await loadNumber(modal).fill(TYPED);
    await loadNumber(modal).fill(STORED);
    const seen = dialogsOn(page);
    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    expect(seen).toEqual([]);
  });

  test('after a save has landed: Reload does not ask', async ({ page }) => {
    const modal = await openEditor(page);
    await loadNumber(modal).fill(TYPED);
    await modal.getByRole('button', { name: /^Save$/ }).click();
    await expect(modal).toBeHidden({ timeout: 20_000 });
    const seen = dialogsOn(page);
    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    expect(seen).toEqual([]);
  });

  test('after Discard: Reload does not ask', async ({ page }) => {
    const modal = await openEditor(page);
    await loadNumber(modal).fill(TYPED);
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: 'Discard changes?' })
      .getByRole('button', { name: 'Discard' })
      .click();
    await expect(modal).toHaveCount(0);
    const seen = dialogsOn(page);
    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    expect(seen).toEqual([]);
  });

  /** Phase 3bd, step 0. The status override draft is typed work, by the one condition. */
  test('Force late: Reload asks, Stay keeps it, and Esc asks too', async ({ page }) => {
    const modal = await openEditor(page);
    await modal.getByRole('button', { name: 'Force late' }).click();

    const asked = page.waitForEvent('dialog');
    void page.reload().catch(() => {});
    const stay = await asked;
    expect(stay.type()).toBe('beforeunload');
    await stay.dismiss();
    await expect(modal.getByRole('button', { name: 'Force late' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
  });

  test('Force late and back to Auto: Reload does not ask', async ({ page }) => {
    const modal = await openEditor(page);
    await modal.getByRole('button', { name: 'Force late' }).click();
    await modal.getByRole('button', { name: 'Auto' }).click();
    const seen = dialogsOn(page);
    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    expect(seen).toEqual([]);
  });

  /**
   * The session ending navigates nothing: the middleware redirects page requests only,
   * and an API route answers 401 (`middleware.ts`). So nothing can get stuck behind the
   * warning here, and the work stays on the screen for a Save that says what is wrong.
   */
  test('the session ends: nothing navigates, nothing asks, and Save says why it cannot', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const modal = await openEditor(page);
    await loadNumber(modal).fill(TYPED);
    const seen = dialogsOn(page);

    const refused = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/fleet' && r.status() === 401,
      { timeout: 45_000 },
    );
    await page.context().clearCookies();
    await refused;
    await page.waitForTimeout(SETTLE_MS);

    expect(new URL(page.url()).pathname).toBe('/');
    await expect(modal).toBeVisible();
    await expect(loadNumber(modal)).toHaveValue(TYPED);
    await modal.getByRole('button', { name: /^Save$/ }).click();
    await expect(modal.getByRole('alert').first()).toBeVisible({ timeout: 20_000 });
    await expect(loadNumber(modal)).toHaveValue(TYPED);
    expect(seen).toEqual([]);

    const sql = connect();
    try {
      const [load] = await sql<{ load_number: string | null }[]>`
        select load_number from loads where id = ${IDS.loadChicago}`;
      expect(load!.load_number).toBe(STORED);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  /**
   * The one automatic full-page navigation there is. When the fetch behind a
   * `router.replace` fails, Next falls back to the browser's own navigation, and the only
   * `router.replace` that can fire behind a window is the fallback for a list someone else
   * deleted. So: it asks, rather than losing the work, and Stay leaves nothing stuck, even
   * though the framework's navigation never finished.
   */
  test('a router.replace that fails: the browser asks, Stay keeps the work, and nothing is stuck', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sql = connect();
    let listId = '';
    try {
      const [list] = await sql<{ id: string }[]>`
        insert into truck_lists (name) values (${'Night shift'}) returning id`;
      listId = list!.id;
      await sql`insert into truck_list_members (list_id, truck_id)
                values (${listId}, ${IDS.truckChicago})`;
    } finally {
      await sql.end({ timeout: 5 });
    }
    await page.goto(`/?list=${listId}`);
    await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    await expect(modal).toBeVisible();
    await loadNumber(modal).fill(TYPED);

    const fetchFails = (url: URL) => url.searchParams.has('_rsc');
    await page.route(fetchFails, (route) => route.abort());
    const seen: string[] = [];
    page.on('dialog', (dialog) => {
      seen.push(dialog.type());
      void dialog.dismiss();
    });

    const other = connect();
    try {
      await other`delete from truck_lists where id = ${listId}`;
    } finally {
      await other.end({ timeout: 5 });
    }
    await expect.poll(() => seen, { timeout: 45_000 }).toEqual(['beforeunload']);
    await page.unroute(fetchFails);

    await expect(modal).toBeVisible();
    await expect(loadNumber(modal)).toHaveValue(TYPED);
    await modal.getByRole('button', { name: /^Save$/ }).click();
    await expect(modal).toBeHidden({ timeout: 20_000 });

    // The next selection still moves the address: the router is not left waiting.
    const dallas = page.locator(`[data-row-id="${IDS.truckDallas}"]`);
    await dallas.click();
    await expect(dallas).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]truck=102\b/);
    expect(seen).toEqual(['beforeunload']);
  });
});
