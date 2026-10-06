import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fcfsEndDate } from '../src/lib/appointment';
import { calendarDayInZone } from '../src/lib/calendar';
import { timeInZone, wallTimeInstant, windowLength, zoneAbbreviation } from '../src/lib/format';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.114 end to end: 22:00–06:00 receiving hours typed into the real modal,
 * converted by the real route and Postgres, and read back on the row, the
 * popup and the timeline — each with its `+1`. Then reopened, not dirty.
 *
 * The night is TONIGHT at the stop, derived at run time, so the expected
 * abbreviations and length come from the zone database rather than a paste:
 * on the two nights a year the clocks change, the same assertions expect 7
 * or 9 hours and the end's own abbreviation.
 */

const TZ = 'America/Chicago';
const OPEN = { h: 22, min: 0 };
const CLOSE = { h: 6, min: 0 };

test.beforeEach(async () => {
  await resetWorld();
});

const rowOf = (page: Page) => page.locator(`[data-row-id="${IDS.truckChicago}"]`);
const editModal = (page: Page) =>
  page.getByRole('dialog', { name: `Edit stop for truck ${TRUCK_NUMBERS.chicago}` });
const shoot = (info: TestInfo) => async (name: string, target: ReturnType<Page['locator']>) =>
  target.screenshot({ path: info.outputPath(`${name}.png`) });

async function openModal(page: Page) {
  await rowOf(page).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page)).toBeVisible();
}

test('22:00–06:00 saves as the next morning and reads +1 everywhere', async ({ page }, info) => {
  const shot = shoot(info);

  const today = calendarDayInZone(new Date(), TZ);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const evening = { y, m, d };
  const opens = wallTimeInstant(evening, OPEN, TZ);
  const closes = wallTimeInstant(fcfsEndDate(evening, OPEN, CLOSE), CLOSE, TZ);
  const openAbbrev = zoneAbbreviation(opens, TZ);
  const closeAbbrev = zoneAbbreviation(closes, TZ);
  const length = windowLength(Math.round((closes.getTime() - opens.getTime()) / 60_000));

  await page.goto('/');
  await openModal(page);
  const modal = editModal(page);

  // -- the form ------------------------------------------------------------
  await modal.getByRole('button', { name: 'FCFS', exact: true }).click();
  await modal.getByLabel('Date (stop-local)').fill(today);
  await modal.getByLabel('Earliest receiving hour').fill('22:00');
  await modal.getByLabel(/^Latest/).fill('06:00');

  const line = modal.locator('[data-ends-next-day]');
  await expect(line).toHaveText(
    `Ends next day · ${timeInZone(closes, TZ, { weekday: true })} · ${length}`,
  );
  await shot('1-modal-ends-next-day', modal);

  await modal.getByRole('button', { name: /^Save$/ }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });

  // -- what was stored -------------------------------------------------------
  const sql = connect();
  try {
    const [stop] = await sql<{ start: Date; end: Date; type: string }[]>`
      select appointment_start_utc as start, appointment_end_utc as "end",
             appointment_type as type
        from stops where id = ${IDS.stopChicago}`;
    expect(stop!.type).toBe('FCFS');
    expect(stop!.start.toISOString()).toBe(opens.toISOString());
    expect(stop!.end.toISOString()).toBe(closes.toISOString());
    expect(calendarDayInZone(stop!.end, TZ)).not.toBe(today);

    const [audit] = await sql<{ after: { appointmentEndUtc: string; appointmentType: string } }[]>`
      select after from audit_log
       where entity = 'stop' and entity_id = ${IDS.stopChicago}
       order by created_at desc limit 1`;
    expect(audit!.after.appointmentType).toBe('FCFS');
    expect(audit!.after.appointmentEndUtc).toBe(closes.toISOString());
  } finally {
    await sql.end({ timeout: 5 });
  }

  // -- the row ----------------------------------------------------------------
  const row = rowOf(page);
  // "by" and the time are separate spans, so the text has no space between them.
  await expect(row).toContainText(new RegExp(`by\\s*06:00 ${closeAbbrev} \\+1`), {
    timeout: 20_000,
  });
  await shot('2-row', row);

  // -- the popup ---------------------------------------------------------------
  const popup = page.locator('.ft-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText(`22:00 ${openAbbrev} to 06:00 ${closeAbbrev} +1`);
  await shot('3-popup', popup);

  // -- the timeline ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Timeline' }).click();
  const timeline = page.getByRole('dialog', {
    name: `Timeline for truck ${TRUCK_NUMBERS.chicago}`,
  });
  await expect(timeline).toContainText(`22:00 ${openAbbrev} – 06:00 ${closeAbbrev} +1`);
  await shot('4-timeline', timeline);
  await page.keyboard.press('Escape');
  await expect(timeline).toBeHidden();

  // -- reopened: as saved, and not dirty -----------------------------------------
  await openModal(page);
  await expect(modal.getByLabel('Earliest receiving hour')).toHaveValue('22:00');
  await expect(modal.getByLabel(/^Latest/)).toHaveValue('06:00');
  await expect(line).toBeVisible();
  await expect(modal).not.toContainText('Unsaved changes');
});
