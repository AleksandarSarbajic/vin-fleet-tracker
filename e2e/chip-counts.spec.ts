import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { connect, resetWorld } from './fixtures';

/**
 * §12.8 — with a shared list active the chip counts describe the list, and
 * every chip's number is the number of rows it shows. Without a list they are
 * fleet-wide, as before. Trucks outside the list that are late or unassigned
 * are named in the list header.
 *
 * The world mirrors the production board the change was asked for: 22 active
 * trucks and 12 inactive, "Bob's trucks" twelve of the active ones. The
 * fixture's 101 and 102 are late (appointment two hours gone) and 103 is
 * unassigned — all three outside the list.
 */

const BOBS = [113, 116, 124, 128, 133, 135, 137, 138, 139, 141, 143, 145];
/** Bob's trucks with a driver, so Drivers only has something to count. */
const DRIVEN = BOBS.slice(0, 8);
const FILLER = [150, 151, 152, 153, 154, 155, 156];
const INACTIVE = Array.from({ length: 12 }, (_, i) => 300 + i);

async function seed(): Promise<string> {
  await resetWorld({ appointmentUtc: new Date(Date.now() - 2 * 3_600_000) });
  const sql = connect();
  try {
    for (const [i, n] of [...BOBS, ...FILLER, ...INACTIVE].entries()) {
      const [t] = await sql<{ id: string }[]>`
        insert into trucks (samsara_vehicle_id, samsara_name, truck_number, active)
        values (${`sv-${n}`}, ${`Truck #${n}`}, ${n}, ${!INACTIVE.includes(n)}) returning id`;
      await sql`
        insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
        values (${t!.id}, ${41.2 + (i % 6) * 0.3}, ${-88.6 + Math.floor(i / 6) * 0.4}, null, 0,
                ${new Date(Date.now() - 60_000)}, ${'Joliet, IL'})`;
      if (DRIVEN.includes(n)) {
        const [d] = await sql<{ id: string }[]>`
          insert into drivers (name) values (${`Driver ${n}`}) returning id`;
        await sql`insert into assignments (truck_id, driver_id) values (${t!.id}, ${d!.id})`;
      }
    }
    const [list] = await sql<{ id: string }[]>`
      insert into truck_lists (name) values (${"Bob's trucks"}) returning id`;
    await sql`
      insert into truck_list_members (list_id, truck_id)
      select ${list!.id}, id from trucks where truck_number = any(${BOBS})`;
    return list!.id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const chipGroup = (page: Page) => page.getByRole('group', { name: 'Filter by status' });
const chips = (page: Page) => chipGroup(page).getByRole('button');
const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${name}.png`) });

/** The chip row as a person reads it: [name, number] in drawn order. */
async function chipRow(page: Page): Promise<[string, number][]> {
  return chipGroup(page)
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((b) => {
        const count = b.lastElementChild?.textContent ?? '';
        const name = (b.getAttribute('aria-label') ?? b.textContent ?? '')
          .replace(/\s*\d+$/, '')
          .trim();
        return [name, Number(count)] as [string, number];
      }),
    );
}

/** Each chip alone — All, then the chip — shows exactly as many rows as it says. */
async function expectEveryChipAgrees(page: Page): Promise<void> {
  const row = await chipRow(page);
  for (const [i, [name, count]] of row.entries()) {
    await chips(page).nth(0).click();
    if (i > 0) await chips(page).nth(i).click();
    await expect(page.locator('[data-row-id]'), `${name} ${count}`).toHaveCount(count);
    // The footer counts every row, rendered or not: nothing virtualised away.
    await expect(page.getByText(/^Showing /)).toContainText(`of ${count}`);
  }
  await chips(page).nth(0).click();
}

test('with "Bob\'s trucks" active the chips count the list; without it, the fleet', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const listId = await seed();

  // No list: fleet-wide, as today.
  await page.goto('/');
  await expect(page.locator('[data-row-id]')).toHaveCount(22);
  expect(await chipRow(page)).toEqual([
    ['All', 22],
    ['Late', 2],
    ['At risk', 0],
    ['On time', 0],
    ['Arrived', 0],
    ['Upcoming', 0],
    ['Data issues', 20],
    ['Inactive', 12],
    ['Drivers only', 11],
  ]);
  await expect(page.locator('[data-outside-list]')).toHaveCount(0);
  await chipGroup(page).screenshot({
    path: info.outputPath('2-chips-no-list-all-22.png'),
  });
  await expectEveryChipAgrees(page);

  // The list: every chip counts its twelve.
  await page.goto(`/?list=${listId}`);
  await expect(page.locator('[data-scope] [data-list-title]')).toHaveText("Bob's trucks");
  await expect(page.locator('[data-scope-count]')).toHaveText('12');
  expect(await chipRow(page)).toEqual([
    ['All', 12],
    ['Late', 0],
    ['At risk', 0],
    ['On time', 0],
    ['Arrived', 0],
    ['Upcoming', 0],
    ['Data issues', 12],
    ['Inactive', 0],
    ['Drivers only', 8],
  ]);
  const note = page.locator('[data-outside-list]');
  await expect(note).toHaveText('Outside this list: 2 late, 1 unassigned', {
    useInnerText: true,
  });
  await chipGroup(page).screenshot({
    path: info.outputPath('1-chips-bobs-trucks-all-12.png'),
  });
  await page.waitForTimeout(1_000);
  await shot(page, info, '3-list-with-outside-note');
  await expectEveryChipAgrees(page);

  // The keys and the URL behave as before: 6 is Data issues, over the list.
  await page.keyboard.press('6');
  await expect(page.locator('[data-row-id]')).toHaveCount(12);
  await expect(page).toHaveURL(/chips=data/);
  await expect(page).toHaveURL(new RegExp(`list=${listId}`));
  await page.keyboard.press('0');

  // The note returns to the full fleet, and the counts with it.
  await note.click();
  await expect(page.locator('[data-list-title]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/list=/);
  await expect(page.locator('[data-row-id]')).toHaveCount(22);
  expect((await chipRow(page))[0]).toEqual(['All', 22]);
});
