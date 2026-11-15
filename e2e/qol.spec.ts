import { expect, test, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';
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
