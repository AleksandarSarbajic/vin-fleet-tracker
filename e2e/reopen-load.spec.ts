import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, ZIP_STOP, connect, resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.107 — Reopen load through the real console: "Recently closed on this
 * truck" in the Edit Stop modal, the confirm step in each of its shapes, the
 * write, and what the history page and the counters make of a reopened load.
 * Loads are closed through the real Clear stop route, so the close entries
 * are the ones production writes.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const editModal = (page: Page, truck: number) =>
  page.getByRole('dialog', { name: `Edit stop for truck ${truck}` });
const confirmStep = (page: Page) => page.getByRole('dialog', { name: 'Confirm reopen load' });
const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${name}.png`) });

async function sql<T>(body: (db: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const db = connect();
  try {
    return await body(db);
  } finally {
    await db.end({ timeout: 5 });
  }
}

/** Truck 103's load gets a number, and its ZIP stop a hand-marked arrival (with or without an anchor). */
async function markZipArrived(anchor: boolean): Promise<void> {
  const at = minutesAgo(30);
  await sql(async (db) => {
    await db`update loads set load_number = 'E2E-103' where id = ${IDS.loadZip}`;
    await db`update stops set arrived_at = ${at}, arrived_source = 'dispatcher',
               arrival_anchor_lat = ${anchor ? ZIP_STOP.lat : null},
               arrival_anchor_lng = ${anchor ? ZIP_STOP.lng : null},
               arrival_anchor_at = ${anchor ? at : null}
             where id = ${IDS.stopZip}`;
  });
}

async function close(page: Page, truckId: string, loadId: string): Promise<void> {
  const response = await page.request.post('/api/stops/clear', {
    data: { truckId, loadId, status: 'DELIVERED' },
  });
  expect(response.status()).toBe(200);
}

async function openModal(page: Page, truckId: string, truck: number): Promise<void> {
  await rowOf(page, truckId).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
}

async function openConfirm(page: Page): Promise<void> {
  await openModal(page, IDS.truckAtZipStop, TRUCK_NUMBERS.zip);
  const section = page.locator('[data-recently-closed]');
  await expect(section).toBeVisible();
  await section.locator('summary').click();
  await section.getByRole('button', { name: 'Reopen…' }).click();
  await expect(confirmStep(page)).toBeVisible();
}

/** The whole confirm step is on screen and nothing in it scrolls. */
async function readsWhole(page: Page): Promise<void> {
  const panel = confirmStep(page).locator(':scope > div');
  await expect(panel).toBeInViewport({ ratio: 1 });
  const scrolls = await panel.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(scrolls, 'the confirm step scrolls').toBe(false);
}

async function db103() {
  return sql(async (db) => {
    const [load] = await db<{ status: string }[]>`select status from loads where id = ${IDS.loadZip}`;
    const [stop] = await db<{ lat: number | null; at: Date | null; arrived_at: Date | null; arrived_source: string | null }[]>`
      select arrival_anchor_lat as lat, arrival_anchor_at as at, arrived_at, arrived_source
        from stops where id = ${IDS.stopZip}`;
    const audit = await db<{ after: Record<string, unknown> }[]>`
      select after from audit_log where entity = 'load' and entity_id = ${IDS.loadZip}
        and after->>'source' = 'operator-reopen-load'`;
    return { status: load!.status, stop: stop!, audit };
  });
}

test.beforeEach(async ({ page }) => {
  await resetWorld();
  await page.setViewportSize({ width: 1280, height: 720 });
});

test('a plain reopen: the confirm step, the write, and the section gone after', async ({ page }, info) => {
  await sql((db) => db`update loads set load_number = 'E2E-103' where id = ${IDS.loadZip}`);
  await page.goto('/');
  await close(page, IDS.truckAtZipStop, IDS.loadZip);
  await page.reload();
  await openConfirm(page);
  await expect(confirmStep(page).getByRole('heading')).toHaveText('Reopen load E2E-103?');
  await expect(confirmStep(page).locator('[data-reopen-first]')).toHaveText(
    /^It goes back to Dispatched, the status it had before .+ closed it as Delivered at \d{2}:\d{2} \S+\.$/,
  );
  await expect(confirmStep(page).locator('[data-reopen-lines] li')).toHaveText([
    'Arrival and departure times and addresses are not changed.',
  ]);
  await expect(confirmStep(page).getByRole('button', { name: 'Back' })).toBeFocused();
  await readsWhole(page);
  await shot(page, info, '1-confirm-plain');

  await confirmStep(page).getByRole('button', { name: 'Reopen load' }).click();
  await expect(editModal(page, TRUCK_NUMBERS.zip)).toBeHidden();
  const after = await db103();
  expect(after.status).toBe('DISPATCHED');
  expect(after.audit).toHaveLength(1);
  expect(after.audit[0]!.after).toMatchObject({ source: 'operator-reopen-load', loadStatus: 'DISPATCHED' });

  // Nothing closed in the last 7 days any more: the section is not drawn.
  await openModal(page, IDS.truckAtZipStop, TRUCK_NUMBERS.zip);
  await expect(page.locator('[data-recently-closed]')).toHaveCount(0);
});

test('a restored anchor: said, and written back exactly', async ({ page }, info) => {
  await markZipArrived(true);
  const before = await db103();
  await page.goto('/');
  await close(page, IDS.truckAtZipStop, IDS.loadZip);
  expect((await db103()).stop.lat).toBeNull();
  await page.reload();
  await openConfirm(page);
  await expect(confirmStep(page).locator('[data-reopen-lines] li')).toHaveText([
    'Chicago, IL: arrival anchor restored, so its departure is measured as before.',
    'Arrival and departure times and addresses are not changed.',
  ]);
  await readsWhole(page);
  await shot(page, info, '2-confirm-anchor-restored');
  await confirmStep(page).getByRole('button', { name: 'Reopen load' }).click();
  await expect(editModal(page, TRUCK_NUMBERS.zip)).toBeHidden();
  const after = await db103();
  expect(after.stop).toEqual(before.stop);
});

test('a missing anchor: reopened, left empty, and said in the confirm step', async ({ page }, info) => {
  await markZipArrived(false);
  await page.goto('/');
  await close(page, IDS.truckAtZipStop, IDS.loadZip);
  await page.reload();
  await openConfirm(page);
  await expect(confirmStep(page).locator('[data-reopen-lines] li')).toHaveText([
    "Chicago, IL: This stop's arrival won't clear by itself; you can untick it.",
    'Arrival and departure times and addresses are not changed.',
  ]);
  await readsWhole(page);
  await shot(page, info, '3-confirm-anchor-missing');
  await confirmStep(page).getByRole('button', { name: 'Reopen load' }).click();
  await expect(editModal(page, TRUCK_NUMBERS.zip)).toBeHidden();
  const after = await db103();
  expect(after.status).toBe('DISPATCHED');
  expect(after.stop.lat).toBeNull();
  expect(after.stop.arrived_source).toBe('dispatcher');
});

test('the truck has driven away: the late-departure warning', async ({ page }, info) => {
  await markZipArrived(true);
  // Forty miles south, a minute ago.
  await sql((db) => db`
    insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
    values (${IDS.truckAtZipStop}, ${ZIP_STOP.lat - 0.6}, ${ZIP_STOP.lng}, 180, 55, ${minutesAgo(1)}, 'Kankakee, IL')`);
  await page.goto('/');
  await close(page, IDS.truckAtZipStop, IDS.loadZip);
  await page.reload();
  await openConfirm(page);
  await expect(confirmStep(page).locator('[data-reopen-lines] li')).toHaveText([
    'Chicago, IL: arrival anchor restored, so its departure is measured as before.',
    `Truck ${TRUCK_NUMBERS.zip} has left Chicago, IL since. Its departure will be recorded from the first position after this reopen, so it can be much later than the real one.`,
    'Arrival and departure times and addresses are not changed.',
  ]);
  await readsWhole(page);
  await shot(page, info, '4-confirm-late-departure');
  await confirmStep(page).getByRole('button', { name: 'Reopen load' }).click();
  await expect(editModal(page, TRUCK_NUMBERS.zip)).toBeHidden();
  const after = await db103();
  expect((after.audit[0]!.after as { lateDepartureWarned: string[] }).lateDepartureWarned).toEqual([IDS.stopZip]);
  expect(after.stop.arrived_at).not.toBeNull();
});

/**
 * The history page and the counters. Truck 101's load is reached today (a
 * detected arrival); truck 102's is due in ten minutes. Both are closed as
 * Delivered, then reopened from the modal.
 *
 * What a close takes away, and a reopen gives back: 101 from the Arrived
 * chip, and 102 from the strip's "remaining" (a closed load is due nowhere,
 * §12.88). What a close keeps, and so a reopen does not add twice: 101's
 * arrival in the strip's on-time count — the delivery record.
 */
test('the history page shows it In progress in its original day cell, and the counters count it again', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await sql(async (db) => {
    await db`update stops set arrived_at = ${minutesAgo(90)}, arrived_source = 'detected' where id = ${IDS.stopChicago}`;
    await db`update stops set appointment_start_utc = ${new Date(Date.now() + 10 * 60_000)} where id = ${IDS.stopDallas}`;
  });
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date());
  const dayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(today);
  /*
   * The row is found by its load, not by driver: the fixture's assignment
   * starts when the world is seeded, after this arrival, so the history page
   * rightly puts the trip under "No driver assigned".
   */
  const entry = () =>
    page
      .locator('[data-driver-row]')
      .filter({ has: page.locator('[data-load="E2E-101"]') })
      .locator('[role="cell"]')
      .nth(dayIndex)
      .locator('[data-load="E2E-101"]');
  const health = async () =>
    (await (await page.request.get('/api/health')).json()) as { onTime: number; remaining: number };
  const arrivedChip = () => page.getByRole('button', { name: /^Arrived/ }).first();
  const reopenFrom = async (truckId: string, truck: number) => {
    await openModal(page, truckId, truck);
    await page.locator('[data-recently-closed] summary').click();
    await page.locator('[data-recently-closed]').getByRole('button', { name: 'Reopen…' }).click();
    await confirmStep(page).getByRole('button', { name: 'Reopen load' }).click();
    await expect(editModal(page, truck)).toBeHidden();
  };

  await page.goto('/');
  await expect(arrivedChip()).toContainText('1');
  const before = await health();
  expect(before.remaining).toBeGreaterThanOrEqual(1);
  expect(before.onTime).toBe(1);

  await close(page, IDS.truckChicago, IDS.loadChicago);
  await close(page, IDS.truckDallas, IDS.loadDallas);
  const closed = await health();
  expect(closed.remaining).toBe(before.remaining - 1);
  expect(closed.onTime).toBe(before.onTime);
  await page.goto('/history');
  await expect(entry()).toHaveAttribute('aria-label', /, Delivered$/);
  await shot(page, info, '5-history-delivered');

  await page.goto('/');
  await expect(arrivedChip()).toContainText('0');
  await reopenFrom(IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await reopenFrom(IDS.truckDallas, TRUCK_NUMBERS.dallas);

  // Counted again: the chip and "remaining" come back; on-time is not doubled.
  await expect(arrivedChip()).toContainText('1');
  expect(await health()).toEqual(before);
  await page.goto('/history');
  await expect(entry()).toHaveAttribute('aria-label', /, In progress$/);
  await shot(page, info, '6-history-in-progress');
});

test('a viewer sees the section with Reopen disabled and the reason', async ({ page }, info) => {
  await page.goto('/');
  await close(page, IDS.truckAtZipStop, IDS.loadZip);
  await sql((db) => db`update profiles set role = 'viewer' where id = ${process.env['E2E_USER_ID']!}`);
  try {
    await page.reload();
    await openModal(page, IDS.truckAtZipStop, TRUCK_NUMBERS.zip);
    await page.locator('[data-recently-closed] summary').click();
    const reopen = page.locator('[data-recently-closed]').getByRole('button', { name: 'Reopen…' });
    await expect(reopen).toBeDisabled();
    await expect(reopen).toHaveAttribute('title', 'Your role is viewer. Editing needs dispatcher.');
    await shot(page, info, '7-viewer');
    const refused = await page.request.post('/api/stops/reopen', {
      data: { truckId: IDS.truckAtZipStop, loadId: IDS.loadZip, closeAuditId: IDS.loadZip },
    });
    expect(refused.status()).toBe(403);
  } finally {
    await sql((db) => db`update profiles set role = 'dispatcher' where id = ${process.env['E2E_USER_ID']!}`);
  }
});

test('a truck with nothing closed in the last 7 days has no section', async ({ page }) => {
  await page.goto('/');
  await openModal(page, IDS.truckDallas, TRUCK_NUMBERS.dallas);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-recently-closed]')).toHaveCount(0);
});

test('on a phone there is no way to reopen', async ({ browser }) => {
  const { context, page } = await onPhone(browser, SIZES[3]);
  try {
    await page.goto('/');
    await close(page, IDS.truckAtZipStop, IDS.loadZip);
    await page.reload();
    await page.locator('[data-phone-topbar]').waitFor();
    await page.locator(`[data-phone-card="${IDS.truckAtZipStop}"]`).tap();
    await expect(page.locator('[data-truck-sheet]')).toBeVisible();
    await expect(page.locator('[data-truck-sheet] [data-desktop-only]')).toHaveText('Editing is on the desktop console');
    await expect(page.getByText('Recently closed on this truck')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Reopen/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
