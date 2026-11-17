import { expect, test, type Page } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { PU_SO, puSoBlocks } from '../src/test/ratecon-fixtures';
import { tinyPdf } from '../src/test/tiny-pdf';
import { IDS, TRUCK_NUMBERS, connect, makeFeedStale, resetWorld } from './fixtures';

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

/* ------------------------------------------------------------------ 2 */

/** Past stops of this company, on loads of truck 102: what Street address suggests from. */
const pastStops = () =>
  db(async (sql) => {
    const places = [
      { id: '3b000000-3b00-4b00-8b00-0000000000a1', line: '1200 Mill Rd', city: 'Bolingbrook', state: 'IL', zip: '60440', hours: 30 },
      { id: '3b000000-3b00-4b00-8b00-0000000000a2', line: '45 Millbrook Ave', city: 'Albany', state: 'NY', zip: '12205', hours: 20 },
    ];
    for (const p of places) {
      await sql`insert into loads (id, truck_id, load_number, status, created_at)
                values (${p.id}, ${IDS.truckDallas}, ${null}, 'DELIVERED', now() - make_interval(hours => ${p.hours}))`;
      await sql`insert into stops (load_id, type, sequence, address_line, city, state, zip, appointment_tz, appointment_type,
                                   arrived_at, arrived_source, departed_at, departed_source)
                values (${p.id}, 'DEL', 1, ${p.line}, ${p.city}, ${p.state}, ${p.zip}, ${'America/Chicago'}, 'APPT',
                        now() - make_interval(hours => ${p.hours - 2}), 'detected', now() - make_interval(hours => ${p.hours - 3}), 'detected')`;
    }
  });

test.describe('2: address suggestions from the company\'s own past stops', () => {
  const street = (page: Page) => editModal(page).locator('[data-fill="addressLine"]');
  const options = (page: Page) => editModal(page).locator('[data-address-option]');

  test('type in Street address: the matches; arrows and Enter pick, filling the four; Esc closes only the list; one fetch per window', async ({
    page,
  }) => {
    await resetWorld();
    await freeChicago();
    await pastStops();
    const asked: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/stops/addresses') asked.push(r.method());
    });
    await page.goto('/');
    await rowOf(page).click();
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    await expect(street(page)).toBeVisible();
    await expect(street(page)).toHaveAttribute('autocomplete', 'off');
    await expect(street(page)).toHaveAttribute('role', 'combobox');

    await street(page).click();
    await page.keyboard.type('mill');
    // Each used once, so the newest first: Millbrook's load is ten hours newer.
    await expect(options(page)).toHaveText(['45 Millbrook AveAlbany, NY 12205', '1200 Mill RdBolingbrook, IL 60440']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(street(page)).toHaveValue('mill');
    await page.keyboard.press('Enter');
    await expect(street(page)).toHaveValue('45 Millbrook Ave');
    await expect(modal.locator('[data-fill="city"]')).toHaveValue('Albany');
    await expect(modal.locator('[data-fill="state"]')).toHaveValue('NY');
    await expect(modal.locator('[data-fill="zip"]')).toHaveValue('12205');
    await expect(options(page)).toHaveCount(0);

    // Esc with the list open closes it and keeps the text; the window stays and asks nothing.
    await street(page).fill('');
    await page.keyboard.type('mill');
    await expect(options(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(options(page)).toHaveCount(0);
    await expect(street(page)).toHaveValue('mill');
    await expect(modal).toBeVisible();
    await expect(page.getByRole('dialog', { name: /discard/i })).toHaveCount(0);

    // A click picks too.
    await page.keyboard.press('ArrowDown');
    await expect(options(page)).toHaveCount(2);
    await options(page).filter({ hasText: '1200 Mill Rd' }).click();
    await expect(street(page)).toHaveValue('1200 Mill Rd');
    await expect(modal.locator('[data-fill="city"]')).toHaveValue('Bolingbrook');

    expect(asked, 'fetched once as the window opened, not per key').toEqual(['GET']);
  });

  test('on a new stop whose zone is auto the zone follows a pick, and the date and time do not move', async ({ page }) => {
    await resetWorld();
    await freeChicago();
    await pastStops();
    await page.goto('/');
    await rowOf(page).click();
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    const enabled = modal.locator('input[data-fill="appointment.enabled"], [data-fill="appointment.enabled"] input').first();
    if (!(await enabled.isChecked())) await enabled.check();
    await modal.locator('[data-fill="appointment.date"]').fill('2026-12-01');
    await modal.locator('[data-fill="appointment.time"]').fill('08:30');
    await expect(modal.locator('select[data-fill="tz"]')).toHaveValue('America/Chicago');
    await street(page).click();
    await page.keyboard.type('millbrook');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(modal.locator('select[data-fill="tz"]')).toHaveValue('America/New_York');
    await expect(modal.locator('[data-fill="appointment.date"]')).toHaveValue('2026-12-01');
    await expect(modal.locator('[data-fill="appointment.time"]')).toHaveValue('08:30');
  });

  test('when the route fails, the field is plain text and says suggestions are unavailable', async ({ page }) => {
    await resetWorld();
    await freeChicago();
    await page.route('**/api/stops/addresses', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Past addresses could not be read.","reference":"ADDRESSES-500-E2E"}' }),
    );
    await page.goto('/');
    await rowOf(page).click();
    await page.keyboard.press('Enter');
    await expect(editModal(page)).toContainText('Suggestions from past stops are unavailable. Type the address.');
    await street(page).click();
    await page.keyboard.type('1 Typed Lane');
    await expect(street(page)).toHaveValue('1 Typed Lane');
    await expect(options(page)).toHaveCount(0);
  });

  test('the route refuses a viewer (403), and the window does not ask for one', async ({ page }) => {
    await resetWorld();
    await db((sql) => sql`update profiles set role = 'viewer' where id = ${process.env['E2E_USER_ID']!}`);
    try {
      const asked: string[] = [];
      page.on('request', (r) => {
        if (new URL(r.url()).pathname === '/api/stops/addresses') asked.push(r.method());
      });
      await page.goto('/');
      expect((await page.request.get('/api/stops/addresses')).status()).toBe(403);
      await rowOf(page).click();
      await page.keyboard.press('Enter');
      await expect(editModal(page)).toBeVisible();
      await editModal(page).getByRole('tabpanel').waitFor();
      expect(asked).toEqual([]);
    } finally {
      await db((sql) => sql`update profiles set role = 'dispatcher' where id = ${process.env['E2E_USER_ID']!}`);
    }
  });
});

/* ------------------------------------------------------------------ 5 */

const PLAIN = 'Fleet Tracker — Vin Logistics';
/** Truck 101's stop two hours gone, so it is late. */
const TWO_HOURS_AGO = () => new Date(Date.now() - 2 * 3_600_000);
/** The Late chip's number, as a person reads it. */
const lateChip = (page: Page) =>
  page
    .getByRole('group', { name: 'Filter by status' })
    .getByRole('button')
    .evaluateAll((buttons) => {
      const late = buttons.find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().startsWith('Late'));
      return Number(late?.lastElementChild?.textContent ?? 'NaN');
    });

/**
 * The page as a hidden tab sees itself, emulated: Playwright keeps every page it drives visible
 * (its focus emulation), so the tab says hidden by its own two properties and the event. The
 * browser's own throttling of a hidden tab is not in this: HANDOFF 3bx measured a really hidden
 * tab apart, over CDP with nothing attached.
 */
const hideable = (page: Page) =>
  page.addInitScript(() => {
    let state: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
    (window as unknown as { __setVisibility: (s: DocumentVisibilityState) => void }).__setVisibility = (next) => {
      state = next;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility(s), state);

test.describe('5: the tab title', () => {
  test("says how many are late, the Late chip's own count; a list in scope narrows it; History says the plain title", async ({ page }) => {
    await resetWorld({ appointmentUtc: TWO_HOURS_AGO() });
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();
    const late = await lateChip(page);
    expect(late, 'the fixture has late trucks').toBeGreaterThan(0);
    await expect(page).toHaveTitle(`${late} late · Fleet Tracker`);

    // A list of truck 103 alone, which is not late: the chip says 0, the title is plain.
    const listId = await db(async (sql) => {
      const [list] = await sql<{ id: string }[]>`insert into truck_lists (name) values (${'Just 103'}) returning id`;
      await sql`insert into truck_list_members (list_id, truck_id) values (${list!.id}, ${IDS.truckAtZipStop})`;
      return list!.id;
    });
    await page.goto(`/?list=${listId}`);
    await expect(rowOf(page, IDS.truckAtZipStop)).toBeVisible();
    expect(await lateChip(page)).toBe(0);
    await expect(page).toHaveTitle(PLAIN);

    await page.goto('/');
    await expect(page).toHaveTitle(`${late} late · Fleet Tracker`);
    // The board's way to History, the keys: the board's title must not stay behind.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.waitForURL('**/history**');
    await expect(page).toHaveTitle(PLAIN);
  });

  test('on a stale feed it claims nothing and says the feed is down, while the chip still counts late', async ({ page }) => {
    await resetWorld({ appointmentUtc: TWO_HOURS_AGO() });
    await makeFeedStale();
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();
    expect(await lateChip(page)).toBeGreaterThan(0);
    await expect(page).toHaveTitle('Feed down · Fleet Tracker');
  });

  test("when the console cannot reach its server: Not updating, from the header's own state", async ({ page }) => {
    await resetWorld();
    await page.clock.install();
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();
    await page.route('**/api/fleet', (route) => route.abort());
    await page.clock.fastForward(70_000);
    await page.locator('[data-console-header] [data-not-updating]').waitFor();
    await expect(page).toHaveTitle('Not updating · Fleet Tracker');
  });

  test('the login page has the plain title', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await expect(page).toHaveTitle(PLAIN);
    } finally {
      await context.close();
    }
  });

  test('a hidden tab polls about once a minute; coming back polls once, not twice', async ({ page }) => {
    test.setTimeout(150_000);
    await resetWorld();
    await hideable(page);
    const polls: number[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/fleet') polls.push(Date.now());
    });
    await page.goto('/');
    await expect(rowOf(page)).toBeVisible();
    await setVisibility(page, 'hidden');
    const hiddenAt = Date.now();
    polls.length = 0;
    await page.waitForTimeout(70_000);
    // Visible, 70s is three or four polls; hidden, one, about a minute in.
    expect(polls.length, `polls while hidden: ${polls.map((t) => t - hiddenAt).join(', ')} ms`).toBe(1);
    expect(polls[0]! - hiddenAt).toBeGreaterThan(55_000);
    polls.length = 0;
    await setVisibility(page, 'visible');
    await page.waitForTimeout(3_000);
    expect(polls, 'back: one request, not two').toHaveLength(1);
  });
});
