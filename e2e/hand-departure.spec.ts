import { expect, test, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.118. The departure a dispatcher marks, through the real modal, the real
 * route and the real board query: the truck has left its stop, and the board
 * moves on — to nothing on a one-stop load, to the delivery on a two-stop one.
 */

const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const editModal = (page: Page, truck: number) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${truck}$`) });

async function openModal(page: Page, truckId: string, truck: number) {
  await rowOf(page, truckId).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
}

/** Ticks arrived and left, at the defaults — now, at the stop — and saves. */
async function markLeftAndSave(page: Page, truck: number) {
  const modal = editModal(page, truck);
  await modal.getByRole('checkbox', { name: 'This truck has arrived at this stop' }).check();
  await modal.getByRole('checkbox', { name: 'This truck has left this stop' }).check();
  await expect(modal.getByText('Unticking the arrival clears the departure too.')).toBeVisible();
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
}

async function stopsOf(loadId: string) {
  const sql = connect();
  try {
    return await sql<
      { sequence: number; arrived_source: string | null; departed_source: string | null }[]
    >`select sequence, arrived_source::text, departed_source::text
        from stops where load_id = ${loadId} order by sequence`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('a one-stop load: marked left, the truck has no next stop and the load waits for Clear stop', async ({ page }) => {
  await resetWorld();
  await page.goto('/');
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await markLeftAndSave(page, TRUCK_NUMBERS.chicago);

  expect(await stopsOf(IDS.loadChicago)).toEqual([
    { sequence: 1, arrived_source: 'dispatcher', departed_source: 'dispatcher' },
  ]);
  // Opened again, the modal is in its new-load state, naming the open load.
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await expect(editModal(page, TRUCK_NUMBERS.chicago)).toContainText(
    'No next stop. 1 previous load still open',
  );
});

test('a two-stop load: marked left at the pickup, the row moves to the delivery', async ({ page }) => {
  await resetWorld();
  const sql = connect();
  try {
    await sql`
      insert into stops (load_id, type, sequence, address_line, city, state, zip, lat, lng,
                         geocode_precision, appointment_type)
      values (${IDS.loadDallas}, 'DEL', 2, ${'9 Test Dock'}, ${'Fort Worth'}, ${'TX'}, ${'76102'},
              32.7555, -97.3308, 'street', 'APPT')`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  await page.goto('/');
  await expect(rowOf(page, IDS.truckDallas)).toContainText('Dallas');
  await openModal(page, IDS.truckDallas, TRUCK_NUMBERS.dallas);
  await markLeftAndSave(page, TRUCK_NUMBERS.dallas);

  await expect(rowOf(page, IDS.truckDallas)).toContainText('Fort Worth', { timeout: 20_000 });
  expect(await stopsOf(IDS.loadDallas)).toEqual([
    { sequence: 1, arrived_source: 'dispatcher', departed_source: 'dispatcher' },
    { sequence: 2, arrived_source: null, departed_source: null },
  ]);
});
