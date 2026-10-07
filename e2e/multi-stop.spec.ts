import { expect, test, type Page } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.119, stage 4b. A load of several stops through the real modal, the
 * real route and the real board query:
 *
 *   1. a new load is entered as a pickup and a delivery, in one save;
 *   2. the worker's departure from the pickup is written (as the worker
 *      writes it), and the row moves to the delivery;
 *   3. a third stop is added; the delivery is removed, the stops renumber,
 *      and the row moves to the stop that took its place;
 *   4. Clear stop says how many stops were never reached, and the load is
 *      reopened from "Recently closed", every stop back as it was.
 *
 * Every address is put in the geocode cache first, so no save reaches the
 * network.
 */

const TRUCK = TRUCK_NUMBERS.chicago;
const PICKUP = { addressLine: '1900 N 25th Ave', city: 'Melrose Park', state: 'IL', zip: '60160' };
const DELIVERY = { addressLine: '2 Test Dock', city: 'Joliet', state: 'IL', zip: '60431' };
const THIRD = { addressLine: '3 Test Dock', city: 'Aurora', state: 'IL', zip: '60502' };
const PLACES = [
  { ...PICKUP, lat: 41.9006, lng: -87.8567 },
  { ...DELIVERY, lat: 41.525, lng: -88.0817 },
  { ...THIRD, lat: 41.7606, lng: -88.3201 },
];

const rowOf = (page: Page) => page.locator(`[data-row-id="${IDS.truckChicago}"]`);
const editModal = (page: Page) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${TRUCK}$`) });
const tabs = (page: Page) => editModal(page).getByRole('tab');
const stopForm = (page: Page) => editModal(page).getByRole('tabpanel');

async function db<T>(body: (sql: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Truck 101 with no load at all, and every address here already geocoded. */
async function emptyTruckAndCachedAddresses() {
  await db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
    for (const p of PLACES) {
      await sql`
        insert into geocode_cache (normalized_address, lat, lng, precision, confidence,
                                   matched_address, provider)
        values (${normalizeAddress(p)}, ${p.lat}, ${p.lng}, 'street', ${'census:exact'},
                ${`${p.addressLine.toUpperCase()}, ${p.city.toUpperCase()}, ${p.state}, ${p.zip}`},
                ${CHAIN_VERSION})
        on conflict (normalized_address) do nothing`;
    }
  });
}

const stopsOnTruck = () =>
  db((sql) => sql<
    { load_id: string; status: string; sequence: number; type: string; city: string; arrived: boolean; departed: boolean }[]
  >`
    select l.id as load_id, l.status::text, s.sequence, s.type::text, s.city,
           s.arrived_at is not null as arrived, s.departed_at is not null as departed
      from loads l join stops s on s.load_id = l.id
     where l.truck_id = ${IDS.truckChicago}
     order by s.sequence`);

/** Tomorrow at the stop, as the date input takes it. */
const tomorrow = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
    new Date(Date.now() + 24 * 3_600_000),
  );

async function fillAddress(page: Page, place: typeof PICKUP) {
  const form = stopForm(page);
  await form.getByLabel('Street address').fill(place.addressLine);
  await form.getByLabel('ZIP').fill(place.zip);
  await form.getByLabel('City').fill(place.city);
  await form.getByLabel('State').fill(place.state);
}

async function openModal(page: Page) {
  await rowOf(page).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page)).toBeVisible();
  await stopForm(page).waitFor();
}

async function save(page: Page) {
  await editModal(page).getByRole('button', { name: 'Save' }).click();
  await expect(editModal(page)).toBeHidden({ timeout: 20_000 });
}

test('a pickup and a delivery: entered in one save, left, a stop removed, cleared and reopened', async ({ page }) => {
  await resetWorld();
  await emptyTruckAndCachedAddresses();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  /* ---------------------- 1. one save, two stops ---------------------- */
  await openModal(page);
  await expect(editModal(page).getByRole('heading', { level: 2 })).toHaveText(`New load — truck ${TRUCK}`);
  await editModal(page).getByLabel('Load number').fill('E2E-MULTI');
  await stopForm(page).getByRole('button', { name: 'Pick up' }).click();
  await fillAddress(page, PICKUP);

  await editModal(page).getByRole('button', { name: 'Add stop' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(stopForm(page).getByLabel('Street address')).toBeFocused();
  await expect(stopForm(page).getByRole('button', { name: 'Deliver' })).toHaveAttribute('aria-pressed', 'true');
  await fillAddress(page, DELIVERY);
  await stopForm(page).getByLabel('Date (stop-local)').fill(tomorrow());
  await stopForm(page).getByLabel('Time at the stop').fill('14:00');
  await save(page);

  const created = await stopsOnTruck();
  expect(created.map((s) => [s.sequence, s.type, s.city])).toEqual([
    [1, 'PU', 'Melrose Park'],
    [2, 'DEL', 'Joliet'],
  ]);
  const loadId = created[0]!.load_id;
  const saveIds = await db((sql) => sql<{ save_id: string }[]>`
    select distinct after->>'saveId' as save_id from audit_log
     where entity = 'stop' and after->>'loadId' = ${loadId}`);
  expect(saveIds).toHaveLength(1);
  await expect(rowOf(page)).toContainText('Melrose Park', { timeout: 20_000 });

  /* ------------------- 2. the worker's departure ---------------------- */
  // Written as the arrival sweep writes it: detected in, then detected out.
  await db((sql) => sql`
    update stops set arrived_at = now() - interval '40 minutes', arrived_source = 'detected',
                     departed_at = now() - interval '5 minutes', departed_source = 'detected'
     where load_id = ${loadId} and sequence = 1`);
  // Read afresh rather than waited for: the console polls every 20 s, and a
  // wait as long as the poll is a race with it. What is tested is the board's
  // query naming the delivery once the pickup is left.
  await page.reload();
  await expect(rowOf(page)).toContainText('Joliet', { timeout: 20_000 });

  /* ------------------- 3. add a stop, remove one ---------------------- */
  await openModal(page);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await tabs(page).nth(0).click();
  await expect(stopForm(page).getByRole('button', { name: 'Remove stop' })).toBeDisabled();
  await expect(stopForm(page).getByRole('button', { name: 'Remove stop' })).toHaveAttribute(
    'title',
    /^Can't remove: the truck arrived here at \d{2}:\d{2} \S+\.$/,
  );
  await expect(stopForm(page).locator('[data-remove-why]')).toHaveText(
    /^Can't remove: the truck arrived here at \d{2}:\d{2} \S+\.$/,
  );
  await editModal(page).getByRole('button', { name: 'Add stop' }).click();
  await stopForm(page).getByRole('button', { name: 'Deliver' }).click();
  await fillAddress(page, THIRD);
  await stopForm(page).getByLabel('Time at the stop').fill('18:00');
  await save(page);
  expect((await stopsOnTruck()).map((s) => s.city)).toEqual(['Melrose Park', 'Joliet', 'Aurora']);

  await openModal(page);
  await tabs(page).nth(1).click();
  await stopForm(page).getByRole('button', { name: 'Remove stop' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(editModal(page)).toContainText('Unsaved changes — stop 2 (Joliet, IL) removed.');
  await save(page);

  const renumbered = await stopsOnTruck();
  expect(renumbered.map((s) => [s.sequence, s.city])).toEqual([
    [1, 'Melrose Park'],
    [2, 'Aurora'],
  ]);
  await expect(rowOf(page)).toContainText('Aurora', { timeout: 20_000 });

  /* ------------------ 4. Clear stop, then Reopen ----------------------- */
  const statusBefore = renumbered[0]!.status;
  await openModal(page);
  await expect(tabs(page)).toHaveCount(2);
  await editModal(page).getByRole('button', { name: 'Clear stop' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm clear stop' });
  await expect(confirm).toContainText('All 2 of its stops close with it.');
  await expect(confirm).toContainText('1 of its stops was never reached; it stays on record as not reached.');
  await confirm.getByRole('button', { name: 'Close load' }).click();
  await expect(editModal(page)).toBeHidden({ timeout: 20_000 });
  expect((await stopsOnTruck())[0]!.status).toBe('DELIVERED');

  await openModal(page);
  const section = page.locator('[data-recently-closed]');
  await section.locator('summary').click();
  await section.getByRole('button', { name: 'Reopen…' }).click();
  await page.getByRole('dialog', { name: 'Confirm reopen load' }).getByRole('button', { name: 'Reopen load' }).click();
  await expect(editModal(page)).toBeHidden({ timeout: 20_000 });

  const reopened = await stopsOnTruck();
  expect(reopened.map((s) => [s.status, s.sequence, s.city, s.arrived, s.departed])).toEqual([
    // Back to the status it had before the close, every stop as it was.
    [statusBefore, 1, 'Melrose Park', true, true],
    [statusBefore, 2, 'Aurora', false, false],
  ]);
  await expect(rowOf(page)).toContainText('Aurora', { timeout: 20_000 });
  await openModal(page);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toContainText('Departed');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(editModal(page)).not.toContainText('Unsaved changes');
});
