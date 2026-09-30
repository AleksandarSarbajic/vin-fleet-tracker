import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.88 — Clear stop through the real modal, the real route and the real
 * database, then a reload to prove it stuck.
 *
 * The three timeline outcomes the confirm step can state are each met on a
 * load that is then ACTUALLY cleared, so every sentence is checked against
 * what the screen does afterwards:
 *
 *   truck 101  one load, reached 30 h ago       → leaves the timeline now
 *   truck 102  "+1 load":
 *     E2E-102-B  reached 2 h ago                → stays until 24 h after that
 *     E2E-102    never reached, due today       → leaves now; and the day's
 *                                                 "remaining" count drops
 */

const LOAD_B = '33333333-3333-4333-8333-3333333333b2';
const STOP_B = '44444444-4444-4444-8444-4444444444b2';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

test.beforeEach(async () => {
  await resetWorld();
  const sql = connect();
  try {
    // 101: its only stop was reached 30 hours ago. Joliet, so the stop's
    // city cannot be confused with the truck's position, which is Chicago.
    await sql`
      update stops set arrived_at = ${hoursAgo(30)}, arrived_source = 'detected',
                       city = ${'Joliet'}, zip = ${'60433'}
       where id = ${IDS.stopChicago}`;
    // 102: E2E-102 (Dallas) is due now and never reached …
    await sql`update stops set appointment_start_utc = ${new Date()} where id = ${IDS.stopDallas}`;
    // … and a second open load, reached two hours ago, due three hours ago.
    await sql`
      insert into loads (id, truck_id, load_number, status, created_at)
      values (${LOAD_B}, ${IDS.truckDallas}, ${'E2E-102-B'}, 'DISPATCHED', ${hoursAgo(5)})`;
    await sql`
      insert into stops (id, load_id, type, sequence, address_line, city, state, zip,
                         lat, lng, geocode_precision, appointment_start_utc,
                         appointment_tz, appointment_type, arrived_at, arrived_source)
      values (${STOP_B}, ${LOAD_B}, 'DEL', 1, ${'2 Test Dock'}, ${'Fort Worth'}, ${'TX'},
              ${'76102'}, 32.7555, -97.3308, 'street', ${hoursAgo(3)},
              ${'America/Chicago'}, 'APPT', ${hoursAgo(2)}, 'detected')`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const editModal = (page: Page, truck: number) =>
  page.getByRole('dialog', { name: `Edit stop for truck ${truck}` });
const confirmStep = (page: Page) =>
  page.getByRole('dialog', { name: 'Confirm clear stop' });

const shoot =
  (page: Page, info: TestInfo) =>
  async (name: string, target = page.locator('body')) =>
    target.screenshot({ path: info.outputPath(`${name}.png`) });

async function openModal(page: Page, truckId: string, truck: number) {
  await rowOf(page, truckId).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
}

/**
 * The popup's Timeline button, pressed directly. A truck already selected
 * before a reload does not fly the map to itself, so its popup can open
 * clipped at the map's edge under the basemap switcher — a map-placement
 * matter this spec is not about.
 */
async function openTimeline(page: Page) {
  await page.getByRole('button', { name: 'Timeline' }).dispatchEvent('click');
}

async function health(page: Page) {
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBe(true);
  return (await response.json()) as { onTime: number; late: number; remaining: number };
}

async function dbState(loadId: string) {
  const sql = connect();
  try {
    const [load] = await sql<
      { status: string }[]
    >`select status from loads where id = ${loadId}`;
    const stops = await sql<{ arrived_at: Date | null; arrived_source: string | null }[]>`
      select arrived_at, arrived_source from stops where load_id = ${loadId}`;
    const audit = await sql<{ after: { source: string; loadStatus: string } }[]>`
      select after from audit_log where entity = 'load' and entity_id = ${loadId}`;
    return { status: load!.status, stops, audit };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('a single-load truck: the modal, the confirm step, the clear, and a reload', async ({
  page,
}, info) => {
  const shot = shoot(page, info);
  await page.goto('/');
  const row = rowOf(page, IDS.truckChicago);
  await expect(row).toContainText('Joliet');

  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  const modal = editModal(page, TRUCK_NUMBERS.chicago);
  const clear = modal.getByRole('button', { name: 'Clear stop' });
  await expect(clear).toBeEnabled();
  // The modal is taller than the viewport; bring its footer into view.
  await clear.scrollIntoViewIfNeeded();
  await shot('1-modal-with-clear-stop');

  await clear.click();
  const confirm = confirmStep(page);
  await expect(confirm).toBeVisible();
  const closeLoad = confirm.getByRole('button', { name: 'Close load' });
  await expect(closeLoad).toBeFocused();
  await expect(confirm).toContainText('Load E2E-101 is closed as Delivered.');
  await expect(confirm).toContainText(
    'The arrival and departure times are kept as the record.',
  );
  await expect(confirm).toContainText(
    'It leaves the timeline now: its last arrival was more than 24 hours ago.',
  );
  await expect(confirm).toContainText(
    'Truck 101 then shows no next stop, appointment or load number.',
  );
  await expect(confirm.getByRole('radio', { name: 'Delivered' })).toBeChecked();
  await shot('2-confirm-single-load-arrived-30h-ago', confirm);

  // Esc backs out of the confirm step only.
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(modal).toBeVisible();
  expect((await dbState(IDS.loadChicago)).status).toBe('DISPATCHED');

  // Again, and Enter confirms — once the step has read the loads and said
  // what will happen, which is when a dispatcher would press it.
  await clear.click();
  await expect(closeLoad).toBeFocused();
  await expect(confirm).toContainText('Load E2E-101 is closed as Delivered.');
  await page.keyboard.press('Enter');
  await expect(modal).toBeHidden({ timeout: 20_000 });

  await expect(row).toContainText(/No appt/i);
  await expect(row).not.toContainText('Joliet');
  await shot('3-row-101-after-clear', row);

  const stored = await dbState(IDS.loadChicago);
  expect(stored.status).toBe('DELIVERED');
  expect(stored.stops[0]!.arrived_at).not.toBeNull();
  expect(stored.stops[0]!.arrived_source).toBe('detected');
  expect(stored.audit.map((a) => [a.after.source, a.after.loadStatus])).toEqual([
    ['operator-clear-stop', 'DELIVERED'],
  ]);

  await page.reload();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/No appt/i);
  await expect(row).not.toContainText('Joliet');
  await shot('4-row-101-after-reload', row);

  // As the confirm step said: reached 30 h ago, so it has left the timeline.
  await row.click();
  await openTimeline(page);
  const timeline = page.getByRole('dialog', {
    name: `Timeline for truck ${TRUCK_NUMBERS.chicago}`,
  });
  await expect(timeline).toContainText('Nothing on this truck in the last 24 hours');
});

test('a "+1 load" truck: choose, close, and the timeline and counter follow', async ({
  page,
}, info) => {
  const shot = shoot(page, info);
  await page.goto('/');
  const row = rowOf(page, IDS.truckDallas);
  await expect(row).toContainText('+1 load');
  const before = await health(page);
  await shot('5-strip-before', page.getByTitle(/^(Today:|No stops scheduled)/));

  await openModal(page, IDS.truckDallas, TRUCK_NUMBERS.dallas);
  const modal = editModal(page, TRUCK_NUMBERS.dallas);
  await modal.getByRole('button', { name: 'Clear stop' }).click();
  const confirm = confirmStep(page);
  await expect(confirm).toContainText(
    'This truck holds 2 open loads. Choose the one to close.',
  );
  const radioB = confirm.getByRole('radio', { name: /E2E-102-B/ });
  const radioA = confirm.getByRole('radio', { name: /^E2E-102 / });
  await expect(radioB).not.toBeChecked();
  await expect(radioA).not.toBeChecked();
  await expect(confirm.getByRole('button', { name: 'Close load' })).toBeFocused();
  await shot('6-confirm-plus-one-nothing-chosen', confirm);

  // Enter with nothing chosen closes nothing.
  await page.keyboard.press('Enter');
  await expect(confirm.getByRole('alert')).toHaveText('Choose which load to close.');
  expect((await dbState(LOAD_B)).status).toBe('DISPATCHED');
  expect((await dbState(IDS.loadDallas)).status).toBe('LOADED');

  await radioA.check();
  await expect(confirm).toContainText(
    'It leaves the timeline now: none of its stops was reached.',
  );
  await shot('7-confirm-plus-one-never-reached', confirm);

  await radioB.check();
  await expect(confirm).toContainText(
    /It stays on the timeline until .+, 24 hours after its last arrival\./,
  );
  await expect(confirm).toContainText(
    'Truck 102 keeps its other open load, load E2E-102.',
  );
  await shot('8-confirm-plus-one-reached-2h-ago', confirm);

  await page.keyboard.press('Enter');
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect(row).not.toContainText('+1 load');
  await expect(row).toContainText('Dallas');
  expect((await dbState(LOAD_B)).status).toBe('DELIVERED');
  expect((await dbState(IDS.loadDallas)).status).toBe('LOADED');

  // The timeline: one closed load, one open, and "now" on the open one.
  await page.reload();
  await row.click();
  await openTimeline(page);
  const timeline = page.getByRole('dialog', {
    name: `Timeline for truck ${TRUCK_NUMBERS.dallas}`,
  });
  await expect(timeline).toContainText('E2E-102-B');
  await expect(timeline).toContainText('Load delivered');
  await expect(timeline.locator('[data-stop-state="closed"]')).toHaveCount(1);
  await expect(timeline.locator('[data-stop-state="here"]')).toHaveCount(0);
  await expect(timeline.locator('[data-stop-state="ahead"]')).toContainText('← now');
  await expect(timeline.locator('[data-stop-state="closed"]')).not.toContainText('← now');
  await shot('9-timeline-plus-one-closed-and-open', timeline);
  await page.keyboard.press('Escape');
  await expect(timeline).toBeHidden();

  // Then the last load, cancelled: it was due today and never reached.
  const afterFirst = await health(page);
  await openModal(page, IDS.truckDallas, TRUCK_NUMBERS.dallas);
  await modal.getByRole('button', { name: 'Clear stop' }).click();
  await expect(confirm).toContainText('Load E2E-102 is closed as Delivered.');
  await confirm.getByRole('radio', { name: 'Cancelled' }).check();
  await expect(confirm).toContainText('Load E2E-102 is closed as Cancelled.');
  await page.keyboard.press('Enter');
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect(row).toContainText(/No appt/i);
  await shot('10-row-102-after-both-cleared', row);

  // The counter: the cancelled stop is no longer due; the delivered arrival
  // still counts as done today.
  const after = await health(page);
  expect(afterFirst.remaining).toBe(before.remaining);
  expect(after.remaining).toBe(before.remaining - 1);
  expect(after.onTime + after.late).toBe(before.onTime + before.late);
  await page.reload();
  await expect(row).toContainText(/No appt/i);
  await shot('11-strip-after', page.getByTitle(/^(Today:|No stops scheduled)/));
  info.annotations.push({
    type: 'health',
    description: `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  });
});
