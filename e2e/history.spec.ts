import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { connect } from './fixtures';
import { HISTORY_NOW, seedHistory } from './history-seed';

/**
 * §12.101 — Driver history, through the real app on the fixed history of
 * `history-seed.ts`, with the browser's clock frozen at Fri Oct 2, 2026,
 * 10:42 CDT (the design's "today").
 */

const shotDir = (info: TestInfo, name: string) => info.outputPath(`${name}.png`);
const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: shotDir(info, name), fullPage: true });

/** Opens a week and waits past the header's first tick onto the frozen clock. */
async function openWeek(page: Page, week: string, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto(`/history?week=${week}`);
  await page.locator('[data-history-toolbar]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1300);
  await page.mouse.move(2, height - 2);
}

async function feedDown() {
  const sql = connect();
  try {
    await sql`update feed_health set newest_position_at = now() - interval '25 minutes',
                                     last_success_at = now() - interval '25 minutes'`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function setRole(role: 'viewer' | 'dispatcher') {
  const sql = connect();
  try {
    await sql`update profiles set role = ${role} where id = ${process.env['E2E_USER_ID']!}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const row = (page: Page, name: string) => page.locator(`[data-driver-row="${name}"]`);
/** The desktop page's content — the phone layout (§12.102) is in the page too, hidden. */
const desk = (page: Page) => page.locator('main');

test.beforeEach(async ({ page }) => {
  await seedHistory();
  await page.clock.setFixedTime(HISTORY_NOW);
});

test('from the account menu, through a week change, and back with G B', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /^Account/ }).click();
  const item = page.getByRole('menuitem', { name: /Driver history/ });
  await expect(item).toBeVisible();
  await expect(item.locator('[data-new-tag]')).toHaveText('New');
  await expect(item).toContainText('G H');
  await item.click();

  await expect(page).toHaveURL(/\/history\?week=\d{4}-W\d{2}/);
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(page).toHaveURL(/week=2026-W40/);
  await expect(page.locator('[data-week-range]')).toHaveText('Sep 28 – Oct 4, 2026');

  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page).toHaveURL(/week=2026-W39/);
  await expect(page.locator('[data-week-range]')).toHaveText('Sep 21 – 27, 2026');
  await expect(row(page, 'Marcus Reyes')).toContainText('48179');
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page).toHaveURL(/week=2026-W40/);
  // Next stops at the current week.
  await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled();

  // The "New" tag dropped after the visit.
  await page.getByRole('button', { name: /^Account/ }).click();
  await expect(page.getByRole('menuitem', { name: /Driver history/ }).locator('[data-new-tag]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await expect(page).toHaveURL(/\/history/);
});

test('a viewer reads the same page; nobody signed in gets 401 from the data', async ({ page, browser }) => {
  await setRole('viewer');
  try {
    await openWeek(page, '2026-W40');
    await expect(row(page, 'Dana Kowalski')).toContainText('48262');
    const api = await page.request.get('/api/history?week=2026-W40');
    expect(api.status()).toBe(200);
    // Nothing on the page changes data: no edit, save or delete controls.
    await expect(page.getByRole('button', { name: /edit|save|delete|clear stop/i })).toHaveCount(0);
  } finally {
    await setRole('dispatcher');
  }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const response = await anonymous.request.get(
      `${new URL(page.url()).origin}/api/history?week=2026-W40`,
    );
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});

const WIDTHS = [768, 800, 900, 1023, 1024, 1280, 1440, 1680, 1920] as const;
for (const width of WIDTHS) {
  for (const down of [false, true]) {
    test(`${width}px, feed ${down ? 'down' : 'healthy'}: the header and toolbar fit, the account button on screen`, async ({ page }) => {
      if (down) await feedDown();
      await openWeek(page, '2026-W40', width, 800);
      await expect(page.getByRole('button', { name: /^Account/ })).toBeInViewport({ ratio: 1 });
      await expect(page.locator('[data-board-link]')).toBeInViewport({ ratio: 1 });
      const measured = await page.evaluate(() => {
        const bars = ['[data-history-header] [data-header-row="1"]', '[data-history-toolbar]'].map(
          (s) => document.querySelector<HTMLElement>(s)!,
        );
        const overlaps: string[] = [];
        for (const bar of bars) {
          const box = bar.getBoundingClientRect();
          // Every control and label the bar paints — not just its direct
          // children, whose own contents can spill under a neighbour.
          const items = [
            ...bar.querySelectorAll<HTMLElement>(
              'a, button, label, input, h1, img, [data-week-tag], [data-sync-label], [data-feed-down], span[title]',
            ),
          ].filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && !el.closest('.sr-only');
          });
          const name = (el: HTMLElement) =>
            (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 24);
          for (let i = 0; i < items.length; i += 1) {
            const a = items[i]!;
            const ra = a.getBoundingClientRect();
            if (ra.left < box.left - 0.5 || ra.right > box.right + 0.5 || ra.right > window.innerWidth + 0.5)
              overlaps.push(`${name(a)} leaves the bar`);
            for (let j = i + 1; j < items.length; j += 1) {
              const b = items[j]!;
              if (a.contains(b) || b.contains(a)) continue;
              const rb = b.getBoundingClientRect();
              const across = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
              const down = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
              if (across > 0.5 && down > 0.5) overlaps.push(`${name(a)} ⟂ ${name(b)}`);
            }
          }
        }
        return {
          overlaps,
          scroll: bars.map((b) => b.scrollWidth - b.clientWidth),
          page: document.documentElement.scrollWidth - window.innerWidth,
          heights: bars.map((b) => Math.round(b.getBoundingClientRect().height)),
        };
      });
      expect(measured.page, 'the page scrolls sideways').toBeLessThanOrEqual(0);
      expect(measured.scroll, 'a bar scrolls sideways').toEqual([0, 0]);
      expect(measured.overlaps, 'overlaps').toEqual([]);
      expect(measured.heights).toEqual([48, 52]);
      if (down) await expect(page.locator('[data-history-header] [data-feed-down]')).toContainText(/Last sync \d{2}:\d{2}/);
    });
  }
}

test('the tooltip: on hover after a beat, at once on focus, gone on Esc', async ({ page }, info) => {
  await openWeek(page, '2026-W40');
  const load = row(page, 'Marcus Reyes').locator('[data-load="48213"]');
  await load.hover();
  const tip = page.locator('[data-history-tooltip]');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Load 48213');
  await expect(tip).toContainText('Melrose Park, IL → Fargo, ND');
  await expect(tip).toContainText('Pickup · Melrose Park, IL');
  await expect(tip).toContainText('Mon 28 · 06:40 CDT');
  await expect(tip).toContainText('Delivery · Fargo, ND');
  await expect(tip).toContainText('Marcus Reyes · Truck 1147');
  await page.screenshot({ path: shotDir(info, 'tooltip-1440') });
  await page.mouse.move(2, 998);
  await expect(tip).toHaveCount(0);

  const one = row(page, 'Andre Baptiste').locator('[data-load="48220"]');
  await one.focus();
  await expect(tip).toContainText('No delivery stop in the data for this load.');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
});

test('the filter narrows the drivers and rides in the address', async ({ page }) => {
  await openWeek(page, '2026-W40');
  await page.keyboard.press('/');
  await expect(page.locator('[data-history-toolbar]').getByLabel('Filter drivers')).toBeFocused();
  await page.keyboard.type('dana');
  await expect(page.locator('[data-driver-row]')).toHaveCount(1);
  await expect(page.locator('[data-history-summary]')).toHaveText('1 of 9 drivers match “dana”');
  await expect(page).toHaveURL(/q=dana/);
  await page.locator('[data-history-toolbar]').getByLabel('Filter drivers').fill('nobody');
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('[data-driver-row]')).toHaveCount(9);
});

test('the calendar picks a day’s week; a typed date jumps to its week', async ({ page }) => {
  await openWeek(page, '2026-W40');
  await page.getByRole('button', { name: /choose a week/ }).click();
  await expect(page.getByRole('button', { name: '2026-09-13' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '2026-10-03' })).toBeDisabled();
  await page.getByRole('button', { name: '2026-09-23' }).click();
  await expect(page).toHaveURL(/week=2026-W39/);
  await page.getByRole('button', { name: /choose a week/ }).click();
  await page.getByLabel('Jump to a date').fill('2026-09-16');
  await expect(page).toHaveURL(/week=2026-W38/);
  await expect(desk(page).getByText('No loads recorded this week')).toBeVisible();
});

test('states A–F at 1440 and 1920, the old-week notice, and 768 once', async ({ page }, info) => {
  test.setTimeout(180_000);
  for (const width of [1440, 1920]) {
    // A — a normal week, with the notice (it starts before Oct 2, 2026).
    await openWeek(page, '2026-W40', width, 1700);
    await expect(page.locator('[data-old-week-notice]')).toContainText(
      'Before Oct 2, 2026, a load row was sometimes reused for the next trip, so this week may be missing trips.',
    );
    await shot(page, info, `A-normal-${width}`);
    // B — drivers, no loads.
    await openWeek(page, '2026-W38', width, 1700);
    await expect(desk(page).getByText('No loads recorded this week')).toBeVisible();
    await shot(page, info, `B-empty-${width}`);
    // C — a busy week: 4 on Andre's Tuesday folds to 2 + "+2 more".
    await openWeek(page, '2026-W39', width, 1700);
    await expect(row(page, 'Andre Baptiste').getByRole('button', { name: '+2 more' })).toBeVisible();
    await shot(page, info, `C-busy-${width}`);
    // D — loading: the week's request held open.
    await openWeek(page, '2026-W40', width);
    await page.route('**/api/history?week=2026-W39', () => {});
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(desk(page).getByLabel('Loading this week')).toBeVisible();
    await shot(page, info, `D-loading-${width}`);
    await page.unroute('**/api/history?week=2026-W39');
    // E — the week's request fails.
    await openWeek(page, '2026-W40', width);
    await page.route('**/api/history?week=2026-W39', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }),
    );
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(desk(page).getByText('Could not load this week')).toBeVisible({ timeout: 20_000 });
    await shot(page, info, `E-error-${width}`);
    await page.unroute('**/api/history?week=2026-W39');
    // F — before the first record.
    await openWeek(page, '2026-W37', width, 1700);
    await expect(desk(page).getByText('No records for this week')).toBeVisible();
    await shot(page, info, `F-before-records-${width}`);
  }
  await openWeek(page, '2026-W40', 1440);
  await page.locator('[data-old-week-notice]').screenshot({ path: shotDir(info, 'old-week-notice-1440') });
  await openWeek(page, '2026-W40', 768, 1700);
  await shot(page, info, 'A-normal-768');
  await openWeek(page, '2026-W40', 1056, 816);
  await page.emulateMedia({ media: 'print' });
  await shot(page, info, 'print-letter-landscape');
});
