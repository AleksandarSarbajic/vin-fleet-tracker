import { expect, test, type Page } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { PU_SO, puSoBlocks } from '../src/test/ratecon-fixtures';
import { tinyPdf } from '../src/test/tiny-pdf';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * Phase 3bx (§12.164): QoL batch 2, each feature's `hand` path from the 3bf demo, in the real
 * app: the real build, the real routes, the real database. One describe per item.
 */

const rowOf = (page: Page, id: string = IDS.truckChicago) => page.locator(`[data-row-id="${id}"]`);
const editModal = (page: Page, truck: number = TRUCK_NUMBERS.chicago) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${truck}$`) });

async function db<T>(body: (sql: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Truck 101 with no next stop: its load and stops gone, so its window opens on a new load. */
const freeChicago = () =>
  db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
  });

/** The invented rate confirmation's two places, cached, so a save geocodes nothing outside. */
const PLACES = [
  { addressLine: '4001 Main St', city: 'FARGO', state: 'ND', zip: '58102', lat: 46.88, lng: -96.79 },
  { addressLine: '1200 Harbor Rd', city: 'DICKINSON', state: 'ND', zip: '58601', lat: 46.88, lng: -102.79 },
];
const cachePlaces = () =>
  db(async (sql) => {
    for (const p of PLACES) {
      await sql`
        insert into geocode_cache (normalized_address, lat, lng, precision, confidence, matched_address, provider)
        values (${normalizeAddress(p)}, ${p.lat}, ${p.lng}, 'street', ${'census:exact'},
                ${`${p.addressLine.toUpperCase()}, ${p.city}, ${p.state}, ${p.zip}`}, ${CHAIN_VERSION})
        on conflict (normalized_address) do nothing`;
    }
  });

const PDF = [...tinyPdf(puSoBlocks(PU_SO))];
const FILLED = 'Filled 2 stops from PU / SO blocks (Name, Address, Date). Nothing is saved until Save.';

/**
 * A drag the way a browser sends one from the desktop: a real `File` in a real `DataTransfer`, on
 * a real `DragEvent` (3bw's way). Synthesized, so it is not an OS drag: what it shows is that the
 * page takes the event, by `defaultPrevented`, which is what keeps the browser from opening the
 * file. `empty`: the transfer says Files and hands none over (a folder, or a browser that kept
 * the file back), its `files` emptied on the real object. `text`: a text drag.
 */
async function dragFile(
  page: Page,
  selector: string,
  type: 'dragenter' | 'dragover' | 'drop' | 'dragleave',
  carrying: 'pdf' | 'empty' | 'text' = 'pdf',
): Promise<boolean> {
  return page.evaluate(
    ({ selector, type, bytes, carrying }) => {
      const transfer = new DataTransfer();
      if (carrying === 'text') transfer.setData('text/plain', 'just text');
      else transfer.items.add(new File([new Uint8Array(bytes)], 'invented-ratecon.pdf', { type: 'application/pdf' }));
      if (carrying === 'empty') Object.defineProperty(transfer, 'files', { get: () => new DataTransfer().files });
      const target = document.querySelector(selector);
      if (!target) throw new Error(`nothing at ${selector}`);
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, type, bytes: PDF, carrying },
  );
}
const ROW = (id: string) => `[data-row-id="${id}"]`;
/** The whole drop, as a browser sends it: into the page, over the row, let go. */
async function dropOn(page: Page, selector: string, carrying: 'pdf' | 'empty' | 'text' = 'pdf') {
  await dragFile(page, selector, 'dragenter', carrying);
  const over = await dragFile(page, selector, 'dragover', carrying);
  const drop = await dragFile(page, selector, 'drop', carrying);
  return { over, drop };
}

/* ------------------------------------------------------------------ 0 */

const FORM = '[role="dialog"] [role="tabpanel"]';
const NO_FILE =
  'Nothing was read: the drag held no file this page can open (a folder, or a browser that kept the file back).';

test.describe("0: 3bw's drop, a drag that says Files and hands none over", () => {
  test('on the form and on the strip: taken, nothing read, and each says why', async ({ page }) => {
    await resetWorld();
    await freeChicago();
    await page.goto('/');
    await rowOf(page).click();
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    const strip = modal.locator('[data-ratecon-strip]');
    await expect(strip).toBeVisible();

    expect(await dragFile(page, FORM, 'drop', 'empty'), 'the window takes it').toBe(true);
    await expect(modal.locator('[data-drop-refused]')).toHaveText(NO_FILE);
    expect(await dragFile(page, '[data-ratecon-strip]', 'drop', 'empty'), 'the strip takes it').toBe(true);
    await expect(strip.locator('[data-ratecon-said="fault"]')).toHaveText(NO_FILE);
    await expect(modal.getByRole('tab')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

/* ------------------------------------------------------------------ 1 */

test.describe("1: drop a PDF on a truck's row", () => {
  test('a truck with no next stop: the row names its truck under the file; let go, its window opens with the read started and fills as the strip does', async ({
    page,
  }) => {
    await resetWorld();
    await freeChicago();
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();

    await dragFile(page, ROW(IDS.truckChicago), 'dragenter');
    expect(await dragFile(page, ROW(IDS.truckChicago), 'dragover'), 'the row takes a file over it').toBe(true);
    await expect(rowOf(page).locator('[data-drop-mark]')).toHaveText('Read this for truck 101 · Ana Petrovic');
    await expect(rowOf(page)).toHaveAttribute('data-drop-row', 'yes');

    expect(await dragFile(page, ROW(IDS.truckChicago), 'drop'), 'the row takes the file let go on it').toBe(true);
    const modal = editModal(page);
    await expect(modal).toBeVisible();
    await expect(rowOf(page)).toHaveAttribute('aria-selected', 'true');
    await expect(modal.locator('[data-ratecon-said]')).toHaveText(FILLED, { timeout: 20_000 });
    await expect(modal.getByRole('tab')).toHaveCount(2);
    await expect(page.locator('[data-drop-mark]')).toHaveCount(0);
    // Nothing saved until Save.
    expect(await db((sql) => sql`select 1 from loads where truck_id = ${IDS.truckChicago}`)).toHaveLength(0);
  });

  test('slowed to open (the CPU at a twentieth): the file still reaches the strip and fills the load', async ({ page }) => {
    await resetWorld();
    await freeChicago();
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
    try {
      const { drop } = await dropOn(page, ROW(IDS.truckChicago));
      expect(drop).toBe(true);
      await expect(editModal(page).locator('[data-ratecon-said]')).toHaveText(FILLED, { timeout: 40_000 });
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    await expect(editModal(page).getByRole('tab')).toHaveCount(2);
  });

  test("a truck with a next stop says why and takes nothing; let go there or off the rows, the board says why; the page stays; text is the browser's", async ({
    page,
  }) => {
    await resetWorld();
    await page.goto('/');
    await expect(rowOf(page, IDS.truckDallas)).toBeVisible();

    await dragFile(page, ROW(IDS.truckDallas), 'dragenter');
    expect(await dragFile(page, ROW(IDS.truckDallas), 'dragover')).toBe(true);
    await expect(rowOf(page, IDS.truckDallas).locator('[data-drop-mark]')).toHaveText(
      'Truck 102: this load has saved stops, and a read only fills a new load',
    );
    await expect(rowOf(page, IDS.truckDallas)).toHaveAttribute('data-drop-row', 'no');
    expect(await dragFile(page, ROW(IDS.truckDallas), 'drop'), 'the browser would open the file').toBe(true);
    await expect(page.locator('[data-drop-notice]')).toContainText(
      'Nothing was read for truck 102: this load has saved stops, and a read only fills a new load.',
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Off the rows: the header.
    const { over, drop } = await dropOn(page, 'header');
    expect(over).toBe(true);
    expect(drop, 'the browser would open the file').toBe(true);
    await expect(page.locator('[data-drop-notice]')).toContainText(
      "Nothing was read: a rate confirmation is read only when it is let go on a truck's row.",
    );
    expect(new URL(page.url()).pathname).toBe('/');

    // Text and links stay the browser's.
    const text = await dropOn(page, ROW(IDS.truckChicago), 'text');
    expect(text.over).toBe(false);
    expect(text.drop).toBe(false);
  });

  test('a truck still holding an old load: the fill, then Save asks the previous-load question (§12.92)', async ({ page }) => {
    await resetWorld();
    await cachePlaces();
    await db(async (sql) => {
      await sql`update loads set load_number = ${'6612193'}, status = 'AVAILABLE' where id = ${IDS.loadChicago}`;
      await sql`update stops set arrived_at = now() - interval '2 hours', arrived_source = 'detected',
                                 departed_at = now() - interval '1 hour', departed_source = 'detected'
                 where id = ${IDS.stopChicago}`;
    });
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();
    await dropOn(page, ROW(IDS.truckChicago));
    const modal = editModal(page);
    await expect(modal.locator('[data-ratecon-said]')).toHaveText(FILLED, { timeout: 20_000 });
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog', { name: 'Previous load still open' })).toBeVisible();
  });

  test('a viewer: the row says why, the drop is taken, nothing opens, and the board says why', async ({ page }) => {
    await resetWorld();
    await freeChicago();
    await db((sql) => sql`update profiles set role = 'viewer' where id = ${process.env['E2E_USER_ID']!}`);
    try {
      await page.goto('/');
      await expect(rowOf(page)).toBeVisible();
      await dragFile(page, ROW(IDS.truckChicago), 'dragenter');
      await dragFile(page, ROW(IDS.truckChicago), 'dragover');
      await expect(rowOf(page).locator('[data-drop-mark]')).toHaveText('Truck 101: a viewer cannot fill a load');
      expect(await dragFile(page, ROW(IDS.truckChicago), 'drop')).toBe(true);
      await expect(page.locator('[data-drop-notice]')).toContainText('Nothing was read for truck 101: a viewer cannot fill a load.');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await db((sql) => sql`update profiles set role = 'dispatcher' where id = ${process.env['E2E_USER_ID']!}`);
    }
  });
});
