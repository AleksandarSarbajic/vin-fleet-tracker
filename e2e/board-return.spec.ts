import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.104 — the Board button goes back to the board as it was left: its list,
 * chips, search and selected truck. Saved per tab in sessionStorage; a deleted
 * list, or nothing saved, is a plain `/`.
 */

const LIST_NAME = 'Return trip';

/** A shared list of Chicago and Dallas, beside the fixture's three trucks. */
async function seedList(): Promise<string> {
  await resetWorld();
  const sql = connect();
  try {
    const [list] = await sql<{ id: string }[]>`
      insert into truck_lists (name) values (${LIST_NAME}) returning id`;
    for (const truck of [IDS.truckChicago, IDS.truckDallas]) {
      await sql`insert into truck_list_members (list_id, truck_id) values (${list!.id}, ${truck})`;
    }
    return list!.id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function deleteList(id: string): Promise<void> {
  const sql = connect();
  try {
    await sql`delete from truck_lists where id = ${id}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const chicagoRow = (page: Page) => page.locator(`[data-row-id="${IDS.truckChicago}"]`);

const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${name}.png`) });

async function toHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('menuitem', { name: /Driver history/ }).click();
  await expect(page).toHaveURL(/\/history\?week=/);
}

async function expectBoardAsLeft(page: Page, listId: string): Promise<void> {
  await expect(page).toHaveURL((u) => u.pathname === '/');
  const url = new URL(page.url());
  expect(url.searchParams.get('list')).toBe(listId);
  expect(url.searchParams.get('truck')).toBe(String(TRUCK_NUMBERS.chicago));
  expect(url.searchParams.get('q')).toBe('10');
  await expect(page.locator('[data-scope] [data-list-title]')).toHaveText(LIST_NAME);
  await expect(page.locator('[data-row-id]')).toHaveCount(2);
  await expect(chicagoRow(page)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-list-notice]')).toHaveCount(0);
}

test('leave with a list, a search and a truck selected; the Board button and G B bring them back', async ({
  page,
}, info) => {
  const listId = await seedList();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-row-id]')).toHaveCount(3);

  await page.getByRole('button', { name: /^Scope/ }).click();
  await page.getByRole('menu').locator('[data-list-items]').getByRole('menuitem', { name: new RegExp(`^${LIST_NAME}`) }).click();
  await expect(page.locator('[data-row-id]')).toHaveCount(2);
  await page.getByLabel('Search the fleet').fill('10');
  await expect(page).toHaveURL(/[?&]q=10/);
  await chicagoRow(page).click();
  await expect(page).toHaveURL(new RegExp(`[?&]truck=${TRUCK_NUMBERS.chicago}`));
  await shot(page, info, '1-board-as-left');

  // The Board button.
  await toHistory(page);
  await expect(page.locator('[data-board-link]')).toHaveAttribute('href', /list=/);
  await shot(page, info, '2-history');
  await page.locator('[data-board-link]').click();
  await expectBoardAsLeft(page, listId);
  await shot(page, info, '3-board-restored');

  // G B.
  await toHistory(page);
  await page.locator('[data-history-header]').waitFor();
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expectBoardAsLeft(page, listId);
});

test('a list deleted while away: Board goes to the full fleet at /, with no notice', async ({ page }) => {
  const listId = await seedList();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?list=${listId}&truck=${TRUCK_NUMBERS.chicago}`);
  await expect(page.locator('[data-row-id]')).toHaveCount(2);
  await toHistory(page);
  await deleteList(listId);
  await page.reload();
  await expect(page.locator('[data-board-link]')).toHaveAttribute('href', '/');
  await page.locator('[data-board-link]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-row-id]')).toHaveCount(3);
  await expect(page.locator('[data-list-notice]')).toHaveCount(0);
  await expect(page.locator('[data-list-title]')).toHaveCount(0);
});

test('a fresh tab that opens on /history: Board goes to /', async ({ browser }) => {
  await seedList();
  const context = await browser.newContext({ storageState: 'e2e/.auth/dispatcher.json' });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/history');
    await page.locator('[data-history-header]').waitFor();
    await expect(page.locator('[data-board-link]')).toHaveAttribute('href', '/');
    await page.locator('[data-board-link]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-row-id]')).toHaveCount(3);
  } finally {
    await context.close();
  }
});

test('the phone: the Board link goes back to the list the board was left on', async ({ browser }) => {
  const listId = await seedList();
  const { context, page } = await onPhone(browser, SIZES[3]);
  try {
    await page.goto(`/?list=${listId}`);
    await page.locator('[data-phone-topbar]').waitFor();
    await expect(page.locator('[data-phone-card]')).toHaveCount(2);
    await page.locator('[data-phone-account]').tap();
    await page.getByRole('menuitem', { name: /Driver history/ }).tap();
    await expect(page).toHaveURL(/\/history/);
    const back = page.locator('[data-phone-board-link]');
    await expect(back).toHaveAttribute('href', `/?list=${listId}`);
    await back.tap();
    await expect(page).toHaveURL(new RegExp(`/\\?list=${listId}$`));
    await expect(page.locator('[data-phone-card]')).toHaveCount(2);
  } finally {
    await context.close();
  }
});
