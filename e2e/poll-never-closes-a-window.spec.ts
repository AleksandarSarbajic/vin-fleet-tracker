import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * Phase 3bc follow-up 2. A window that is open stays open until its own user closes
 * it. The edit window and the timeline read their truck from `rows`, which is after
 * the list and the chips, so a poll that moved the truck out of them unmounted the
 * window: the typed work went with it, with no question and no key pressed.
 *
 * Every change here is made in the database, as the worker or another user would make
 * it, and arrives by the real 20s poll. A test waits for the poll's ANSWER to show the
 * change, not for a poll: one already on its way when the row changed proves nothing.
 */

test.setTimeout(90_000);

const TYPED = 'TYPED-BEFORE-THE-POLL';
const TWO_HOURS_AGO = () => new Date(Date.now() - 2 * 3_600_000);
/** Long enough for a render after the answer, which is what would close the window. */
const SETTLE_MS = 300;
const NO_LONGER_THAN_A_POLL = 45_000;

type FleetAnswer = { fleet: { id: string; status: string; active: boolean }[] };

const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const lateChip = (page: Page) => page.locator('button', { hasText: /^Late/ }).first();
const editModal = (page: Page) =>
  page.getByRole('dialog', { name: /^(Edit|New) load for truck 101$/ });
const timelineWindow = (page: Page) =>
  page.getByRole('dialog', { name: /Timeline for truck 101/ });
const loadNumber = (modal: Locator) => modal.getByLabel('Load number');
const checkbox = (page: Page, truck: number) =>
  page.getByRole('checkbox', { name: `Select truck ${truck}` });

/** Resolves on the first poll whose answer says so about truck 101. */
const pollShows = (
  page: Page,
  says: (truck: FleetAnswer['fleet'][number] | undefined) => boolean,
) =>
  page.waitForResponse(
    async (response) => {
      if (new URL(response.url()).pathname !== '/api/fleet' || !response.ok()) return false;
      const { fleet } = (await response.json()) as FleetAnswer;
      return says(fleet.find((truck) => truck.id === IDS.truckChicago));
    },
    { timeout: NO_LONGER_THAN_A_POLL },
  );

async function inTheDatabase(write: (sql: ReturnType<typeof connect>) => Promise<unknown>) {
  const sql = connect();
  try {
    await write(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** What the worker writes when a truck reaches its stop. */
const theTruckArrives = () =>
  inTheDatabase(
    (sql) => sql`update stops set arrived_at = now(), arrived_source = 'detected'
                  where id = ${IDS.stopChicago}`,
  );
const theArrivalIsUndone = () =>
  inTheDatabase(
    (sql) => sql`update stops set arrived_at = null, arrived_source = null
                  where id = ${IDS.stopChicago}`,
  );

async function savedLoadNumber(): Promise<string | null> {
  const sql = connect();
  try {
    const [load] = await sql<{ load_number: string | null }[]>`
      select load_number from loads where id = ${IDS.loadChicago}`;
    return load!.load_number;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The Late chip on, truck 101 selected on it. Both seeded trucks are late. */
async function boardOnLate(page: Page) {
  await resetWorld({ appointmentUtc: TWO_HOURS_AGO() });
  await page.goto('/');
  const row = rowOf(page, IDS.truckChicago);
  await row.click();
  await page.keyboard.press('1');
  await expect(lateChip(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  return row;
}

async function typeWork(page: Page) {
  await page.keyboard.press('Enter');
  const modal = editModal(page);
  await expect(modal).toBeVisible();
  await loadNumber(modal).fill(TYPED);
  return modal;
}

async function stillOpenWithTheWork(modal: Locator) {
  await expect(modal).toBeVisible();
  await expect(loadNumber(modal)).toHaveValue(TYPED);
}

async function saveSavesIt(modal: Locator) {
  await modal.getByRole('button', { name: /^Save$/ }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  expect(await savedLoadNumber()).toBe(TYPED);
}

/** A press of Esc asks; Discard answers. */
async function discard(page: Page, modal: Locator) {
  await page.keyboard.press('Escape');
  const asks = page.getByRole('dialog', { name: 'Discard changes?' });
  await expect(asks).toBeVisible();
  await asks.getByRole('button', { name: 'Discard' }).click();
  await expect(modal).toHaveCount(0);
}

test.describe('a poll takes the truck off the board, with typed work in the edit window', () => {
  test('the Late chip: the truck arrives', async ({ page }) => {
    const row = await boardOnLate(page);
    const modal = await typeWork(page);

    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;
    await page.waitForTimeout(SETTLE_MS);

    await expect(row, 'it left the chip, or this tests nothing').toHaveCount(0);
    await stillOpenWithTheWork(modal);

    // The stop was reached after this form opened, so the save asks first (§12.119):
    // a question it could never have put while the window closed under it.
    await modal.getByRole('button', { name: /^Save$/ }).click();
    await page.getByRole('button', { name: 'Correction' }).click();
    await expect(modal).toBeHidden({ timeout: 20_000 });
    expect(await savedLoadNumber()).toBe(TYPED);
  });

  test('no chips: the truck goes inactive', async ({ page }) => {
    await resetWorld();
    await page.goto('/');
    const row = rowOf(page, IDS.truckChicago);
    await row.click();
    const modal = await typeWork(page);

    const polled = pollShows(page, (truck) => truck?.active === false);
    await inTheDatabase(
      (sql) => sql`update trucks set active = false where id = ${IDS.truckChicago}`,
    );
    await polled;
    await page.waitForTimeout(SETTLE_MS);

    await expect(row).toHaveCount(0);
    await stillOpenWithTheWork(modal);
    await saveSavesIt(modal);

    // Saving what was typed did not put the truck back in service.
    const sql = connect();
    try {
      const [truck] = await sql<{ active: boolean }[]>`
        select active from trucks where id = ${IDS.truckChicago}`;
      expect(truck!.active).toBe(false);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test.describe('a list on screen', () => {
    async function boardOnList(page: Page) {
      await resetWorld();
      let listId = '';
      await inTheDatabase(async (sql) => {
        const [list] = await sql<{ id: string }[]>`
          insert into truck_lists (name) values (${'Night shift'}) returning id`;
        listId = list!.id;
        await sql`
          insert into truck_list_members (list_id, truck_id)
          values (${listId}, ${IDS.truckChicago}), (${listId}, ${IDS.truckDallas})`;
      });
      await page.goto(`/?list=${listId}`);
      const row = rowOf(page, IDS.truckChicago);
      await row.click();
      return { row, listId, modal: await typeWork(page) };
    }

    test('someone takes the truck off the list', async ({ page }) => {
      const { row, listId, modal } = await boardOnList(page);

      const polled = page.waitForResponse(
        async (response) => {
          if (new URL(response.url()).pathname !== '/api/truck-lists') return false;
          const { lists } = (await response.json()) as {
            lists: { id: string; truckIds: string[] }[];
          };
          const list = lists.find((l) => l.id === listId);
          return list !== undefined && !list.truckIds.includes(IDS.truckChicago);
        },
        { timeout: NO_LONGER_THAN_A_POLL },
      );
      await inTheDatabase(
        (sql) => sql`delete from truck_list_members
                      where list_id = ${listId} and truck_id = ${IDS.truckChicago}`,
      );
      await polled;
      await page.waitForTimeout(SETTLE_MS);

      await expect(row).toHaveCount(0);
      await stillOpenWithTheWork(modal);
      await saveSavesIt(modal);
    });

    test('someone deletes the list: the board falls back, and the window stays', async ({
      page,
    }) => {
      const { listId, modal } = await boardOnList(page);
      await inTheDatabase((sql) => sql`delete from truck_lists where id = ${listId}`);
      await expect(page.locator('[data-list-notice]')).toHaveText(/no longer exists/, {
        timeout: NO_LONGER_THAN_A_POLL,
      });
      await expect(page).not.toHaveURL(/list=/);
      await stillOpenWithTheWork(modal);
      await saveSavesIt(modal);
    });
  });
});

test.describe('the truck is not in the answer at all', () => {
  const withoutTheTruck = (page: Page) =>
    page.route('**/api/fleet', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as FleetAnswer;
      await route.fulfill({
        response,
        json: { ...body, fleet: body.fleet.filter((t) => t.id !== IDS.truckChicago) },
      });
    });

  test('the window stays on the last row it had, and Save still saves', async ({ page }) => {
    await resetWorld();
    await page.goto('/');
    const row = rowOf(page, IDS.truckChicago);
    await row.click();
    const modal = await typeWork(page);

    await withoutTheTruck(page);
    await expect(row).toHaveCount(0, { timeout: NO_LONGER_THAN_A_POLL });
    await page.waitForTimeout(SETTLE_MS);

    await stillOpenWithTheWork(modal);
    await saveSavesIt(modal);
  });

  test('a poll that fails keeps everything as it was', async ({ page }) => {
    await resetWorld();
    await page.goto('/');
    const row = rowOf(page, IDS.truckChicago);
    await row.click();
    const modal = await typeWork(page);

    let failed = 0;
    await page.route('**/api/fleet', async (route) => {
      failed += 1;
      await route.fulfill({ status: 500, json: { error: 'No.' } });
    });
    await expect.poll(() => failed, { timeout: NO_LONGER_THAN_A_POLL }).toBeGreaterThan(0);
    await page.waitForTimeout(SETTLE_MS);

    await stillOpenWithTheWork(modal);
    await expect(row).toBeAttached();
  });

  test('deleted by hand: the window stays, Save says why it cannot, and the work is still there', async ({
    page,
  }) => {
    await resetWorld();
    await page.goto('/');
    const row = rowOf(page, IDS.truckChicago);
    await row.click();
    const modal = await typeWork(page);

    const polled = pollShows(page, (truck) => truck === undefined);
    await inTheDatabase((sql) => sql`delete from trucks where id = ${IDS.truckChicago}`);
    await polled;
    await page.waitForTimeout(SETTLE_MS);

    await stillOpenWithTheWork(modal);
    await modal.getByRole('button', { name: /^Save$/ }).click();
    await expect(modal.getByRole('alert').first()).toBeVisible({ timeout: 20_000 });
    await stillOpenWithTheWork(modal);

    await discard(page, modal);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });
});

test.describe('the timeline', () => {
  test('stays open when its truck leaves the chip, and closes when asked', async ({ page }) => {
    const row = await boardOnLate(page);
    await page.getByRole('button', { name: 'Timeline' }).click();
    const timeline = timelineWindow(page);
    await expect(timeline).toBeVisible();

    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;
    await page.waitForTimeout(SETTLE_MS);

    await expect(row).toHaveCount(0);
    await expect(timeline).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(timeline).toHaveCount(0);

    // Gone for good: the truck coming back does not bring the window with it.
    const back = pollShows(page, (truck) => truck?.status === 'LATE');
    await theArrivalIsUndone();
    await back;
    await expect(row).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    await expect(timeline).toHaveCount(0);
  });
});

test.describe('after closing a window whose truck has left the board', () => {
  /** Closed by Discard, with the truck off the board, and every error recorded. */
  async function closedWithTheTruckGone(page: Page) {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const row = await boardOnLate(page);
    const modal = await typeWork(page);
    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;
    await page.waitForTimeout(SETTLE_MS);
    await expect(row).toHaveCount(0);
    await expect(modal).toBeVisible();
    await discard(page, modal);
    return { row, errors };
  }

  test('the arrows, X and Esc work, with no error, and focus falls to the page', async ({
    page,
  }) => {
    const { errors } = await closedWithTheTruckGone(page);

    // What opened it has gone with its row, so there is nothing to give focus back to.
    // The page is the sensible place: every board key listens there.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

    const dallas = rowOf(page, IDS.truckDallas);
    await page.keyboard.press('ArrowDown');
    await expect(dallas).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('x');
    await expect(checkbox(page, TRUCK_NUMBERS.dallas)).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(checkbox(page, TRUCK_NUMBERS.dallas)).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dallas).toHaveAttribute('aria-selected', 'false');

    expect(errors).toEqual([]);
  });

  test('the window does not come back with the truck, and a key can reopen it only by intent', async ({
    page,
  }) => {
    const { row, errors } = await closedWithTheTruckGone(page);

    const back = pollShows(page, (truck) => truck?.status === 'LATE');
    await theArrivalIsUndone();
    await back;
    await expect(row).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

    // It is on the board again, still selected, so Enter opens it, on a fresh form.
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    await expect(modal).toBeVisible();
    await expect(loadNumber(modal)).toHaveValue('E2E-101');
    expect(errors).toEqual([]);
  });

  test('Enter and X do nothing to a truck the board is not showing', async ({ page }) => {
    const { row, errors } = await closedWithTheTruckGone(page);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(SETTLE_MS);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

    await page.keyboard.press('x');

    // Checked unseen, it would be back on the board with the box ticked, and a bulk
    // action would take it along.
    const back = pollShows(page, (truck) => truck?.status === 'LATE');
    await theArrivalIsUndone();
    await back;
    await expect(row).toBeVisible();
    await expect(checkbox(page, TRUCK_NUMBERS.chicago)).not.toBeChecked();
    expect(errors).toEqual([]);
  });
});

test.describe('the controls', () => {
  async function open(page: Page) {
    await resetWorld();
    await page.goto('/');
    await rowOf(page, IDS.truckChicago).click();
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    await expect(modal).toBeVisible();
    await expect(loadNumber(modal)).toHaveValue('E2E-101');
    return modal;
  }

  test('nothing typed: Cancel and Esc close at once', async ({ page }) => {
    const modal = await open(page);
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toHaveCount(0);

    await page.keyboard.press('Enter');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
  });

  test('typed: Cancel and Esc ask, Keep editing keeps it, and Discard drops it', async ({
    page,
  }) => {
    const modal = await open(page);
    await loadNumber(modal).fill(TYPED);
    const asks = page.getByRole('dialog', { name: 'Discard changes?' });

    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(asks).toBeVisible();
    await asks.getByRole('button', { name: 'Keep editing' }).click();
    await stillOpenWithTheWork(modal);

    await loadNumber(modal).focus();
    await discard(page, modal);
    expect(await savedLoadNumber()).toBe('E2E-101');
    await expect(rowOf(page, IDS.truckChicago)).toBeVisible();
  });

  test('a normal Save saves and closes, and the truck stays on the board', async ({ page }) => {
    const modal = await open(page);
    await loadNumber(modal).fill(TYPED);
    await saveSavesIt(modal);
    await expect(rowOf(page, IDS.truckChicago)).toBeVisible();
  });

  /** The same row prop, live: this is what a frozen copy at opening would break. */
  test('a truck on the board updates live in the open window, and nothing typed moves', async ({
    page,
  }) => {
    await resetWorld({ appointmentUtc: TWO_HOURS_AGO() });
    await page.goto('/');
    const row = rowOf(page, IDS.truckChicago);
    await row.click();
    const modal = await typeWork(page);
    const panel = modal.getByRole('tabpanel');
    await expect(panel.getByText('Late', { exact: true }).first()).toBeVisible();

    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;

    await expect(panel.getByText('Late', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Arrived', { exact: true }).first()).toBeVisible();
    await expect(row).toBeAttached();
    await stillOpenWithTheWork(modal);
  });

  test('so does one that has left the chip', async ({ page }) => {
    await boardOnLate(page);
    const modal = await typeWork(page);
    const panel = modal.getByRole('tabpanel');
    await expect(panel.getByText('Late', { exact: true }).first()).toBeVisible();

    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;

    await expect(panel.getByText('Late', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Arrived', { exact: true }).first()).toBeVisible();
    await stillOpenWithTheWork(modal);
  });
});

test.describe('P on a selected truck', () => {
  const pinned = (page: Page) => page.evaluate(() => localStorage.getItem('ft.pinned'));

  test('the board is not showing it: P pins nothing', async ({ page }) => {
    const row = await boardOnLate(page);
    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;
    await expect(row).toHaveCount(0);

    await page.keyboard.press('p');
    await page.waitForTimeout(SETTLE_MS);
    expect(await pinned(page)).toBeNull();

    // And it is not pinned when it comes back.
    const back = pollShows(page, (truck) => truck?.status === 'LATE');
    await theArrivalIsUndone();
    await back;
    await expect(row).toBeVisible();
    expect(await pinned(page)).toBeNull();
  });

  test('the board is showing it: P pins it and unpins it, as ever', async ({ page }) => {
    const row = await boardOnLate(page);
    await row.click();
    await page.keyboard.press('p');
    await expect.poll(() => pinned(page)).toContain(IDS.truckChicago);
    await page.keyboard.press('p');
    await expect.poll(() => pinned(page)).not.toContain(IDS.truckChicago);
  });
});

test.describe("the phone's truck sheet", () => {
  const PHONE = '3125550101';

  async function sheetOnLate(page: Page) {
    await resetWorld({ appointmentUtc: TWO_HOURS_AGO() });
    await inTheDatabase(
      (sql) => sql`update drivers set phone = ${PHONE} where id = ${IDS.driverAna}`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?chips=late');
    const card = page.locator(`[data-phone-card="${IDS.truckChicago}"]`);
    await card.click();
    const sheet = page.locator('[data-truck-sheet]');
    await expect(sheet).toBeVisible();
    return { card, sheet };
  }

  async function theTruckLeavesTheBoard(page: Page, card: Locator) {
    const polled = pollShows(page, (truck) => truck?.status === 'ARRIVED');
    await theTruckArrives();
    await polled;
    await page.waitForTimeout(SETTLE_MS);
    await expect(card).toHaveCount(0);
  }

  test('stays open and stays live when its truck leaves the chip, and does not come back', async ({
    page,
  }) => {
    const { card, sheet } = await sheetOnLate(page);
    await expect(sheet).toContainText('Late');

    await theTruckLeavesTheBoard(page, card);
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Arrived');

    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toHaveCount(0);

    const back = pollShows(page, (truck) => truck?.status === 'LATE');
    await theArrivalIsUndone();
    await back;
    await expect(card).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    await expect(sheet).toHaveCount(0);
  });

  test('stays on the last row it had when the truck is missing from the answer', async ({
    page,
  }) => {
    const { card, sheet } = await sheetOnLate(page);
    await page.route('**/api/fleet', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as FleetAnswer;
      await route.fulfill({
        response,
        json: { ...body, fleet: body.fleet.filter((t) => t.id !== IDS.truckChicago) },
      });
    });
    await expect(card).toHaveCount(0, { timeout: NO_LONGER_THAN_A_POLL });
    await page.waitForTimeout(SETTLE_MS);
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('101');
  });

  test('its buttons, for a truck that has left the board', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { card, sheet } = await sheetOnLate(page);
    await theTruckLeavesTheBoard(page, card);

    // Call driver: the number the console already holds, by the truck.
    await expect(sheet.locator('[data-call-driver]')).toHaveAttribute('href', `tel:+1${PHONE}`);

    // Timeline: opens over the sheet, and closing it gives the sheet back.
    await sheet.getByRole('button', { name: 'Timeline' }).click();
    const timeline = timelineWindow(page);
    await expect(timeline).toBeVisible();
    await timeline.getByRole('button', { name: 'Close' }).click();
    await expect(timeline).toHaveCount(0);
    await expect(sheet).toBeVisible();

    // Show on map: the sheet steps aside for the map. The map draws the board's rows,
    // so this truck is not on it; nothing fails, and nothing brings the sheet back.
    await sheet.getByRole('button', { name: 'Show on map' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('[data-phone-tab="map"]')).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(SETTLE_MS);
    await expect(sheet).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
