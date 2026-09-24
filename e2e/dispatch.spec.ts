import { expect, test } from '@playwright/test';
import {
  DRIVER_NAMES,
  IDS,
  TRUCK_NUMBERS,
  connect,
  resetWorld,
} from './fixtures';

test.beforeEach(async () => {
  await resetWorld();
});

/**
 * One write path end to end: edit, save, and see the row change.
 *
 * It crosses the route handler, the appointment conversion and revalidation —
 * the three things a component test necessarily mocks. §7's rule is the part
 * worth catching here: the dispatcher types a STOP-LOCAL wall time and the
 * server converts it, so the number that comes back in the row must be the
 * number that was typed, not that number shifted into the viewer's zone.
 */
test('an appointment edit reads back in the row, in the stop’s own zone', async ({ page }) => {
  await page.goto('/');

  const row = page.locator(`[data-row-id="${IDS.truckChicago}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await page.keyboard.press('Enter');

  const modal = page.getByRole('dialog', { name: /Edit stop for truck/ });
  await expect(modal).toBeVisible();

  // A time nothing else in the fixture uses, so the assertion cannot pass on
  // somebody else's number.
  await modal.getByLabel('Date (stop-local)').fill('2026-11-18');
  await modal.getByLabel('Time at the stop').fill('09:15');
  await modal.getByRole('button', { name: /^Save$/ }).click();

  await expect(modal).toBeHidden({ timeout: 20_000 });

  // 09:15 was entered as Chicago wall time and must come back as 09:15 CST —
  // not 15:15, which is what storing the typed number as UTC would produce.
  await expect(row).toContainText('09:15', { timeout: 20_000 });

  const sql = connect();
  try {
    const [stop] = await sql<{ start: Date; tz: string }[]>`
      select appointment_start_utc as start, appointment_tz as tz
        from stops where id = ${IDS.stopChicago}`;
    expect(stop!.tz).toBe('America/Chicago');
    // November: Chicago is CST, UTC-6, so 09:15 local is 15:15Z. Derived from
    // the zone rather than pasted, per the standing rule about DST.
    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(stop!.start);
    expect(localHour).toBe('09:15');
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/**
 * The two-sided transaction: a driver moves between trucks, and the old
 * assignment must END in the same breath as the new one begins. A half-applied
 * reassignment leaves a driver on two trucks, which the partial unique indexes
 * exist to make impossible — this checks the application actually gets there.
 */
test('reassigning a driver ends the old assignment and opens the new one', async ({ page }) => {
  await page.goto('/assignments');

  const toChicago = page.getByRole('combobox', {
    name: `Driver for truck ${TRUCK_NUMBERS.chicago}`,
  });
  const toDallas = page.getByRole('combobox', {
    name: `Driver for truck ${TRUCK_NUMBERS.dallas}`,
  });
  await expect(toChicago).toBeVisible({ timeout: 20_000 });

  const save = page.getByRole('button', { name: /Save assignments/ });

  // Marko starts on 102. Put him on 101.
  await toChicago.fill(DRIVER_NAMES.marko);
  await page.getByRole('option', { name: new RegExp(DRIVER_NAMES.marko) }).first().click();

  /**
   * Save is refused at this point, and that is the board working rather than a
   * broken test. It runs the same one-driver-one-truck rule the server
   * enforces, so a move is not "set the new truck" — it is BOTH SIDES in one
   * save, which is precisely the transaction under test. The first version of
   * this spec set only the new truck and sat waiting on a disabled button.
   */
  await expect(save).toBeDisabled();

  await toDallas.click();
  await page.getByRole('button', { name: /Unassigned — clear this truck/ }).click();

  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

  const sql = connect();
  try {
    const open = await sql<{ truck: string; driver: string }[]>`
      select truck_id as truck, driver_id as driver
        from assignments where ended_at is null`;

    const marko = open.filter((a) => a.driver === IDS.driverMarko);
    expect(marko, 'Marko must be open on exactly one truck').toHaveLength(1);
    expect(marko[0]!.truck).toBe(IDS.truckChicago);

    // The truck he left is genuinely empty, not still holding him.
    expect(open.some((a) => a.truck === IDS.truckDallas)).toBe(false);

    // And the old row was CLOSED rather than deleted: the assignment history
    // is what the audit trail is read out of.
    const [closed] = await sql<{ n: number }[]>`
      select count(*)::int as n from assignments
       where driver_id = ${IDS.driverMarko} and truck_id = ${IDS.truckDallas}
         and ended_at is not null`;
    expect(closed!.n).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
