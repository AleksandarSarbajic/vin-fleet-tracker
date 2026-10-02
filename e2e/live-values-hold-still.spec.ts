import { expect, test, type Page } from '@playwright/test';
import { resetWorld } from './fixtures';

/**
 * §12.99. A value that ticks by itself may not move anything else on the
 * screen. Two did: the header's "Synced Ns ago" moved the Assignments button
 * every time the age crossed 9 → 10 (every 20-second poll), and the map
 * footer's "newest Ns ago" reflowed the Mapbox and Census credits that share
 * its line.
 *
 * Each age is rewritten in place through the values it really takes between
 * polls — narrow, then wide — and every element outside it (anything that is
 * not the age, inside it, or a box containing it) must keep one position and
 * one size throughout.
 */

const VALUES = ['1s', '9s', '10s', '59s', '88s', '1m', '9m', '59m'];

async function holdsStill(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ selector, values }) => {
      const age = document.querySelector(selector);
      if (!age) return [`${selector} is not on the page`];
      const others = [...document.querySelectorAll('body *')].filter(
        (el) => el !== age && !age.contains(el) && !el.contains(age),
      );
      const boxes = () =>
        others.map((el) => {
          const r = el.getBoundingClientRect();
          return `${r.x},${r.y},${r.width},${r.height}`;
        });
      const original = age.textContent;
      const seen = values.map((v) => {
        age.textContent = v;
        return boxes();
      });
      age.textContent = original;
      const moved = new Set<string>();
      seen.forEach((snap, i) =>
        snap.forEach((box, j) => {
          if (box !== seen[0]![j]) {
            const el = others[j]!;
            moved.add(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}" at ${values[i]}`,
            );
          }
        }),
      );
      return [...moved].slice(0, 6);
    },
    { selector, values: VALUES },
  );
}

test.beforeEach(async () => {
  await resetWorld();
});

test('desktop 1440: the header sync age moves nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-live-age="sync"]')).toBeVisible({ timeout: 15_000 });
  expect(await holdsStill(page, '[data-live-age="sync"]')).toEqual([]);
});

test('desktop 1440: the map footer age moves nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-live-age="map-footer"]')).toBeVisible({ timeout: 15_000 });
  expect(await holdsStill(page, '[data-live-age="map-footer"]')).toEqual([]);
});

test('phone 390: the map footer age moves nothing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('[data-phone-tab="map"]').click();
  await expect(page.locator('[data-live-age="map-footer"]')).toBeVisible({ timeout: 15_000 });
  expect(await holdsStill(page, '[data-live-age="map-footer"]')).toEqual([]);
});
