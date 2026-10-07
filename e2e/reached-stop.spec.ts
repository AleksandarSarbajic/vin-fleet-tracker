import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * The overwritten-trips fix, through the real modal and the real route.
 *
 * Truck 141 on 2026-09-28: load 12120640 was detected in at Joliet at 07:40,
 * and at 08:04 the same stop was typed over with 200584 Des Plaines — the
 * Joliet visit survives only in the audit log. Here truck 101's stop is
 * detected in an hour ago and not departed, and the dispatcher types the
 * next trip over it.
 *
 * The new address is put in the geocode cache first, so no save here reaches
 * the network.
 */

const NEXT = { addressLine: '1 Test Dock', city: 'Des Plaines', state: 'IL', zip: '60016' };
const DES_PLAINES = { lat: 42.0334, lng: -87.8834 };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function reachChicagoStop() {
  const sql = connect();
  try {
    await sql`update stops set arrived_at = ${hoursAgo(1)}, arrived_source = 'detected'
               where id = ${IDS.stopChicago}`;
    await sql`
      insert into geocode_cache (normalized_address, lat, lng, precision, confidence,
                                 matched_address, provider)
      values (${normalizeAddress(NEXT)}, ${DES_PLAINES.lat}, ${DES_PLAINES.lng}, 'street',
              ${'census:exact'}, ${'1 TEST DOCK, DES PLAINES, IL, 60016'}, ${CHAIN_VERSION})
      on conflict (normalized_address) do nothing`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function truckState(truckId: string) {
  const sql = connect();
  try {
    return await sql<
      {
        load_id: string;
        load_number: string | null;
        status: string;
        city: string | null;
        arrived: boolean;
        located: boolean;
      }[]
    >`
      select l.id as load_id, l.load_number, l.status, s.city,
             s.arrived_at is not null as arrived, s.lat is not null as located
        from loads l join stops s on s.load_id = l.id
       where l.truck_id = ${truckId}
       order by l.created_at, s.sequence`;
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
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${truck}$`) });
const reachedQuestion = (page: Page) => page.getByRole('dialog', { name: 'Stop already reached' });
const shot = (page: Page, info: TestInfo, name: string, target = page.locator('body')) =>
  target.screenshot({ path: info.outputPath(`${name}.png`) });

async function openModal(page: Page, truckId: string, truck: number) {
  await rowOf(page, truckId).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
}

/** Types the next trip over the reached stop and presses Save. */
async function typeNextTripAndSave(page: Page) {
  const modal = editModal(page, TRUCK_NUMBERS.chicago);
  await modal.getByLabel('Load number').fill('200584');
  await modal.getByLabel('City').fill(NEXT.city);
  await modal.getByLabel('ZIP').fill(NEXT.zip);
  await modal.getByRole('button', { name: 'Save' }).click();
}

test('"Next trip": the reached load closes as Delivered and the new load is saved beside it', async ({
  page,
}, info) => {
  await resetWorld();
  await reachChicagoStop();
  await page.goto('/');
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await typeNextTripAndSave(page);

  const question = reachedQuestion(page);
  await expect(question).toContainText(
    /This stop was reached at (\w{3} )?\d{2}:\d{2} C[DS]T\. Is this a correction, or the next trip\?/,
  );
  await expect(question).toContainText('Load E2E-101 closes as Delivered');
  await expect(question.getByRole('button', { name: 'Back to the form' })).toBeFocused();
  await shot(page, info, '1-reached-stop-question', question);
  // Nothing is written while the question is open.
  expect((await truckState(IDS.truckChicago)).map((r) => [r.load_number, r.status])).toEqual([
    ['E2E-101', 'DISPATCHED'],
  ]);

  await question.getByRole('button', { name: 'Next trip' }).click();
  await expect(editModal(page, TRUCK_NUMBERS.chicago)).toBeHidden({ timeout: 20_000 });

  const after = await truckState(IDS.truckChicago);
  expect(after.map(({ load_id: _id, ...rest }) => rest)).toEqual([
    // The trip that happened, kept exactly as it was.
    { load_number: 'E2E-101', status: 'DELIVERED', city: 'Chicago', arrived: true, located: true },
    // The next one: located, and not reached yet.
    { load_number: '200584', status: 'DISPATCHED', city: 'Des Plaines', arrived: false, located: true },
  ]);
  expect(await closeAudit(IDS.loadChicago)).toEqual([['operator-clear-stop', 'DELIVERED']]);
  await expect(rowOf(page, IDS.truckChicago)).toContainText('Des Plaines');
});

test('"Correction": saved as typed on the same stop, and the address change clears the arrival', async ({
  page,
}) => {
  await resetWorld();
  await reachChicagoStop();
  await page.goto('/');
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await typeNextTripAndSave(page);
  await reachedQuestion(page).getByRole('button', { name: 'Correction' }).click();
  await expect(editModal(page, TRUCK_NUMBERS.chicago)).toBeHidden({ timeout: 20_000 });

  expect(await truckState(IDS.truckChicago)).toEqual([
    {
      load_id: IDS.loadChicago,
      load_number: '200584',
      status: 'DISPATCHED',
      city: 'Des Plaines',
      // §12.85, unchanged: a new address is a new place.
      arrived: false,
      located: true,
    },
  ]);
  expect(await closeAudit(IDS.loadChicago)).toEqual([]);
});

test('"Back to the form" saves nothing and keeps the typing', async ({ page }) => {
  await resetWorld();
  await reachChicagoStop();
  await page.goto('/');
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await typeNextTripAndSave(page);
  // Focus starts on Back, so Enter — a carried-over Save keystroke — goes back.
  await page.keyboard.press('Enter');
  await expect(reachedQuestion(page)).toBeHidden();
  const modal = editModal(page, TRUCK_NUMBERS.chicago);
  await expect(modal.getByLabel('City')).toHaveValue(NEXT.city);
  expect((await truckState(IDS.truckChicago)).map((r) => [r.load_number, r.city])).toEqual([
    ['E2E-101', 'Chicago'],
  ]);
});

test('a stop that was not reached saves a new number without the question', async ({ page }) => {
  await resetWorld();
  await page.goto('/');
  await openModal(page, IDS.truckDallas, TRUCK_NUMBERS.dallas);
  const modal = editModal(page, TRUCK_NUMBERS.dallas);
  await modal.getByLabel('Load number').fill('NEW-555');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect(reachedQuestion(page)).toHaveCount(0);
  expect((await truckState(IDS.truckDallas)).map((r) => r.load_number)).toEqual(['NEW-555']);
});

test('the route refuses a save that skips the question, and writes nothing', async ({ page }) => {
  await resetWorld();
  await reachChicagoStop();
  await page.goto('/');
  // §12.117. The save names the load and the version it edits; the load
  // read is where an API client gets that version.
  const read = await page.request.get(`/api/loads/${IDS.loadChicago}`);
  expect(read.status()).toBe(200);
  const { version } = (await read.json()) as { version: string };
  const response = await page.request.post('/api/stops', {
    data: {
      loadId: IDS.loadChicago,
      truckId: IDS.truckChicago,
      version,
      loadNumber: '200584',
      loadStatus: 'DISPATCHED',
      stops: [{ stopId: IDS.stopChicago, stopType: 'DEL', ...NEXT, appointment: null }],
    },
  });
  expect(response.status()).toBe(409);
  const body = (await response.json()) as { reachedStop?: { arrivedAt: string } };
  expect(Date.parse(body.reachedStop?.arrivedAt ?? '')).not.toBeNaN();
  expect((await truckState(IDS.truckChicago)).map((r) => [r.load_number, r.city, r.arrived])).toEqual([
    ['E2E-101', 'Chicago', true],
  ]);
});
