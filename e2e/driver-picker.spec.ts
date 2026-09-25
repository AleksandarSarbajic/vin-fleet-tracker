import { expect, test } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, resetWorld } from './fixtures';

test.beforeEach(async () => {
  await resetWorld();
});

/**
 * The driver list opened by itself on an empty truck.
 *
 * The modal puts its opening focus on the driver picker when the truck has no
 * driver, and the picker used to open on ANY focus — so the list of every
 * driver was already expanded before the dispatcher had touched anything.
 * Focus alone now leaves it shut; a click opens it. Opened fresh three times,
 * because the complaint was about every opening, not the first.
 *
 * `toBeFocused` is half the point. The map popup behind the modal used to
 * take focus ~100 ms after the modal opened (Mapbox's focusAfterOpen), so a
 * test that only checked the list could pass with the caret nowhere useful.
 */
test('an unassigned truck’s modal opens with the driver list closed', async ({ page }) => {
  await page.goto('/');
  const row = page.locator(`[data-row-id="${IDS.truckAtZipStop}"]`);
  await expect(row).toBeVisible();

  const modal = page.getByRole('dialog', { name: new RegExp(`truck ${TRUCK_NUMBERS.zip}`) });
  const picker = modal.getByRole('combobox', { name: `Driver for truck ${TRUCK_NUMBERS.zip}` });

  for (let opening = 1; opening <= 3; opening++) {
    await row.dblclick();
    await expect(modal).toBeVisible();
    await expect(picker).toBeEnabled();
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await expect(modal.getByRole('listbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  }

  // The keyboard path lands in the same place.
  await row.click();
  await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();
  await expect(picker).toBeFocused();
  await expect(modal.getByRole('listbox')).toHaveCount(0);

  // And the list is one click away.
  await picker.click();
  await expect(modal.getByRole('listbox')).toBeVisible();
  await expect(picker).toHaveAttribute('aria-expanded', 'true');
});
