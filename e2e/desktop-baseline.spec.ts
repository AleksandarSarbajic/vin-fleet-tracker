import { expect, test, type Page } from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';

/**
 * §12.96, stage 0 — the desktop console, pixel for pixel, before the phone
 * view is built. Every later stage must reproduce these screenshots exactly
 * (no colour tolerance, no pixel allowance — see playwright.config.ts).
 *
 * What keeps them reproducible:
 *   - a fixed seed: appointments on Tue 2030-06-04, far enough out that the
 *     status ("Upcoming", "Tue 6/4") cannot move with the date;
 *   - the browser clock frozen at FROZEN, so everything the page computes
 *     from "now" (clocks, weekday labels, the feed-down age) is constant;
 *   - the feed-down state seeded at a FIXED instant 25 minutes before FROZEN,
 *     so "since 09:35 · 25m" needs no mask;
 *   - the map's tiles hidden by e2e/screenshot.css (made invisible, not
 *     masked: a mask paints over the whole map box, popup and dialogs too);
 *   - the popup's CONTENT shot on its own, and the popup hidden in the page
 *     shot: where it sits is the map camera's call and moves a few pixels
 *     run to run, so its position is the one thing these do not hold;
 *   - hidden (`hideLiveValues`, not masked — a mask paints over a dialog in
 *     front of the value) ONLY what the server stamps with its own real time
 *     and so changes by itself: the healthy sync age, the banner's retry
 *     countdown, the GPS ages (rows, popup, map footer), and the projected ETAs (the
 *     popup's, and the rows' ETA column from 1440 up). The two clocks too, as the plan asked, though the frozen clock
 *     already holds them still.
 */

const WIDTHS = [768, 1024, 1280, 1440, 1680, 1920] as const;
const HEIGHT = 900;
const APPOINTMENT = new Date('2030-06-04T19:30:00Z');
const FROZEN = new Date('2026-10-01T15:00:00Z');
const FEED_DOWN_AT = new Date('2026-10-01T14:35:00Z');

async function seed(): Promise<string> {
  // 101 and 102 upcoming with drivers, 103 unassigned, 200–211 in a list.
  await resetWorld({ extraTrucks: 12, appointmentUtc: APPOINTMENT });
  const sql = connect();
  try {
    const [list] = await sql<{ id: string }[]>`
      insert into truck_lists (name) values (${"Bob's trucks"}) returning id`;
    await sql`insert into truck_list_members (list_id, truck_id)
              select ${list!.id}, id from trucks where truck_number between 200 and 211`;
    return list!.id;
  } finally {
    await sql.end();
  }
}

async function feedDown(): Promise<void> {
  const sql = connect();
  try {
    await sql`update feed_health set newest_position_at = ${FEED_DOWN_AT},
                                     last_success_at = ${FEED_DOWN_AT}`;
  } finally {
    await sql.end();
  }
}

/**
 * Tags what changes by itself so e2e/screenshot.css hides it for the shot:
 * the clocks, the healthy sync age, the banner's retry countdown, the rows'
 * and popup's GPS ages, and the popup's projected ETA. Leaf text only, so a
 * whole row or popup is never hidden for one number in it.
 */
async function hideLiveValues(
  page: Page,
  hide: { popup?: boolean; mapControls?: boolean } = {},
): Promise<number> {
  return page.evaluate(
    ({ popup: hidePopup, mapControls }) => {
      document
        .querySelectorAll('[data-shot-hide]')
        .forEach((el) => el.removeAttribute('data-shot-hide'));
      document
        .querySelectorAll('[data-shot-text]')
        .forEach((el) => el.removeAttribute('data-shot-text'));
      let tagged = 0;
      const tag = (el: Element) => {
        el.setAttribute('data-shot-hide', '');
        tagged += 1;
      };
      const leaves = (root: Element, pattern: RegExp) =>
        [...root.querySelectorAll('*')].filter(
          (el) => el.children.length === 0 && pattern.test((el.textContent ?? '').trim()),
        );
      /** The smallest element whose text contains the pattern. */
      const smallest = (root: Element, pattern: RegExp) =>
        [...root.querySelectorAll('*')].filter(
          (el) =>
            pattern.test(el.textContent ?? '') &&
            ![...el.children].some((c) => pattern.test(c.textContent ?? '')),
        );
      const header = document.querySelector('[data-header-row="1"]');
      if (header) {
        leaves(header, /^\d{2}:\d{2}$/).forEach(tag);
        header.querySelectorAll('[data-sync-label]').forEach((el) => {
          if (!el.closest('[data-feed-down]')) tag(el);
        });
      }
      document.querySelectorAll('[role="alert"]').forEach((alert) => {
        leaves(alert, /^auto-retry in \d+s$|^retrying now$/).forEach(tag);
      });
      document.querySelectorAll('.mapboxgl-popup').forEach((popup) => {
        leaves(popup, /^\d+\s?(s|m|h|d|min)( ago)?$/).forEach(tag);
        smallest(popup, /ETA \d{2}:\d{2}/).forEach(tag);
      });
      document.querySelectorAll('[data-row-id]').forEach((row) => {
        // The stale chip's age: its text goes, the chip's border stays.
        smallest(row, /^\s*\d+\s?(s|m|h|d)\s*$/i).forEach((el) => {
          el.setAttribute('data-shot-text', '');
          tagged += 1;
        });
      });
      // The map footer's "Positions from ELD · newest 1m ago": a GPS age.
      smallest(document.body, /newest \d+\s?(s|m|h|d)/).forEach(tag);
      // The ETA column (shown from 1440 up): projected from the server's now.
      const etaHead = [...document.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && (el.textContent ?? '').trim() === 'ETA',
      );
      if (etaHead) {
        const col = etaHead.getBoundingClientRect();
        document.querySelectorAll('[data-row-id] *').forEach((el) => {
          if (el.children.length > 0 || !(el.textContent ?? '').trim()) return;
          const box = el.getBoundingClientRect();
          const middle = box.left + box.width / 2;
          if (middle >= col.left - 40 && middle <= col.right + 40) tag(el);
        });
      }
      // The popup's PLACE is the map camera's call (its fit, and §12.89's pans
      // to keep it off the controls), and moves by a few pixels run to run. Its
      // CONTENT is shot on its own; in the page shot it is hidden.
      if (hidePopup) document.querySelectorAll('.mapboxgl-popup').forEach(tag);
      // For the popup's own shot: the map controls it may slide under would
      // otherwise be pictured inside its box, at a place that moves with it.
      if (mapControls) document.querySelectorAll('[data-map-control]').forEach(tag);
      return tagged;
    },
    { popup: hide.popup ?? false, mapControls: hide.mapControls ?? false },
  );
}

/**
 * §12.99. The map footer's "newest Ns ago" is the age of the newest position
 * at the instant the SERVER answered the fetch — real time on both sides, so
 * the frozen browser clock does not hold it. Seeded once per width, it counted
 * the seconds the run had taken. Re-stamped to 90 seconds before every load,
 * it reads "1m" however slow the run is.
 */
async function restampPositions(): Promise<void> {
  const sql = connect();
  try {
    await sql`update positions set recorded_at = now() - interval '90 seconds'`;
  } finally {
    await sql.end();
  }
}

async function open(page: Page, path = '/'): Promise<void> {
  await restampPositions();
  await page.goto(path);
  await page.locator('[data-console-header]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  // The pointer parks where it lights nothing up.
  await page.mouse.move(2, HEIGHT - 2);
}

const toggle = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) map$/ });
async function list(page: Page) {
  if (
    (await toggle(page).count()) > 0 &&
    /Hide map/.test((await toggle(page).textContent()) ?? '')
  ) {
    await toggle(page).click();
  }
  await page.locator('[data-row-id]').first().waitFor();
}
async function map(page: Page) {
  if (
    (await toggle(page).count()) > 0 &&
    /Show map/.test((await toggle(page).textContent()) ?? '')
  ) {
    await toggle(page).click();
  }
}

/** Selects 101 by its number and waits for its popup to come to rest. */
async function select101(page: Page) {
  await list(page);
  await page
    .locator(`[data-row-id="${IDS.truckChicago}"]`)
    .getByText('101', { exact: true })
    .click();
  await map(page);
  const popup = page.locator('.mapboxgl-popup');
  await popup.waitFor();
  let last = '';
  for (let i = 0; i < 20; i += 1) {
    const box = JSON.stringify(await popup.boundingBox());
    if (box === last) break;
    last = box;
    await page.waitForTimeout(250);
  }
  await page.mouse.move(2, HEIGHT - 2);
}

async function shoot(page: Page, name: string, width: number) {
  const popup = page.locator('.mapboxgl-popup-content');
  if ((await popup.count()) > 0 && name === '4-selected-with-popup') {
    await hideLiveValues(page, { mapControls: true });
    /*
     * Wholly inside the map, on whole pixels, first. Where the popup sits is
     * the camera's call and is not held (above) — and at 1920 the camera
     * sometimes leaves its top edge a few pixels past the map's, where the
     * map's frame clips it: the content shot then pictured three rows of what
     * lies outside the map instead of the popup's border (574 and 860
     * pixels, top three rows only, content identical). The nudge moves the
     * popup, never anything inside it.
     */
    await popup.evaluate((el) => {
      const host = el.closest<HTMLElement>('.mapboxgl-popup');
      const frame = el.closest('.mapboxgl-map')?.getBoundingClientRect();
      if (!host || !frame) return;
      const box = el.getBoundingClientRect();
      const into = (start: number, end: number, from: number, to: number) =>
        start < from ? from - start : end > to ? to - end : 0;
      const dx = into(box.left, box.right, frame.left, frame.right);
      const dy = into(box.top, box.bottom, frame.top, frame.bottom);
      const x = Math.round(box.left + dx) - box.left;
      const y = Math.round(box.top + dy) - box.top;
      host.style.translate = `${x}px ${y}px`;
    });
    await expect.soft(popup).toHaveScreenshot(`${name}-${width}-popup.png`, {
      stylePath: 'e2e/screenshot.css',
    });
  }
  await hideLiveValues(page, { popup: (await popup.count()) > 0 });
  await expect.soft(page).toHaveScreenshot(`${name}-${width}.png`, {
    stylePath: 'e2e/screenshot.css',
  });
}

for (const width of WIDTHS) {
  test(`desktop at ${width}px matches its baseline`, async ({ page }) => {
    test.setTimeout(120_000);
    const listId = await seed();
    await page.clock.setFixedTime(FROZEN);
    await page.setViewportSize({ width, height: HEIGHT });

    await open(page);
    await shoot(page, '1-default', width);

    await open(page, `/?list=${listId}`);
    await shoot(page, '2-list-with-outside-note', width);

    await open(page);
    await select101(page);
    await shoot(page, '4-selected-with-popup', width);

    await page.getByRole('button', { name: 'Timeline' }).click();
    await page.getByRole('dialog', { name: /Timeline for truck 101/ }).waitFor();
    await page.waitForTimeout(600);
    await page.mouse.move(2, HEIGHT - 2);
    await shoot(page, '6-timeline', width);
    await page.keyboard.press('Escape');

    await open(page);
    await select101(page);
    await page.getByRole('button', { name: 'Edit load' }).click();
    await page.locator('[role="dialog"][aria-label^="Edit stop"]').waitFor();
    await page.waitForTimeout(400);
    /*
     * Parked, like every other state. The click on Edit load left the pointer
     * wherever the popup had been — the camera's call, not held — and the
     * modal opens under it: at 768 and 1024 the stage-0 baseline caught the
     * arrival checkbox in its hover shade (32 pixels). Re-baselined on the
     * unchanged stage-1 code with only this line added (§12.96, stage 2).
     */
    await page.mouse.move(2, HEIGHT - 2);
    await shoot(page, '7-edit-stop', width);
    await page.keyboard.press('Escape');

    await open(page);
    await page.getByRole('button', { name: /^Scope/ }).click();
    await page.getByRole('menu', { name: 'Lists and views' }).waitFor();
    await page.mouse.move(2, HEIGHT - 2);
    await shoot(page, '5-scope-menu', width);
    await page.keyboard.press('Escape');

    await open(page);
    await list(page);
    await page.getByRole('checkbox', { name: 'Select truck 101' }).check();
    await page.getByRole('checkbox', { name: 'Select truck 102' }).check();
    await page.mouse.move(2, HEIGHT - 2);
    await shoot(page, '8-bulk-bar', width);

    await feedDown();
    await open(page);
    await shoot(page, '3-feed-down', width);
  });
}
