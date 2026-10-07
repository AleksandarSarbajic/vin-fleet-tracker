import { expect, test } from '@playwright/test';
import { IDS, ZIP_STOP, connect, resetWorld, TEST_DATABASE_URL } from './fixtures';

/**
 * §12.85 through the real screen: a ZIP-centre stop marked arrived in the
 * modal, the truck driving away, the real worker sweep, and the row clearing.
 *
 * Truck 103 sits on the fixture's zip-precision stop — the stop the sweep
 * can never arrive (arrival.spec.ts). Before §12.85 a dispatcher's arrival
 * there could never END either: the departure rule measured from the ZIP
 * centroid and refused coarse stops outright, so the row read "marked"
 * however far the truck drove.
 *
 * The fixture's position is four minutes old, so it is the anchor, and the
 * drive-away fixes are written after the save, newer than it.
 */

test.beforeEach(async () => {
  await resetWorld({ feedAgeMinutes: 4 });
});

/** A wall time in the stop's zone, derived rather than pasted. */
function chicagoWall(instant: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${p['year']}-${p['month']}-${p['day']}`, time: `${p['hour']}:${p['minute']}` };
}

async function sweep() {
  const { sweepArrivals } = await import('../src/worker/arrival');
  const { createDirectDb } = await import('../src/db/connection');
  const handle = createDirectDb(
    TEST_DATABASE_URL,
    1,
  );
  try {
    return await sweepArrivals(handle.db, { info: () => {} });
  } finally {
    await handle.client.end({ timeout: 5 });
  }
}

test('a hand-marked ZIP arrival clears when the truck drives away', async ({ page }, info) => {
  const shot = (name: string) =>
    page
      .locator(`[data-row-id="${IDS.truckAtZipStop}"]`)
      .screenshot({ path: info.outputPath(`${name}.png`) });

  await page.goto('/');
  const row = page.locator(`[data-row-id="${IDS.truckAtZipStop}"]`);
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/marked|arrived/i);
  await shot('1-before');

  // Mark it arrived fifteen minutes ago, on the receiver's clock.
  await row.click();
  await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog', { name: /^(Edit|New) load for truck / });
  await expect(modal).toBeVisible();
  await modal.getByLabel('This truck has arrived at this stop').check();
  const wall = chicagoWall(new Date(Date.now() - 15 * 60_000));
  await modal.getByLabel('Arrival date').fill(wall.date);
  await modal.getByLabel('Arrival time at the stop').fill(wall.time);
  await modal.getByRole('button', { name: /^Save$/ }).click();
  // No warning: the truck was there, so the modal closes over a clean save.
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect(row).toContainText(/marked/i, { timeout: 20_000 });
  await shot('2-marked');

  const sql = connect();
  try {
    const [anchored] = await sql<{ lat: number | null; lng: number | null; at: Date | null }[]>`
      select arrival_anchor_lat as lat, arrival_anchor_lng as lng, arrival_anchor_at as at
        from stops where id = ${IDS.stopZip}`;
    // The truck's position, which here is the centroid itself.
    expect(anchored!.lat).toBeCloseTo(ZIP_STOP.lat, 6);
    expect(anchored!.lng).toBeCloseTo(ZIP_STOP.lng, 6);
    expect(anchored!.at).not.toBeNull();

    // A single GPS jump first: one fix, six miles off, at highway speed.
    await sql`
      insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
      values (${IDS.truckAtZipStop}, ${ZIP_STOP.lat + 6 / 69}, ${ZIP_STOP.lng}, null, 62,
              ${new Date(Date.now() - 200_000)}, ${'Chicago, IL'})`;
    const jumped = await sweep();
    expect(jumped.departed).toBe(0);

    // Then the real thing: three minutes south at 50 mph, a fix every 6 s.
    const milesPerFix = (50 / 3600) * 6;
    const now = Date.now();
    for (let i = 1, s = 180; s >= 0; s -= 6, i += 1) {
      await sql`
        insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
        values (${IDS.truckAtZipStop}, ${ZIP_STOP.lat - (i * milesPerFix) / 69}, ${ZIP_STOP.lng},
                180, 50, ${new Date(now - s * 1000)}, ${'Chicago, IL'})`;
    }
    const swept = await sweep();
    expect(swept.departed).toBe(1);

    const [left] = await sql<{ departed: Date | null }[]>`
      select departed_at as departed from stops where id = ${IDS.stopZip}`;
    expect(left!.departed).not.toBeNull();
    const [audit] = await sql<{ after: { source: string } }[]>`
      select after from audit_log
       where entity_id = ${IDS.stopZip} and after ? 'departedAt'`;
    expect(audit!.after.source).toBe('departure-after-manual-arrival');
  } finally {
    await sql.end({ timeout: 5 });
  }

  await page.reload();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/marked|arrived/i);
  await shot('3-cleared');
});
