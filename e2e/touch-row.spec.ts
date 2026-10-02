import { expect, test } from '@playwright/test';
import { IDS, resetWorld } from './fixtures';

/**
 * §12.95 — on a screen without hover, a tap anywhere on a row selects the
 * truck. The row's copy buttons and pin star only ever appeared on hover, so
 * on a phone they were invisible buttons in the middle of the row: at 430px
 * the row's centre was "Copy address", and a tap there copied instead of
 * selecting. With a mouse they still appear on hover and work.
 *
 * §12.96, stage 2: below 768px the rows are the phone's cards, which have no
 * copy or pin buttons at all. The rule still matters on a touch screen 768px
 * and wider — a tablet, which draws the desktop rows — so that is where this
 * runs now: 820×1180, an iPad Air held upright.
 */

const SENTINEL = 'clipboard before the tap';

test('touch, 820px tablet: a tap on the middle of a row selects it and copies nothing', async ({
  browser,
}) => {
  await resetWorld();
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    storageState: 'e2e/.auth/dispatcher.json',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ft.tour.seen', '1');
    } catch {
      // No storage: the tour may open and the tap below then fails loudly.
    }
  });
  const page = await context.newPage();
  await page.goto('/');

  // The emulation really is a screen without hover.
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);

  const toggle = page.getByRole('button', { name: /^(Show|Hide) map$/ });
  await toggle.waitFor();
  if (/Hide map/.test((await toggle.textContent()) ?? '')) await toggle.tap();
  const row = page.locator(`[data-row-id="${IDS.truckChicago}"]`);
  await row.waitFor();

  await page.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);
  // The middle of the row — where "Copy address" used to catch the tap.
  const box = (await row.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

  await expect(row).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SENTINEL);

  // …because nothing hover-only is drawn: not the copy buttons, not the pin star.
  await expect(row.getByRole('button', { name: 'Copy address' })).toBeHidden();
  await expect(row.getByRole('button', { name: 'Copy load info' })).toBeHidden();
  await expect(row.getByRole('button', { name: /^Pin truck/ })).toBeHidden();
  await context.close();
});

test('mouse, 1280px: the copy buttons and pin star appear on hover and work', async ({
  page,
  context,
}) => {
  await resetWorld();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);

  const row = page.locator(`[data-row-id="${IDS.truckChicago}"]`);
  await row.waitFor();
  const copyAddress = row.getByRole('button', { name: 'Copy address' });
  const pin = row.getByRole('button', { name: /^Pin truck/ });

  // Invisible until the row is hovered, then there.
  await expect(copyAddress).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(copyAddress).toHaveCSS('opacity', '1');
  await expect(pin).toHaveCSS('opacity', '1');

  // Copying copies, and does not select.
  await copyAddress.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /Chicago, IL/,
  );
  await expect(row).toHaveAttribute('aria-selected', 'false');

  // Pinning pins.
  await pin.click();
  await expect(
    page.getByRole('button', { name: `Unpin truck 101` }).first(),
  ).toHaveAttribute('aria-pressed', 'true');
});
