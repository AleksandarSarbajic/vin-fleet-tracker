import { expect, test } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, resetWorld } from './fixtures';

/**
 * §12.78. Drivers only, end to end: the shortcut, the chip, the list, the
 * header's hidden count, the URL, and a reload that keeps it.
 *
 * The fixture's filler trucks have no driver and no load, so they are what
 * the toggle hides. Truck 103 has no driver but a live appointment — it is
 * UNASSIGNED, a load that needs a driver — and must survive the toggle.
 */
test.beforeEach(async () => {
  await resetWorld({ extraTrucks: 3 });
});

const FILLER = ['200', '201', '202'];

test('Drivers only hides parked driverless trucks, never an Unassigned one', async ({ page }) => {
  await page.goto('/');
  const row = (n: string | number) =>
    page.locator('[data-row-id]').filter({ has: page.getByText(String(n), { exact: true }) });
  const chip = page.getByRole('button', { name: /^Drivers only/ });

  for (const n of FILLER) await expect(row(n)).toBeVisible();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');

  await page.locator('body').press('8');

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  for (const n of FILLER) await expect(row(n)).toHaveCount(0);
  await expect(page.locator(`[data-row-id="${IDS.truckAtZipStop}"]`)).toBeVisible();
  await expect(page.locator(`[data-row-id="${IDS.truckChicago}"]`)).toBeVisible();
  await expect(page.locator(`[data-row-id="${IDS.truckDallas}"]`)).toBeVisible();
  await expect(page.getByRole('button', { name: '3 without a driver hidden' })).toBeVisible();
  await expect(page).toHaveURL(/chips=drivers/);

  // A link carries it.
  await page.reload();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  for (const n of FILLER) await expect(row(n)).toHaveCount(0);

  // The note is the way back.
  await page.getByRole('button', { name: '3 without a driver hidden' }).click();
  for (const n of FILLER) await expect(row(n)).toBeVisible();
  await expect(page).not.toHaveURL(/chips=/);
  expect(TRUCK_NUMBERS.zip).toBe(103);
});
