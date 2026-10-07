import { expect, test, type Page } from '@playwright/test';
import { IDS, resetWorld } from './fixtures';

/**
 * §12.119. The edit modal at the shortest screen it is used on (720px tall),
 * at the three narrowest widths: it opens at its own top — the load strip
 * whole, the driver note clear of its neighbours, Save on screen — however
 * low the field that takes the opening focus. And the keys: Tab, Space and
 * Enter on the stop type, Esc out of the modal.
 */

/**
 * Opened the way a link to the truck opens it — `?truck=101` selects it, and
 * Enter opens the modal on the selection — so neither the list nor the map,
 * whichever half of the narrow layout is showing, has to be clicked first.
 */
async function openModal(page: Page) {
  await page.goto('/?truck=101');
  await page.locator('[data-console-header]').waitFor();
  // Selected — its row says so, or, with the map showing, its popup is open.
  await expect(
    page
      .locator(`[data-row-id="${IDS.truckChicago}"][aria-selected="true"]`)
      .or(page.locator('.mapboxgl-popup')),
  ).not.toHaveCount(0);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit load for truck 101' });
  await dialog.locator('[role="tabpanel"]').waitFor();
  return dialog;
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const width of [1280, 1024, 768]) {
  test(`at ${width}x720 the modal opens at its top, the load strip whole`, async ({ page }) => {
    await resetWorld();
    await page.setViewportSize({ width, height: 720 });
    const dialog = await openModal(page);

    const scroll = dialog.locator('[data-edit-scroll]');
    // The appointment date is below the fold at 720px, and a native date
    // input scrolls itself into view when focused: the street address, at the
    // top of the stop's form, takes the focus instead, and nothing scrolls.
    await expect(dialog.getByLabel('Street address')).toBeFocused();
    await page.waitForTimeout(300);
    expect(await scroll.evaluate((el) => el.scrollTop)).toBe(0);

    const area = (await scroll.boundingBox())!;
    const strip = (await dialog.locator('[data-load-strip]').boundingBox())!;
    expect(strip.y).toBeGreaterThanOrEqual(area.y);
    expect(strip.y + strip.height).toBeLessThanOrEqual(area.y + area.height);

    // Every label of the strip whole, and the driver note touching none of them.
    const labels = dialog.locator('[data-load-strip] label > span:first-child');
    const note = (await dialog.getByText('Driver change requires confirm').boundingBox())!;
    for (let i = 0; i < (await labels.count()); i += 1) {
      const box = (await labels.nth(i).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(area.y);
      expect(overlaps(note, box), `driver note over "${await labels.nth(i).textContent()}"`).toBe(false);
    }

    // The footer is on the screen, not under it.
    const save = (await dialog.getByRole('button', { name: 'Save' }).boundingBox())!;
    expect(save.y + save.height).toBeLessThanOrEqual(720);
  });
}

test('the stop type answers Tab, Space and Enter; Esc closes the modal', async ({ page }) => {
  await resetWorld();
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialog = await openModal(page);
  const type = dialog.getByRole('group', { name: 'Stop type' });
  const pickUp = type.getByRole('button', { name: 'Pick up' });
  const deliver = type.getByRole('button', { name: 'Deliver' });
  await expect(deliver).toHaveAttribute('aria-pressed', 'true');

  await deliver.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(pickUp).toBeFocused();
  await page.keyboard.press('Space');
  await expect(pickUp).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toContainText('Unsaved changes — stop type.');

  await page.keyboard.press('Tab');
  await expect(deliver).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(deliver).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).not.toContainText('Unsaved changes');

  // Clean again: Esc closes it, as it always has.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
