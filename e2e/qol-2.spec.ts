import { expect, test, type Page } from '@playwright/test';
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

const PDF = [...tinyPdf(puSoBlocks(PU_SO))];

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
