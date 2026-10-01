import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.92 — a truck whose only load has arrived and departed, automatically,
 * and was never closed: truck 124 on 2026-10-01. The modal opens in its
 * new-load state, and must say what is still open, close it from the line,
 * and ask about it before a new load is saved over it.
 *
 *   truck 101  6612193 (Vernon Hills), detected in and out, still open
 *   truck 102  the same, plus a second previous load with no number,
 *              marked by hand — two lines, two questions
 */

const LOAD_B = '33333333-3333-4333-8333-3333333333b3';
const STOP_B = '44444444-4444-4444-8444-4444444444b3';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

/** Arrived 2 h ago, left 1 h ago, both detected; the load still AVAILABLE. */
async function finishOnTheRoad(loadId: string, stopId: string, loadNumber: string) {
  const sql = connect();
  try {
    await sql`update loads set load_number = ${loadNumber}, status = 'AVAILABLE'
               where id = ${loadId}`;
    await sql`
      update stops set city = ${'Vernon Hills'}, zip = ${'60061'},
                       arrived_at = ${hoursAgo(2)}, arrived_source = 'detected',
                       departed_at = ${hoursAgo(1)}
       where id = ${stopId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A second previous load on 102: no number, marked by hand, left 3 h ago. */
async function secondPreviousOn102() {
  const sql = connect();
  try {
    await sql`
      insert into loads (id, truck_id, load_number, status, created_at)
      values (${LOAD_B}, ${IDS.truckDallas}, ${null}, 'AVAILABLE', ${hoursAgo(9)})`;
    await sql`
      insert into stops (id, load_id, type, sequence, address_line, city, state, zip,
                         lat, lng, geocode_precision, appointment_tz, appointment_type,
                         arrived_at, arrived_source, departed_at)
      values (${STOP_B}, ${LOAD_B}, 'DEL', 1, ${'2 Test Dock'}, ${'Joliet'}, ${'IL'},
              ${'60433'}, 41.525, -88.0817, 'street', ${'America/Chicago'}, 'APPT',
              ${hoursAgo(4)}, 'dispatcher', ${hoursAgo(3)})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function loadsOf(truckId: string) {
  const sql = connect();
  try {
    return await sql<{ id: string; load_number: string | null; status: string }[]>`
      select id, load_number, status from loads where truck_id = ${truckId}
       order by created_at`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function closeAudit(loadId: string) {
  const sql = connect();
  try {
    return (
      await sql<{ after: { source: string; loadStatus: string } }[]>`
        select after from audit_log where entity = 'load' and entity_id = ${loadId}`
    ).map((r) => [r.after.source, r.after.loadStatus]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const editModal = (page: Page, truck: number) =>
  page.getByRole('dialog', { name: `Edit stop for truck ${truck}` });
const shot = (page: Page, info: TestInfo, name: string, target = page.locator('body')) =>
  target.screenshot({ path: info.outputPath(`${name}.png`) });

async function openModal(page: Page, truckId: string, truck: number) {
  await rowOf(page, truckId).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
}

/** The dispatch-time clock for an instant, as the line prints it. */
const clock = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);

test('one previous load: the header and the line say so, and Close load… closes it', async ({
  page,
}, info) => {
  await resetWorld();
  const arrived = hoursAgo(2);
  await finishOnTheRoad(IDS.loadChicago, IDS.stopChicago, '6612193');
  await page.goto('/');
  const row = rowOf(page, IDS.truckChicago);
  await expect(row).not.toContainText('6612193');

  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  const modal = editModal(page, TRUCK_NUMBERS.chicago);
  await expect(modal.locator('h2')).toHaveText('New load — truck 101');
  await expect(modal.locator('h2 + p')).toContainText(
    'No next stop. 1 previous load still open',
  );
  await expect(modal).not.toContainText('No load on this truck yet');
  const line = modal.locator('[data-previous-load]');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(
    new RegExp(
      `Previous load 6612193: Vernon Hills, arrived ${clock(arrived)} C[DS]T, departed \\d{2}:\\d{2} C[DS]T \\(detected automatically\\)\\. Still open\\.`,
    ),
  );
  await expect(modal.getByRole('button', { name: 'Clear stop' })).toHaveAttribute(
    'title',
    'Close previous load 6612193 (Vernon Hills).',
  );
  await shot(page, info, '1-modal-one-previous-load', modal);

  await line.getByRole('button', { name: 'Close load…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm clear stop' });
  await expect(confirm).toContainText('Load 6612193 is closed as Delivered.');
  await page.keyboard.press('Enter');
  await expect(modal).toBeHidden({ timeout: 20_000 });

  expect((await loadsOf(IDS.truckChicago)).map((l) => l.status)).toEqual(['DELIVERED']);
  expect(await closeAudit(IDS.loadChicago)).toEqual([
    ['operator-clear-stop', 'DELIVERED'],
  ]);

  // The row: no open load now, so the modal would say "No load" — and Clear
  // stop would be disabled with it.
  await expect(row).toContainText(/No appt/i);
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await expect(modal.locator('h2 + p')).toContainText('No load on this truck yet');
  await expect(modal.getByRole('button', { name: 'Clear stop' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // The timeline keeps the delivered load: it was left an hour ago.
  await row.click();
  await page.getByRole('button', { name: 'Timeline' }).click();
  const timeline = page.getByRole('dialog', {
    name: `Timeline for truck ${TRUCK_NUMBERS.chicago}`,
  });
  await expect(timeline).toContainText('6612193');
  await expect(timeline).toContainText('Load delivered');
});

test('saving a new load asks about the previous one; Delivered closes it with the save', async ({
  page,
}, info) => {
  await resetWorld();
  await finishOnTheRoad(IDS.loadChicago, IDS.stopChicago, '6612193');
  await page.goto('/');
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  const modal = editModal(page, TRUCK_NUMBERS.chicago);

  // No address, so the save does not geocode; the load number makes it dirty.
  await modal.getByLabel('Load number').fill('NEW-777');
  await modal.getByRole('button', { name: 'Save' }).click();
  const question = page.getByRole('dialog', { name: 'Previous load still open' });
  await expect(question).toContainText(
    'Previous load 6612193 is still open. Close it as Delivered?',
  );
  await expect(question.getByRole('button', { name: 'Back to the form' })).toBeFocused();
  await shot(page, info, '3-save-time-question-one-load', question);
  // Nothing written while the question is open.
  expect((await loadsOf(IDS.truckChicago)).map((l) => l.status)).toEqual(['AVAILABLE']);

  await question.getByRole('button', { name: 'Delivered', exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });

  expect((await loadsOf(IDS.truckChicago)).map((l) => [l.load_number, l.status])).toEqual(
    [
      ['6612193', 'DELIVERED'],
      ['NEW-777', 'AVAILABLE'],
    ],
  );
  expect(await closeAudit(IDS.loadChicago)).toEqual([
    ['operator-clear-stop', 'DELIVERED'],
  ]);
  // The row names a load only when there are two (§12.13); the modal names it.
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await expect(modal.locator('h2')).toHaveText('Edit stop — truck 101');
  await expect(modal.locator('h2 + p')).toContainText('NEW-777');
  await expect(modal.locator('[data-previous-load]')).toHaveCount(0);
});

test('two previous loads: two lines, two questions, and only the answered one closes', async ({
  page,
}, info) => {
  await resetWorld();
  await finishOnTheRoad(IDS.loadDallas, IDS.stopDallas, 'E2E-102');
  await secondPreviousOn102();
  await page.goto('/');
  await openModal(page, IDS.truckDallas, TRUCK_NUMBERS.dallas);
  const modal = editModal(page, TRUCK_NUMBERS.dallas);

  await expect(modal.locator('h2 + p')).toContainText(
    'No next stop. 2 previous loads still open',
  );
  const lines = modal.locator('[data-previous-load]');
  await expect(lines).toHaveCount(2);
  // Oldest first, as the timeline orders them.
  await expect(lines.nth(0)).toContainText(
    /^Previous load no number: Joliet, arrived .*\(marked by hand\)\. Still open\./,
  );
  await expect(modal.getByRole('button', { name: 'Clear stop' })).toHaveAttribute(
    'title',
    'Close one of 2 previous loads: no number (Joliet), E2E-102 (Vernon Hills).',
  );
  await shot(page, info, '2-modal-two-previous-loads', modal);

  await modal.getByLabel('Load number').fill('NEW-888');
  await modal.getByRole('button', { name: 'Save' }).click();
  const question = page.getByRole('dialog', { name: 'Previous load still open' });
  await expect(question.locator('[data-save-question]')).toHaveCount(2);
  await shot(page, info, '4-save-time-question-two-loads', question);

  await question
    .locator(`[data-save-question="${IDS.loadDallas}"]`)
    .getByRole('button', { name: 'Delivered', exact: true })
    .click();
  // One of two answered: still nothing written.
  expect((await loadsOf(IDS.truckDallas)).map((l) => l.status)).toEqual([
    'AVAILABLE',
    'AVAILABLE',
  ]);
  await question
    .locator(`[data-save-question="${LOAD_B}"]`)
    .getByRole('button', { name: 'Keep it open' })
    .click();
  await expect(modal).toBeHidden({ timeout: 20_000 });

  const after = await loadsOf(IDS.truckDallas);
  expect(after.map((l) => [l.load_number, l.status])).toEqual([
    [null, 'AVAILABLE'],
    ['E2E-102', 'DELIVERED'],
    ['NEW-888', 'AVAILABLE'],
  ]);
  expect(await closeAudit(IDS.loadDallas)).toEqual([
    ['operator-clear-stop', 'DELIVERED'],
  ]);
  expect(await closeAudit(LOAD_B)).toEqual([]);
});
