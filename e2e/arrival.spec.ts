import { expect, test } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, ZIP_STOP, connect, resetWorld } from './fixtures';

test.beforeEach(async () => {
  await resetWorld();
});

/**
 * A ZIP-precision stop never arrives, however close the truck gets.
 *
 * The fixture parks truck 103 on the stop's exact coordinates — zero miles —
 * and arrival must still not fire. A ZIP centroid is the middle of a postal
 * area, not a dock, so "the truck is at the coordinates" carries no
 * information about whether it has reached anywhere. A rule keyed on proximity
 * alone gets this wrong in the most confident way available: it reports an
 * arrival that did not happen, at a place that was never checked.
 *
 * Run through the REAL sweep rather than asserted on the UI alone. Asserting
 * only that the row is not green would pass for any number of uninteresting
 * reasons — no position, no appointment, a crash in the sweep. Running the
 * sweep and finding it deliberately declined is the assertion worth making.
 */
test('a truck parked exactly on a zip-precision stop still does not arrive', async ({ page }) => {
  const sql = connect();
  try {
    const [stop] = await sql<{ lat: number; lng: number; precision: string }[]>`
      select lat, lng, geocode_precision as precision from stops where id = ${IDS.stopZip}`;
    const [pos] = await sql<{ lat: number; lng: number }[]>`
      select lat, lng from positions where truck_id = ${IDS.truckAtZipStop}`;

    // The premise: same coordinates, and the stop really is zip precision.
    expect(stop!.precision).toBe('zip');
    expect(pos!.lat).toBeCloseTo(stop!.lat, 6);
    expect(pos!.lng).toBeCloseTo(stop!.lng, 6);
    expect(pos!.lat).toBeCloseTo(ZIP_STOP.lat, 6);

    // The real worker sweep, against this exact state.
    const { sweepArrivals } = await import('../src/worker/arrival');
    const { createDirectDb } = await import('../src/db/connection');
    const handle = createDirectDb(
      process.env.TEST_DATABASE_URL ??
        `postgres://postgres@127.0.0.1:${process.env.TEST_PGPORT ?? '55432'}/fleet_test`,
      1,
    );
    try {
      // SweepLogger is info-only; the sweep says everything through one channel.
      const swept = await sweepArrivals(handle.db, { info: () => {} });
      // It looked at the stop and declined it — not "never considered it".
      expect(swept.considered).toBeGreaterThan(0);
      expect(swept.arrived).toBe(0);
    } finally {
      await handle.client.end({ timeout: 5 });
    }

    const [after] = await sql<{ arrived: Date | null }[]>`
      select arrived_at as arrived from stops where id = ${IDS.stopZip}`;
    expect(after!.arrived).toBeNull();
  } finally {
    await sql.end({ timeout: 5 });
  }

  // And the console agrees: the row is not showing an arrival.
  await page.goto('/');
  const row = page.locator(`[data-row-id="${IDS.truckAtZipStop}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(String(TRUCK_NUMBERS.zip));
  await expect(row).not.toContainText(/arrived/i);
});
