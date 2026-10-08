import { expect, test, type Page } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.121. An address pasted into Street, through the real modal, the real
 * clipboard and the real save: it fills the four fields, says where the
 * zone came from, undoes in one ⌘/Ctrl+Z, and saves only on Save.
 *
 * The address is invented and put in the geocode cache first, so the save
 * reaches no network.
 */

const TRUCK = TRUCK_NUMBERS.chicago;
const PLACE = { addressLine: '1900 N 25th Ave', city: 'Melrose Park', state: 'IL', zip: '60160' };
const CLIP = `E2E Cold Storage\n${PLACE.addressLine}\n${PLACE.city}, ${PLACE.state} ${PLACE.zip}-0001\n`;

const editModal = (page: Page) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${TRUCK}$`) });
const stopForm = (page: Page) => editModal(page).getByRole('tabpanel');

async function db<T>(body: (sql: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('an address pasted into Street fills the stop, undoes in one step, and saves on Save', async ({
  page,
  context,
}) => {
  await resetWorld();
  await db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
    await sql`
      insert into geocode_cache (normalized_address, lat, lng, precision, confidence,
                                 matched_address, provider)
      values (${normalizeAddress(PLACE)}, 41.9006, -87.8567, 'street', ${'census:exact'},
              ${'1900 N 25TH AVE, MELROSE PARK, IL, 60160'}, ${CHAIN_VERSION})
      on conflict (normalized_address) do nothing`;
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();
  await page.keyboard.press('Enter');
  await stopForm(page).waitFor();
  const form = stopForm(page);
  await form.getByRole('button', { name: 'Pick up' }).click();
  await form.getByLabel('This stop has an appointment').check();

  const paste = async () => {
    await page.evaluate((text) => navigator.clipboard.writeText(text), CLIP);
    await form.getByLabel('Street address').focus();
    await page.keyboard.press('ControlOrMeta+v');
  };
  const fields = () =>
    Promise.all(['Street address', 'City', 'State', 'ZIP'].map((l) => form.getByLabel(l).inputValue()));

  await paste();
  expect(await fields()).toEqual([PLACE.addressLine, PLACE.city, PLACE.state, PLACE.zip]);
  await expect(form.locator('[data-zone-source]')).toHaveText('Zone: Set from the state, IL.');
  await expect(form.locator('[data-paste-left-out]')).toHaveText(
    'Left out: “E2E Cold Storage” — not part of the street.',
  );
  await expect(editModal(page)).toContainText('Unsaved changes');

  await page.keyboard.press('ControlOrMeta+z');
  expect(await fields()).toEqual(['', '', '', '']);
  await expect(form.locator('[data-paste-note]')).toHaveCount(0);

  await paste();
  expect(await fields()).toEqual([PLACE.addressLine, PLACE.city, PLACE.state, PLACE.zip]);
  // Nothing saved yet.
  expect(await db((sql) => sql`select 1 from stops where load_id = ${IDS.loadChicago}`)).toHaveLength(0);

  await form.getByLabel('Date (stop-local)').fill(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + 86_400_000)),
  );
  await form.getByLabel('Time at the stop').fill('09:00');
  await editModal(page).getByRole('button', { name: 'Save' }).click();
  await expect(editModal(page)).toBeHidden({ timeout: 20_000 });

  const saved = await db((sql) => sql<
    { address_line: string; city: string; state: string; zip: string; appointment_tz: string }[]
  >`
    select s.address_line, s.city, s.state, s.zip, s.appointment_tz
      from stops s join loads l on l.id = s.load_id
     where l.truck_id = ${IDS.truckChicago}`);
  expect(saved).toEqual([
    {
      address_line: PLACE.addressLine,
      city: PLACE.city,
      state: PLACE.state,
      zip: PLACE.zip,
      appointment_tz: 'America/Chicago',
    },
  ]);
});
