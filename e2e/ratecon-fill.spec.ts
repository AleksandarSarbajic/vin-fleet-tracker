import { expect, test, type Page } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { PU_SO, puSoBlocks } from '../src/test/ratecon-fixtures';
import { tinyPdf } from '../src/test/tiny-pdf';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.122. "Fill from rate confirmation" through the real modal, the
 * browser's own pdf.js and its bundled worker, and the real save: an
 * INVENTED rate confirmation, built as a PDF in memory, is chosen in the
 * strip; the load fills, every field says where it came from, and nothing
 * is saved until Save. No real document is used, and no screenshot is taken.
 */

const TRUCK = TRUCK_NUMBERS.chicago;
const PLACES = [
  { addressLine: '4001 Main St', city: 'FARGO', state: 'ND', zip: '58102', lat: 46.88, lng: -96.79 },
  { addressLine: '1200 Harbor Rd', city: 'DICKINSON', state: 'ND', zip: '58601', lat: 46.88, lng: -102.79 },
];

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

test('an invented rate confirmation PDF fills a new load in the browser, and saves only on Save', async ({ page }) => {
  await resetWorld();
  await db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
    for (const p of PLACES) {
      await sql`
        insert into geocode_cache (normalized_address, lat, lng, precision, confidence,
                                   matched_address, provider)
        values (${normalizeAddress(p)}, ${p.lat}, ${p.lng}, 'street', ${'census:exact'},
                ${`${p.addressLine.toUpperCase()}, ${p.city}, ${p.state}, ${p.zip}`}, ${CHAIN_VERSION})
        on conflict (normalized_address) do nothing`;
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();
  await page.keyboard.press('Enter');
  await stopForm(page).waitFor();

  const strip = editModal(page).locator('[data-ratecon-strip]');
  // Not a PDF, whatever its name says: refused by its first bytes.
  await strip.getByLabel('Rate confirmation PDF').setInputFiles({
    name: 'not-a-pdf.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('PK\u0003\u0004 an archive'),
  });
  await expect(strip.locator('[data-ratecon-said]')).toHaveText('This file is not a PDF.');

  await strip.getByLabel('Rate confirmation PDF').setInputFiles({
    name: 'invented-ratecon.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(tinyPdf(puSoBlocks(PU_SO))),
  });
  await expect(strip.locator('[data-ratecon-said]')).toHaveText(
    'Filled 2 stops from PU / SO blocks (Name, Address, Date). Nothing is saved until Save.',
    { timeout: 20_000 },
  );

  await expect(editModal(page).getByLabel('Load number')).toHaveValue('88123');
  const form = stopForm(page);
  await expect(form.getByLabel('City')).toHaveValue('FARGO');
  await expect(form.getByLabel('ZIP')).toHaveValue('58102');
  await expect(form.locator('[data-field-source]').first()).toContainText('From p.1:');
  await expect(editModal(page).getByRole('tab')).toHaveCount(2);
  await editModal(page).getByRole('tab').nth(1).click();
  await expect(form.getByLabel('City')).toHaveValue('DICKINSON');
  await expect(form.locator('[data-appointment-check]')).toContainText('filled as FCFS receiving hours');
  await expect(editModal(page)).toContainText('Unsaved changes');

  // Nothing is in the database until Save.
  expect(await db((sql) => sql`select 1 from loads where truck_id = ${IDS.truckChicago}`)).toHaveLength(0);
  await editModal(page).getByRole('button', { name: 'Save' }).click();
  await expect(editModal(page)).toBeHidden({ timeout: 20_000 });

  const saved = await db((sql) => sql<
    { load_number: string; sequence: number; type: string; city: string; zip: string; appointment_type: string; appointment_tz: string }[]
  >`
    select l.load_number, s.sequence, s.type::text, s.city, s.zip, s.appointment_type::text, s.appointment_tz
      from loads l join stops s on s.load_id = l.id
     where l.truck_id = ${IDS.truckChicago}
     order by s.sequence`);
  expect(saved).toEqual([
    { load_number: '88123', sequence: 1, type: 'PU', city: 'FARGO', zip: '58102', appointment_type: 'APPT', appointment_tz: 'America/Chicago' },
    { load_number: '88123', sequence: 2, type: 'DEL', city: 'DICKINSON', zip: '58601', appointment_type: 'FCFS', appointment_tz: 'America/Denver' },
  ]);
});
