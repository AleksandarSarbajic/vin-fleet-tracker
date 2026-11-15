import { expect, test, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, makeFeedStale, resetWorld } from './fixtures';
import { isoDayIn, startOfDayIn } from '../src/test/zone-day';
import { nextCalendarDay } from '../src/lib/calendar';

/**
 * Phase 3bw (§12.163): QoL batch 1, each feature's `hand` path from the 3bf demo, in the real
 * app: the real build, the real routes, the real database. One describe per feature.
 */

const CHICAGO = 'America/Chicago';
const HOUR = 3_600_000;

const rowOf = (page: Page, id: string = IDS.truckChicago) => page.locator(`[data-row-id="${id}"]`);
const editModal = (page: Page, truck: number = TRUCK_NUMBERS.chicago) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${truck}$`) });

async function openModal(page: Page, id: string = IDS.truckChicago, truck: number = TRUCK_NUMBERS.chicago) {
  await page.goto('/');
  await rowOf(page, id).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
  return editModal(page, truck);
}

async function db<T>(body: (sql: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A clock as the app's lines write one, in a zone: `15:00`. */
const clockIn = (instant: Date, zone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);

/* ------------------------------------------------------------------ 4 */

/**
 * The dispatcher's zone for feature 4: one on another date from the stop's (Chicago) right now.
 * Kiritimati is 19 or 20 hours ahead of Chicago and Pago Pago 5 or 6 behind, so at any instant
 * one of the two is on another date. Derived when the file loads, never pasted.
 */
const OTHER_DAY_ZONE =
  ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find((zone) => isoDayIn(new Date(), zone) !== isoDayIn(new Date(), CHICAGO)) ??
  'Pacific/Kiritimati';

test.describe('4: Today and Tomorrow beside the appointment date', () => {
  test.use({ timezoneId: OTHER_DAY_ZONE });

  test('Today writes the date at the stop, from the stop\'s zone, a note says the dates differ, and Tomorrow is saved as the stop\'s wall date', async ({
    page,
  }) => {
    // Three days on at about 15:00 in Chicago, so Tomorrow is always a change and always ahead.
    const seeded = new Date(startOfDayIn(new Date(Date.now() + 72 * HOUR), CHICAGO).getTime() + 15 * HOUR);
    await resetWorld({ appointmentUtc: seeded });
    const modal = await openModal(page);
    const date = modal.locator('[data-fill="appointment.date"]');
    expect(await date.inputValue()).toBe(isoDayIn(seeded, CHICAGO));

    const before = new Date();
    await modal.getByRole('button', { name: 'Today at this stop' }).click();
    const after = new Date();
    const written = await date.inputValue();
    // The stop's date at the click: either side of a midnight that fell during it.
    expect([isoDayIn(before, CHICAGO), isoDayIn(after, CHICAGO)]).toContain(written);
    expect(written).not.toBe(isoDayIn(after, OTHER_DAY_ZONE));
    await expect(modal.locator('[data-stop-day-note]')).toContainText('At this stop it is');
    await expect(modal.locator('[data-stop-day-note]')).toContainText('Your own date is');

    await modal.getByRole('button', { name: 'Tomorrow at this stop' }).click();
    const tomorrow = await date.inputValue();
    expect(tomorrow).toBe(nextCalendarDay(written));

    await modal.getByRole('button', { name: /^Save$/ }).click();
    await expect(modal).toBeHidden({ timeout: 20_000 });
    const [stop] = await db((sql) => sql<{ start: Date; tz: string }[]>`
      select appointment_start_utc as start, appointment_tz as tz from stops where id = ${IDS.stopChicago}`);
    expect(stop!.tz).toBe(CHICAGO);
    // The wall date the button wrote, at the wall clock the stop already had.
    expect(isoDayIn(stop!.start, CHICAGO)).toBe(tomorrow);
    expect(clockIn(stop!.start, CHICAGO)).toBe(clockIn(seeded, CHICAGO));
  });
});

/* ------------------------------------------------------------------ 10 */

const search = (page: Page) => page.getByRole('textbox', { name: 'Search the fleet' });

test.describe('10: search marks what matched, everywhere it matched', () => {
  test('the truck number is marked; a ZIP and a load number the row does not show are shown, marked; the copy controls over that cell still work', async ({
    page,
    context,
  }) => {
    await resetWorld();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const row = rowOf(page);
    await expect(row).toBeVisible();

    await search(page).fill(String(TRUCK_NUMBERS.chicago));
    await expect(row.locator('.bg-highlight').first()).toHaveText(String(TRUCK_NUMBERS.chicago));
    await expect(row.locator('[data-search-hint]')).toHaveCount(0);

    // The seed's stop: 1 Test Dock, Chicago, IL 60601, load E2E-101, the truck's one open load.
    await search(page).fill('60601');
    await expect(row.locator('[data-search-hint]')).toHaveText('ZIP 60601 · ');
    await expect(row.locator('[data-search-hint] .bg-highlight')).toHaveText('60601');
    await expect(rowOf(page, IDS.truckAtZipStop)).toHaveCount(0);

    // The copy controls sit over the right edge of the cell the hint starts: each is still the
    // thing under its own middle, and each still copies.
    await row.hover();
    for (const [label, expected] of [
      ['Copy address', '1 Test Dock, Chicago, IL, 60601'],
      ['Copy load info', 'Load: E2E-101'],
    ] as const) {
      const button = row.getByRole('button', { name: label });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      const top = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.getAttribute('aria-label') ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(top, `${label} is what lies under its own middle`).toBe(label);
      await button.click();
      await expect(button).toContainText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(expected);
    }

    await search(page).fill('e2e-101');
    await expect(row.locator('[data-search-hint]')).toHaveText('Load E2E-101 · ');
  });
});

/* ------------------------------------------------------------------ 11 */

test.describe('11: C copies the address, T opens the timeline', () => {
  test('click a row, press C, press T; neither works while typing or behind a window; the sheet lists both', async ({
    page,
    context,
  }) => {
    await resetWorld();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const row = rowOf(page);
    await row.click();

    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await page.keyboard.press('c');
    await expect(row.getByRole('button', { name: 'Copy address' })).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1 Test Dock, Chicago, IL, 60601');

    // Typing: the key goes into the field, and nothing is copied.
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await search(page).focus();
    await page.keyboard.press('c');
    await expect(search(page)).toHaveValue('c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
    await search(page).fill('');
    await row.click();

    await page.keyboard.press('t');
    const timeline = page.getByRole('dialog', { name: `Timeline for truck ${TRUCK_NUMBERS.chicago}` });
    await expect(timeline).toBeVisible();
    // Behind a window: C copies nothing.
    await page.keyboard.press('c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
    await page.keyboard.press('Escape');
    await expect(timeline).toBeHidden();

    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog').filter({ hasText: "Copy the selected truck's address" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Open the selected truck's timeline");
  });
});

/* ------------------------------------------------------------------ 14 */

test.describe('14: Copy the ETA line, from the popup', () => {
  test('select a truck, Copy ETA: one line whose ETA is the popup\'s own; on a stale feed it copies nothing and says why', async ({
    page,
    context,
  }) => {
    await resetWorld();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await rowOf(page).click();
    const popup = page.locator('.mapboxgl-popup');
    await expect(popup).toBeVisible();
    const projected = (await popup.getByText(/ETA \d\d:\d\d /).first().textContent()) ?? '';
    const eta = /ETA \d\d:\d\d [A-Z][A-Za-z0-9+-]+/.exec(projected)?.[0];
    expect(eta, `the popup's Projected line: "${projected}"`).toBeTruthy();

    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await popup.getByRole('button', { name: 'Copy ETA' }).click();
    await expect(popup.locator('[data-copy-eta]')).toHaveText('✓ Copied');
    const line = await page.evaluate(() => navigator.clipboard.readText());
    expect(line).toMatch(new RegExp(`^Truck ${TRUCK_NUMBERS.chicago} · Chicago, IL · ${eta} · (\\d+ mi|arriving)$`));

    await makeFeedStale();
    await page.reload();
    await rowOf(page).click();
    await expect(popup).toBeVisible();
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await popup.getByRole('button', { name: 'Copy ETA' }).click();
    await expect(popup.locator('[data-eta-copy-note]')).toHaveText('The feed is down, so there is no ETA to quote from this screen.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
  });
});
