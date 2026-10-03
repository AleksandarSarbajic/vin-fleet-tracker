import { expect, test, type Browser, type Page } from '@playwright/test';
import { HISTORY_NOW, seedHistory } from './history-seed';
import { SIZES, controls, onPhone, smallText, within } from './phone-helpers';

/**
 * §12.102 — Driver history below 768px: the design's phone layout. One card
 * per driver with the days listed inside, empty days folded, every load a
 * 48px row that opens the tooltip's details in a bottom sheet.
 *
 * The same rules as the board's phone view (`phone.spec.ts`, by the same
 * helpers): nothing cut off, every control 44px, no sideways scroll, no text
 * under 12px, the sheet inside the screen — at every phone size.
 *
 * The page's contract: `data-history-phone`, `data-phone-history-card`,
 * `data-phone-day`, `data-phone-load`, `data-load-sheet`, `data-phone-week`.
 */

type Size = (typeof SIZES)[number];

async function open(browser: Browser, size: Size, week = '2026-W40') {
  const { context, page } = await onPhone(browser, size);
  await page.clock.setFixedTime(HISTORY_NOW);
  await page.goto(`/history?week=${week}`);
  await page.locator('[data-history-phone]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1300);
  return { context, page };
}

/** One test, every size — the board's phone checks are shaped the same way. */
function perSize(title: string, body: (page: Page, size: Size, browser: Browser) => Promise<void>, week?: string) {
  test(title, async ({ browser }) => {
    test.setTimeout(240_000);
    await seedHistory();
    for (const size of SIZES) {
      const { context, page } = await open(browser, size, week);
      try {
        await test.step(size.name, () => body(page, size, browser));
      } finally {
        await context.close();
      }
    }
  });
}

const card = (page: Page, name: string) => page.locator(`[data-phone-history-card="${name}"]`);
const sheet = (page: Page) => page.locator('[data-load-sheet]');

async function controlsHold(page: Page, size: Size, state: string) {
  const all = await controls(page, size.width);
  expect.soft(all.filter((c) => c.cut).map((c) => c.name), `${size.name} ${state}: cut off`).toEqual([]);
  expect
    .soft(all.filter((c) => c.h < 44 || c.w < 44).map((c) => `${c.name} ${c.w}×${c.h}`), `${size.name} ${state}: under 44px`)
    .toEqual([]);
  const sideways = await page.evaluate((vw) => document.documentElement.scrollWidth - vw, size.width);
  expect.soft(sideways, `${size.name} ${state}: sideways scroll`).toBeLessThanOrEqual(0);
}

perSize('a normal week: a card per driver, empty days folded, every load 48px', async (page, size) => {
  await expect(page.locator('[data-phone-history-card]')).toHaveCount(9);
  await expect(card(page, 'Marcus Reyes')).toContainText('Melrose Park, IL → Fargo, ND');
  // Luis had no truck on Thursday and Friday: one folded line, not two.
  await expect(card(page, 'Luis Ortega').locator('[data-phone-day]').filter({ hasText: 'No truck' })).toHaveText(
    /Thu 1 – Fri 2\s*No truck/,
  );
  // Saturday and Sunday are still ahead: one "Upcoming" line.
  await expect(card(page, 'Samuel Okafor').locator('[data-phone-day]').last()).toContainText('Upcoming');
  await expect(card(page, 'Tomasz Wiśniewski')).toContainText('No loads this week');
  const heights = await page.locator('[data-phone-load]').evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  expect.soft(heights.filter((h) => h < 48), `${size.name}: loads under 48px`).toEqual([]);
});

perSize('nothing cut off, every control 44px, no sideways scroll — list, lists, sheet', async (page, size) => {
  await controlsHold(page, size, 'list');
  await page.locator('[data-history-lists-phone]').scrollIntoViewIfNeeded();
  await controlsHold(page, size, 'lists');
  await card(page, 'Marcus Reyes').locator('[data-phone-load]').first().tap();
  await expect(sheet(page)).toBeVisible();
  await controlsHold(page, size, 'sheet');
});

perSize('no text under 12px — list, sheet', async (page, size) => {
  expect.soft(await smallText(page), `${size.name}: list`).toEqual([]);
  await card(page, 'Marcus Reyes').locator('[data-phone-load]').first().tap();
  await expect(sheet(page)).toBeVisible();
  expect.soft(await smallText(page), `${size.name}: sheet`).toEqual([]);
});

perSize('the bottom sheet: the tooltip’s details, inside the screen, a 44px Close', async (page, size) => {
  await card(page, 'Marcus Reyes').locator('[data-phone-load]').first().tap();
  const s = sheet(page);
  await expect(s).toBeVisible();
  await expect(s).toContainText('Load 48213');
  await expect(s).toContainText('Melrose Park, IL → Fargo, ND');
  await expect(s).toContainText('Pickup · Melrose Park, IL');
  await expect(s).toContainText('Mon 28 · 06:40 CDT');
  await expect(s).toContainText('Marcus Reyes · Truck 1147');
  expect.soft(await within(page, '[data-load-sheet]', size.width, size.height), `${size.name}: sheet fits`).toBe(true);
  const close = s.getByRole('button', { name: 'Close' });
  const box = (await close.boundingBox())!;
  expect.soft(box.height, `${size.name}: Close height`).toBeGreaterThanOrEqual(44);
  await close.tap();
  await expect(s).toHaveCount(0);
});

perSize(
  'an empty week says so, with no text under 12px',
  async (page, size) => {
    await expect(page.locator('[data-history-phone]').getByText('No loads recorded this week')).toBeVisible();
    expect.soft(await smallText(page), `${size.name}: empty`).toEqual([]);
    await controlsHold(page, size, 'empty');
  },
  '2026-W38',
);

perSize('an error says so, with a 44px Retry', async (page, size) => {
  await page.route('**/api/history?week=2026-W39', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }),
  );
  await page.locator('[data-phone-week]').getByRole('button', { name: 'Previous week' }).tap();
  await expect(page.locator('[data-history-phone]').getByText('Could not load this week')).toBeVisible({ timeout: 20_000 });
  const retry = page.locator('[data-history-phone]').getByRole('button', { name: 'Retry' });
  expect.soft((await retry.boundingBox())!.height, `${size.name}: Retry height`).toBeGreaterThanOrEqual(44);
  expect.soft(await smallText(page), `${size.name}: error`).toEqual([]);
  await controlsHold(page, size, 'error');
});

test('the week controls, the filter and the way back to the board', async ({ browser }) => {
  await seedHistory();
  const { context, page } = await open(browser, SIZES[3]);
  try {
    const week = page.locator('[data-phone-week]');
    await week.getByRole('button', { name: 'Previous week' }).tap();
    await expect(page).toHaveURL(/week=2026-W39/);
    await expect(card(page, 'Andre Baptiste')).toContainText('48155');
    await page.getByRole('button', { name: 'Jump to this week' }).tap();
    await expect(page).toHaveURL(/week=2026-W40/);
    await expect(week.getByRole('button', { name: 'Next week' })).toBeDisabled();

    await page.locator('[data-history-phone]').getByLabel('Filter drivers').fill('dana');
    await expect(page.locator('[data-phone-history-card]')).toHaveCount(1);
    await expect(page).toHaveURL(/q=dana/);

    await week.getByRole('button', { name: /Choose a week/ }).tap();
    await page.getByLabel('Jump to a date').fill('2026-09-16');
    await expect(page).toHaveURL(/week=2026-W38/);

    const back = page.locator('[data-history-phone]').getByRole('link', { name: /Board/ });
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await back.tap();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
  } finally {
    await context.close();
  }
});

test('the phone account menu has the Driver history row, 44px', async ({ browser }) => {
  await seedHistory();
  const { context, page } = await onPhone(browser, SIZES[3]);
  try {
    await page.goto('/');
    await page.locator('[data-phone-topbar]').waitFor();
    await page.locator('[data-phone-account]').tap();
    const row = page.getByRole('menuitem', { name: /Driver history/ });
    await expect(row).toBeVisible();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await row.tap();
    await expect(page).toHaveURL(/\/history/);
    await expect(page.locator('[data-history-phone]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('the phone history page adds no keyboard listeners', async ({ browser }) => {
  await seedHistory();
  const count = async (width: number, height: number, mobile: boolean) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      storageState: 'e2e/.auth/dispatcher.json',
    });
    const page = await context.newPage();
    await page.goto('/history?week=2026-W40');
    await page.locator('[data-history-toolbar]:visible, [data-history-phone]:visible').first().waitFor();
    await page.waitForTimeout(800);
    const cdp = await context.newCDPSession(page);
    const listeners = async (expression: string) => {
      const { result } = await cdp.send('Runtime.evaluate', { expression });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
      return listeners.filter((l) => l.type === 'keydown').length;
    };
    const total = (await listeners('window')) + (await listeners('document'));
    await context.close();
    return total;
  };
  expect(await count(390, 844, true)).toBe(await count(1280, 800, false));
});

test('screenshots: normal, busy, empty, sheet open, error at 320, 390, 430, 667×375', async ({ browser }, info) => {
  test.setTimeout(240_000);
  await seedHistory();
  for (const size of SIZES.filter((s) => ['320x568', '390x844', '430x932', '667x375'].includes(s.name))) {
    const shot = (page: Page, name: string) => page.screenshot({ path: info.outputPath(`${size.name}-${name}.png`) });
    for (const [week, name] of [['2026-W40', '1-normal'], ['2026-W39', '2-busy'], ['2026-W38', '3-empty']] as const) {
      const { context, page } = await open(browser, size, week);
      await shot(page, name);
      if (name === '1-normal') {
        await card(page, 'Marcus Reyes').locator('[data-phone-load]').first().tap();
        await expect(sheet(page)).toBeVisible();
        await shot(page, '4-sheet');
      }
      await context.close();
    }
    const { context, page } = await open(browser, size);
    await page.route('**/api/history?week=2026-W39', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }),
    );
    await page.locator('[data-phone-week]').getByRole('button', { name: 'Previous week' }).tap();
    await expect(page.locator('[data-history-phone]').getByText('Could not load this week')).toBeVisible({ timeout: 20_000 });
    await shot(page, '5-error');
    await context.close();
  }
});
