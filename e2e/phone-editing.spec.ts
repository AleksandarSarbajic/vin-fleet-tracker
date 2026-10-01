import { expect, test, type Browser, type Page } from '@playwright/test';
import { IDS, resetWorld } from './fixtures';

/**
 * §12.94 — editing is a desktop job. Below 768px no route opens the Edit Stop
 * modal (and so Clear stop) or a bulk edit, and where an edit control would
 * be, "Editing is on the desktop console" says so. At 1280 everything still
 * works.
 */

const NOTE = 'Editing is on the desktop console';
const PHONES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '667x375 landscape', width: 667, height: 375 },
] as const;

async function onPhone(browser: Browser, width: number, height: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    storageState: 'e2e/.auth/dispatcher.json',
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ft.tour.seen', '1');
    } catch {
      // No storage: the tour may open, and the taps below would then fail loudly.
    }
  });
  return context.newPage();
}

const editor = (page: Page) => page.locator('[role="dialog"][aria-label^="Edit stop"]');
const clearConfirm = (page: Page) =>
  page.getByRole('dialog', { name: 'Confirm clear stop' });
const toggle = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) map$/ });
/** The truck number itself: a tap there selects, whatever else the row holds. */
const truckNumber = (page: Page, id: string, n: string) =>
  page.locator(`[data-row-id="${id}"]`).getByText(n, { exact: true });

async function showList(page: Page) {
  if (/Hide map/.test((await toggle(page).textContent()) ?? '')) await toggle(page).tap();
  await page.locator('[data-row-id]').first().waitFor();
}
async function showMap(page: Page) {
  if (/Show map/.test((await toggle(page).textContent()) ?? '')) await toggle(page).tap();
  await page.locator('canvas.mapboxgl-canvas').waitFor();
}

for (const phone of PHONES) {
  test(`at ${phone.name} no edit control exists and the editor cannot be opened`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    await resetWorld();
    const page = await onPhone(browser, phone.width, phone.height);
    await page.goto('/');
    await toggle(page).waitFor();

    // The popup: the truck's details, Timeline — and the note, not Edit load.
    await showList(page);
    await truckNumber(page, IDS.truckChicago, '101').tap();
    await showMap(page);
    const timeline = page.getByRole('button', { name: 'Timeline' });
    await expect(timeline).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Edit load' })).toHaveCount(0);
    await expect(page.locator('.mapboxgl-popup [data-desktop-only]')).toHaveText(NOTE);

    // A row: Enter on the selection, and a double-tap.
    await showList(page);
    await truckNumber(page, IDS.truckChicago, '101').tap();
    await page.keyboard.press('Enter');
    await truckNumber(page, IDS.truckDallas, '102').dblclick();
    await expect(editor(page)).toHaveCount(0);

    // The bulk bar: no bulk edits, the note in their place.
    await page.getByRole('checkbox', { name: 'Select truck 101' }).check();
    await page.getByRole('checkbox', { name: 'Select truck 102' }).check();
    await expect(page.getByText('2 trucks selected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Force status…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add note…' })).toHaveCount(0);
    await expect(page.locator('[data-desktop-only]').first()).toHaveText(NOTE);
    await page.keyboard.press('Escape');

    // The palette has no edit command to offer.
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog').filter({ has: page.getByRole('combobox') });
    if ((await palette.count()) > 0) {
      await page.keyboard.type('edit');
      await expect(palette).not.toContainText(/edit (stop|load)/i);
      await page.keyboard.press('Escape');
    }

    // A link cannot open it either.
    await page.goto(`/?truck=101&edit=1`);
    await toggle(page).waitFor();
    await page.waitForTimeout(800);

    await expect(editor(page)).toHaveCount(0);
    await expect(clearConfirm(page)).toHaveCount(0);
    await expect(page.locator('[data-clear-stop]')).toHaveCount(0);
    await page.context().close();
  });
}

test('at 1280 editing is unchanged: popup, Enter, double-click, Clear stop, bulk edits', async ({
  page,
}) => {
  await resetWorld();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('[data-row-id]').first().waitFor();
  await expect(page.locator('[data-desktop-only]')).toHaveCount(0);

  // The popup's Edit load opens the editor, with Clear stop in it.
  await truckNumber(page, IDS.truckChicago, '101').click();
  await page.getByRole('button', { name: 'Edit load' }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Clear stop' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);

  // Enter on the selection.
  await truckNumber(page, IDS.truckChicago, '101').click();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('Escape');

  // Double-click.
  await truckNumber(page, IDS.truckDallas, '102').dblclick();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);

  // The bulk bar keeps its edits.
  await page.getByRole('checkbox', { name: 'Select truck 101' }).check();
  await page.getByRole('checkbox', { name: 'Select truck 102' }).check();
  await expect(page.getByRole('button', { name: 'Force status…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note…' })).toBeVisible();
});
