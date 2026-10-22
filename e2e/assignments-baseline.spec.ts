import { expect, test, type Page } from '@playwright/test';
import { connect, seedUser, truncateAll } from './fixtures';

/**
 * §12.129–§12.132, §12.137–§12.141 — the assignment board, pixel for pixel, at the six desktop
 * widths the console's baselines use, once with the driver picker open at
 * 1024 (the narrow-desktop layout, the width the list was too narrow at), and
 * once at 1440 with changed rows and a double-booking (3am).
 *
 * Held still by:
 *
 *   - a fixed, INVENTED board, seeded here: made-up truck numbers, made-up
 *     names, 555-01xx phones. No real driver, phone or truck is in it;
 *   - the browser clock frozen. The page renders no time and no live value
 *     (no sync age, no clock: checked in AssignmentBoard and its children),
 *     so there is nothing to hide; the clock is frozen anyway so a later
 *     addition cannot move the picture silently;
 *   - no merge candidates (the tables are emptied), so the merge prompt
 *     renders nothing.
 *
 * The first run is `--update-snapshots`, and it is Alex's: e2e signs in
 * through hosted Supabase Auth. No colour tolerance, no pixel allowance
 * (playwright.config.ts).
 */

const WIDTHS = [768, 1024, 1280, 1440, 1680, 1920] as const;
const HEIGHT = 900;
const NOW = new Date('2026-10-21T15:00:00Z');

/** Trucks in board order; `null` is a truck with nobody on it. */
const BOARD: [number, string | null][] = [
  [401, 'Ada Okonkwo-Lindqvist'],
  [404, 'Bram Tessaro'],
  [410, null],
  [412, 'Cleo Varga'],
  [415, 'Dov Abernathy-Kim'],
  [418, null],
  [420, 'Elif Marchetti'],
  [422, 'Fenn Oduya'],
  [425, 'Gus Halvorsen'],
  [427, 'Hana Petrosyan'],
  [430, null],
  [433, 'Ivo Brandt'],
  [436, 'Juno Castellanos Reyes'],
  [438, 'Kai Thorvaldsen'],
];
/** On no truck: the "Drivers without a truck" panel, and first in the picker. */
const FREE = 'Lior Mbeki-Saarinen';
/** Hand-entered drivers, so the No ELD tag is in the picture. */
const NO_ELD = new Set(['Bram Tessaro', 'Elif Marchetti', 'Hana Petrosyan', FREE]);
/**
 * 3ao: two DIFFERENT drivers with one (invented) number, so every picture has
 * the shared-phone warning on 425 and 436 and its panel (§12.138). Juno is
 * given Gus's number.
 */
const SHARES_PHONE_WITH: Record<string, string> = { 'Juno Castellanos Reyes': 'Gus Halvorsen' };

async function seedBoard(): Promise<void> {
  const sql = connect();
  try {
    await truncateAll(sql);
    await seedUser(sql, process.env.E2E_USER_ID!, process.env.E2E_EMAIL!);
    const names = [...BOARD.map(([, name]) => name).filter((n): n is string => n !== null), FREE];
    const driverIds = new Map<string, string>();
    const phones = new Map<string, string | null>();
    for (const [i, name] of names.entries()) {
      const app = NO_ELD.has(name);
      const sharer = SHARES_PHONE_WITH[name];
      // Every third driver has no phone, so "No phone" and Add are in the picture.
      const phone =
        sharer !== undefined ? phones.get(sharer)! : i % 3 === 2 ? null : `70855501${String(i).padStart(2, '0')}`;
      phones.set(name, phone);
      const [d] = await sql<{ id: string }[]>`
        insert into drivers (name, source, samsara_driver_id, phone)
        values (${name}, ${app ? 'app' : 'samsara'}, ${app ? null : `sd-a${i}`}, ${phone})
        returning id`;
      driverIds.set(name, d!.id);
    }
    for (const [n, name] of BOARD) {
      const [t] = await sql<{ id: string }[]>`
        insert into trucks (samsara_vehicle_id, samsara_name, truck_number, active)
        values (${`sv-a${n}`}, ${`Truck #${n}`}, ${n}, true) returning id`;
      if (name !== null) {
        await sql`insert into assignments (truck_id, driver_id, started_at)
                  values (${t!.id}, ${driverIds.get(name)!}, ${NOW})`;
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function open(page: Page, width: number) {
  await seedBoard();
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto('/assignments');
  await page.getByRole('combobox', { name: 'Driver for truck 401' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, HEIGHT - 2);
}

for (const width of WIDTHS) {
  test(`assignments at ${width}px matches its baseline`, async ({ page }) => {
    await open(page, width);
    await expect(page).toHaveScreenshot(`assignments-${width}.png`, { stylePath: 'e2e/screenshot.css' });
  });
}

/**
 * 3am: the states the first seven do not show, at 1440, nothing saved.
 *
 *   - 410, empty, takes the free driver: a "was —" row (§12.130);
 *   - 404 takes 401's driver: a "was" row with its old driver struck and the
 *     No ELD tag not (§12.133), and a double-booking, so 401 and 404 are on
 *     the conflicted ground and the footer names both, in primary ink.
 *
 * Focus is taken off the last picker before the shot, so no field shows its
 * focus box.
 */
test('changed rows and a double-booking at 1440px match their baseline', async ({ page }) => {
  await open(page, 1440);
  const pick = async (truck: number, driver: string) => {
    await page.getByRole('combobox', { name: `Driver for truck ${truck}` }).click();
    await page.getByRole('option', { name: new RegExp(`^${driver}`) }).click();
  };
  await pick(410, FREE);
  await pick(404, 'Ada Okonkwo-Lindqvist');
  await expect(page.getByText('2 rows changed · a driver is on trucks 401 and 404')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(2, HEIGHT - 2);
  await expect(page).toHaveScreenshot('assignments-changed-1440.png', {
    stylePath: 'e2e/screenshot.css',
  });
});

test('the driver picker open at 1024px matches its baseline', async ({ page }) => {
  await open(page, 1024);
  // An empty truck: the list opens on "Unassigned — clear this truck", the
  // free driver first, then everyone on a truck (§12.129).
  await page.getByRole('combobox', { name: 'Driver for truck 410' }).click();
  await page.getByRole('listbox').waitFor();
  await page.mouse.move(2, HEIGHT - 2);
  await expect(page).toHaveScreenshot('assignments-picker-open-1024.png', {
    stylePath: 'e2e/screenshot.css',
  });
});
