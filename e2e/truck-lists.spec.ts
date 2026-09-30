import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { connect, resetWorld } from './fixtures';

/**
 * §12.90 — shared truck lists through the real console: the scope menu (§12.91), the
 * create dialog, the bulk bar's "Add to list…", the header, the URL, and the
 * fall-back when a list disappears.
 */

const BOBS = [113, 116, 124, 128, 133, 135, 137, 138, 139, 141, 143, 145];
const SPARE = 150;

/** The dispatcher's twelve, plus a spare, beside the fixture's 101–103. */
async function seedBobsFleet(): Promise<void> {
  await resetWorld();
  const sql = connect();
  try {
    for (const [i, n] of [...BOBS, SPARE].entries()) {
      const [t] = await sql<{ id: string }[]>`
        insert into trucks (samsara_vehicle_id, samsara_name, truck_number, active)
        values (${`sv-${n}`}, ${`Truck #${n}`}, ${n}, true) returning id`;
      await sql`
        insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
        values (${t!.id}, ${41.2 + (i % 5) * 0.3}, ${-88.6 + Math.floor(i / 5) * 0.4}, null, 0,
                ${new Date(Date.now() - 60_000)}, ${'Joliet, IL'})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The truck numbers the list is showing, in row order. */
async function shownNumbers(page: Page): Promise<number[]> {
  const texts = await page.locator('[data-row-id]').allTextContents();
  return texts
    .map((t) => Number(/^\d+/.exec(t.trim())?.[0] ?? NaN))
    .sort((a, b) => a - b);
}

/** §12.91: the scope button opens what was the Views menu. */
const views = (page: Page) => page.getByRole('button', { name: /^Scope/ });
/** The scope button names the active list and counts its trucks. */
async function expectList(page: Page, name: string, trucks: number): Promise<void> {
  await expect(page.locator('[data-scope] [data-list-title]')).toHaveText(name);
  await expect(page.locator('[data-scope-count]')).toHaveText(String(trucks));
}
const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${name}.png`) });

async function listAudit(): Promise<{ before: unknown; after: { source: string } }[]> {
  const sql = connect();
  try {
    return await sql`select before, after from audit_log where entity = 'truck_list' order by created_at`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('create "Bob\'s trucks", reload, add one, remove one, delete it', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await seedBobsFleet();
  await page.goto('/');
  await expect(page.locator('[data-row-id]')).toHaveCount(3 + BOBS.length + 1);

  // Create: the twelve pasted, plus one number not in the fleet and junk.
  await views(page).click();
  await page.getByRole('menuitem', { name: 'New list…' }).click();
  const editor = page.getByRole('dialog', { name: 'New list' });
  await editor.getByLabel('List name').fill("Bob's trucks");
  await editor
    .getByLabel('Truck numbers to add')
    .fill('113, 116, 124, 128, 133, 135. 137 138, 139, 141, 143, 145, 999, abc, 113');
  await expect(editor.locator('[data-list-count]')).toHaveText('12 trucks');
  await expect(editor.locator('[data-list-warnings]')).toContainText(
    'not in the fleet, left out: 999',
  );
  await expect(editor.locator('[data-list-warnings]')).toContainText(
    'not a truck number: abc',
  );
  await expect(editor.locator('[data-list-warnings]')).toContainText('typed twice: 113');
  await shot(page, info, '1-create-with-12-trucks');
  await editor.getByRole('button', { name: 'Create list' }).click();
  await expect(editor).toBeHidden();

  await expectList(page, "Bob's trucks", 12);
  await expect(page).toHaveURL(/[?&]list=[0-9a-f-]{36}/);
  expect(await shownNumbers(page)).toEqual(BOBS);

  // Reload: the link carries the list.
  await page.reload();
  await expectList(page, "Bob's trucks", 12);
  expect(await shownNumbers(page)).toEqual(BOBS);
  // Let the map finish its first fit — to the list's trucks — before the picture.
  await expect(page.locator('canvas.mapboxgl-canvas')).toBeVisible();
  await page.waitForTimeout(1_500);
  await shot(page, info, '2-list-active-12-rows');

  // A second list, from checked rows, through the bulk bar.
  await views(page).click();
  await page.getByRole('menuitem', { name: /^Fleet\s*All trucks/ }).click();
  await expect(page.locator('[data-row-id]')).toHaveCount(3 + BOBS.length + 1);
  for (const n of [101, 102]) {
    await page.getByRole('checkbox', { name: `Select truck ${n}` }).check();
  }
  await page.getByRole('button', { name: 'Add to list…' }).click();
  const adder = page.getByRole('dialog', { name: 'Add to list' });
  await adder.getByRole('radio', { name: 'New list…' }).check();
  await adder.getByLabel('New list name').fill('Night shift');
  await shot(page, info, '3-add-to-list');
  await adder.getByRole('button', { name: 'Add to list' }).click();
  await expect(adder).toBeHidden();
  await expect(page.locator('[data-list-notice]')).toContainText(
    '2 trucks added to “Night shift”.',
  );

  await views(page).click();
  const menu = page.getByRole('menu');
  await expect(menu.locator('[data-list-items]')).toContainText("Bob's trucks12");
  await expect(menu.locator('[data-list-items]')).toContainText('Night shift2');
  await shot(page, info, '4-views-menu-two-lists');

  // Edit: add the spare.
  await page.getByRole('menuitem', { name: /^Bob's trucks/ }).click();
  await views(page).click();
  await page.getByRole('button', { name: "Edit the list Bob's trucks" }).click();
  let edit = page.getByRole('dialog', { name: "Edit list — Bob's trucks" });
  await edit.getByLabel('Truck numbers to add').fill(String(SPARE));
  await expect(edit.locator('[data-list-count]')).toHaveText('13 trucks');
  await edit.getByRole('button', { name: 'Save list' }).click();
  await expect(edit).toBeHidden();
  await expectList(page, "Bob's trucks", 13);
  expect(await shownNumbers(page)).toEqual([...BOBS, SPARE]);

  // Edit: remove 113.
  await views(page).click();
  await page.getByRole('button', { name: "Edit the list Bob's trucks" }).click();
  edit = page.getByRole('dialog', { name: "Edit list — Bob's trucks" });
  await edit.getByRole('button', { name: 'Remove truck 113' }).click();
  await expect(edit.locator('[data-list-count]')).toHaveText('12 trucks');
  await edit.getByRole('button', { name: 'Save list' }).click();
  await expect(edit).toBeHidden();
  await expectList(page, "Bob's trucks", 12);
  expect(await shownNumbers(page)).toEqual([...BOBS.filter((n) => n !== 113), SPARE]);

  // Delete, confirmed by name.
  await views(page).click();
  await page.getByRole('button', { name: "Edit the list Bob's trucks" }).click();
  edit = page.getByRole('dialog', { name: "Edit list — Bob's trucks" });
  await edit.getByRole('button', { name: 'Delete list…' }).click();
  await expect(edit).toContainText("Delete “Bob's trucks” for everyone?");
  await edit.getByRole('button', { name: 'Delete list', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator('[data-list-title]')).toHaveCount(0);
  await expect(page.locator('[data-row-id]')).toHaveCount(3 + BOBS.length + 1);
  // Our own delete returns to the fleet quietly — no "no longer exists".
  await expect(page.locator('[data-list-notice]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/list=/);
  await views(page).click();
  await expect(page.getByRole('menu').locator('[data-list-items]')).not.toContainText(
    "Bob's trucks",
  );

  const audit = await listAudit();
  expect(audit.map((a) => a.after.source)).toEqual([
    'truck-lists', // create Bob's
    'truck-lists', // create Night shift
    'truck-lists', // add 150
    'truck-lists', // remove 113
    'truck-lists', // delete
  ]);
});

test('a list deleted by someone else falls back to the full fleet on the next refresh', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await seedBobsFleet();
  const sql = connect();
  let listId = '';
  try {
    const [list] = await sql<{ id: string }[]>`
      insert into truck_lists (name) values (${"Bob's trucks"}) returning id`;
    listId = list!.id;
    await sql`
      insert into truck_list_members (list_id, truck_id)
      select ${listId}, id from trucks where truck_number = any(${BOBS})`;
  } finally {
    await sql.end({ timeout: 5 });
  }

  await page.goto(`/?list=${listId}`);
  await expectList(page, "Bob's trucks", 12);
  expect(await shownNumbers(page)).toEqual(BOBS);

  // Someone else deletes it.
  const other = connect();
  try {
    await other`delete from truck_lists where id = ${listId}`;
  } finally {
    await other.end({ timeout: 5 });
  }

  // Within one poll (20 s): the full fleet, and a notice — never a blank board.
  await expect(page.locator('[data-list-notice]')).toHaveText(
    /This list no longer exists — showing the full fleet\./,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-row-id]')).toHaveCount(3 + BOBS.length + 1);
  await expect(page.locator('[data-list-title]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/list=/);
  await page
    .locator('[data-list-notice]')
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await expect(page.locator('[data-list-notice]')).toHaveCount(0);
});

test('a link to a list that no longer exists opens the full fleet with a notice', async ({
  page,
}) => {
  await seedBobsFleet();
  await page.goto('/?list=00000000-0000-4000-8000-000000000000');
  await expect(page.locator('[data-list-notice]')).toHaveText(
    /This list no longer exists — showing the full fleet\./,
  );
  await expect(page.locator('[data-row-id]')).toHaveCount(3 + BOBS.length + 1);
});
