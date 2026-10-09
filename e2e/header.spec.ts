import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { connect, resetWorld } from './fixtures';

/**
 * §12.91 — the header, option 6a: a 48px scope bar over a 36px filter row,
 * held in every state at the four widths dispatchers use.
 *
 * Measured against 33 trucks so the counts are two digits, as production's
 * are — single-digit fixture counts under-state a row by tens of pixels.
 *
 * In every state and at every width:
 *   - neither row scrolls sideways, and neither does the page;
 *   - nothing in a row overlaps anything else in it;
 *   - every chip is fully on screen, Late and At risk included;
 *   - each row keeps at least 80px of spare room — the number is recorded
 *     in `spare-room.json` beside each test;
 *   - the scope's name is visible, not squeezed to nothing.
 */

const WIDTHS = [1280, 1440, 1680, 1920] as const;
const SPARE_FLOOR = 80;

/** 40 characters, VIEW_NAME_MAX: the longest name a view can put in the header. */
const LONG_VIEW = 'Late on the I-80 and I-94 corridors west';

type StateId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

const STATES: Record<StateId, string> = {
  A: 'default',
  B: 'shared list active, with the outside-list note',
  C: 'saved view with a 40-character name',
  D: 'feed down',
  E: 'Drivers only, with its hidden note',
  F: 'worst case: list + 40-character view + feed down + three notes + a selected truck',
  G: 'not updating (§12.123)',
  H: 'feed down, and not updating (§12.123)',
};

/**
 * §12.123. The board stops hearing from us: every /api/fleet refused, and the
 * browser's clock moved on 70 s, past the one minute that turns the sync dot
 * into "Not updating". The polls in between fire and fail, as they would.
 */
async function stopUpdating(page: Page): Promise<void> {
  await page.route('**/api/fleet', (route) => route.abort());
  await page.clock.fastForward(70_000);
  await page.locator('[data-console-header] [data-not-updating]').waitFor();
}

async function feedDown(): Promise<void> {
  const sql = connect();
  try {
    await sql`update feed_health
              set newest_position_at = now() - interval '25 minutes',
                  last_success_at = now() - interval '25 minutes'`;
  } finally {
    await sql.end();
  }
}

/**
 * A list of twelve filler trucks. The fixture's 101 and 102 are late (their
 * appointment two hours gone) and 103 is unassigned — all three outside it,
 * so the note reads "Outside this list: 2 late, 1 unassigned". With
 * `inactiveMember`, one of the twelve is deactivated: "1 inactive hidden".
 */
async function seedList(inactiveMember: boolean): Promise<string> {
  const sql = connect();
  try {
    const [list] = await sql<{ id: string }[]>`
      insert into truck_lists (name) values (${"Bob's trucks"}) returning id`;
    await sql`
      insert into truck_list_members (list_id, truck_id)
      select ${list!.id}, id from trucks where truck_number between 200 and 211`;
    if (inactiveMember) {
      await sql`update trucks set active = false where truck_number = 211`;
      // Drivers for half the list, so Drivers only leaves rows to select.
      for (const n of [200, 201, 202, 203, 204, 205]) {
        const [d] = await sql<{ id: string }[]>`
          insert into drivers (name) values (${`Driver ${n}`}) returning id`;
        await sql`
          insert into assignments (truck_id, driver_id)
          select id, ${d!.id} from trucks where truck_number = ${n}`;
      }
    }
    return list!.id;
  } finally {
    await sql.end();
  }
}

async function withView(page: Page, chips: string[]): Promise<void> {
  await page.addInitScript(
    ({ name, chips }) => {
      try {
        localStorage.setItem('ft.tour.seen', '1');
        localStorage.setItem(
          'ft.views',
          JSON.stringify([{ id: 'v1', name, query: '', chips }]),
        );
      } catch {
        // A browser without storage simply has no views; the test then fails on the name.
      }
    },
    { name: LONG_VIEW, chips },
  );
}

/** Seeds, navigates and waits for the board: one state at one width. */
async function open(page: Page, state: StateId, width: number): Promise<void> {
  const late = state === 'B' || state === 'F';
  await resetWorld({
    extraTrucks: 30,
    ...(late ? { appointmentUtc: new Date(Date.now() - 2 * 3_600_000) } : {}),
  });
  let url = '/';
  if (state === 'B') url = `/?list=${await seedList(false)}`;
  if (state === 'F') url = `/?list=${await seedList(true)}&chips=drivers`;
  if (state === 'C') await withView(page, []);
  if (state === 'F') await withView(page, ['drivers']);
  if (state === 'D' || state === 'F' || state === 'H') await feedDown();
  if (state === 'E') url = '/?chips=drivers';
  if (state === 'G' || state === 'H') await page.clock.install();

  await page.setViewportSize({ width, height: 800 });
  await page.goto(url);
  await page.locator('[data-row-id]').first().waitFor();
  if (state === 'F') await page.locator('[data-row-id]').first().click();
  // Fonts decide every width below.
  await page.evaluate(() => document.fonts.ready);
  if (state === 'G' || state === 'H') await stopUpdating(page);
}

interface Measured {
  pageScroll: number;
  rows: {
    scroll: number;
    spare: number;
    overlaps: string[];
    height: number;
    items: string[];
  }[];
  chipsOutside: string[];
  scopeNames: { text: string; width: number; clipped: boolean }[];
}

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const header = document.querySelector('[data-console-header]')!;
    const rows = [1, 2].map((n) => {
      const row = header.querySelector<HTMLElement>(`[data-header-row="${n}"]`)!;
      const box = row.getBoundingClientRect();
      /** What a row lays out: in flow, painted, and not screen-reader-only. */
      const laid = (el: Element) => {
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return style.position !== 'absolute' && style.display !== 'none' && r.width > 0;
      };
      const items: Element[] = [];
      for (const child of row.children) {
        // The chip group is measured chip by chip — below 1024 it lays out as
        // `contents` (§12.100), so it has no box of its own.
        if (child.getAttribute('role') === 'group') {
          items.push(...[...child.children].filter(laid));
          continue;
        }
        if (laid(child)) items.push(child);
      }
      const boxes = items
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .sort((a, b) => a.r.left - b.r.left);
      const name = (el: Element) =>
        (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
          .trim()
          .slice(0, 40);
      const overlaps: string[] = [];
      // Box against box, both axes: below 1024 row 2 runs on two lines, and
      // two chips stacked one above the other do not overlap.
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const [a, b] = [boxes[i]!.r, boxes[j]!.r];
          const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (across > 0.5 && down > 0.5) {
            overlaps.push(`${name(boxes[i]!.el)} ⟂ ${name(boxes[j]!.el)}`);
          }
        }
      }
      for (const { el, r } of boxes) {
        if (
          r.left < box.left - 0.5 ||
          r.right > box.right + 0.5 ||
          r.top < box.top - 0.5 ||
          r.bottom > box.bottom + 0.5
        ) {
          overlaps.push(`${name(el)} leaves the row`);
        }
      }
      const spare = header.querySelector<HTMLElement>(`[data-spare="${n}"]`)!;
      return {
        scroll: row.scrollWidth - row.clientWidth,
        spare: Math.round(spare.getBoundingClientRect().width),
        overlaps,
        height: Math.round(box.height),
        items: boxes.map(({ el, r }) => `${name(el)}: ${Math.round(r.width)}`),
      };
    });

    const chipsOutside = [
      ...header.querySelectorAll('[aria-label="Filter by status"] button'),
    ]
      .filter((chip) => {
        const r = chip.getBoundingClientRect();
        return r.left < 0 || r.right > window.innerWidth || r.width === 0;
      })
      .map((chip) => chip.textContent ?? '');

    const scope = header.querySelector('[data-scope]')!.getBoundingClientRect();
    const scopeNames = [
      ...header.querySelectorAll<HTMLElement>(
        '[data-scope] [data-list-title], [data-scope] [data-view-title], [data-scope] button > span:nth-child(2)',
      ),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent ?? '',
        width: Math.round(r.width),
        clipped: r.right > scope.right + 0.5 || r.width < 40,
      };
    });

    return {
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
      rows,
      chipsOutside,
      scopeNames,
    };
  });
}

async function expectHeaderHolds(
  page: Page,
  info: TestInfo,
  state: StateId,
  width: number,
): Promise<Measured> {
  const m = await measure(page);
  const report = {
    state: `${state} — ${STATES[state]}`,
    width,
    spareRow1: m.rows[0]!.spare,
    spareRow2: m.rows[1]!.spare,
  };
  // The spare room, kept beside the test whether or not it passes — and in
  // the report as an annotation.
  writeFileSync(
    info.outputPath('spare-room.json'),
    JSON.stringify({ ...report, measured: m }, null, 2),
  );
  info.annotations.push({ type: 'spare-room', description: JSON.stringify(report) });

  expect(m.pageScroll, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  expect(m.rows.map((r) => r.height)).toEqual([48, 36]);
  for (const [i, row] of m.rows.entries()) {
    expect(row.scroll, `row ${i + 1} scrolls sideways`).toBe(0);
    expect(row.overlaps, `row ${i + 1} overlaps`).toEqual([]);
    expect(row.spare, `row ${i + 1} spare room`).toBeGreaterThanOrEqual(SPARE_FLOOR);
  }
  expect(m.chipsOutside, 'chips off screen').toEqual([]);
  expect(m.scopeNames.length).toBeGreaterThan(0);
  for (const name of m.scopeNames) {
    expect(name.clipped, `scope name "${name.text}" is visible`).toBe(false);
  }

  // Late and At risk, by name, never hidden.
  const chips = page.getByRole('group', { name: 'Filter by status' });
  for (const name of [/^Late/, /^At risk/]) {
    await expect(chips.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
  }
  // The whole chip row, every label in full.
  await expect(chips.getByRole('button')).toHaveText([
    /^All\d+$/,
    /^Late\d+$/,
    /^At risk\d+$/,
    /^On time\d+$/,
    /^Arrived\d+$/,
    /^Upcoming\d+$/,
    /^Data issues\d+$/,
    /^Inactive\d+$/,
    /^Drivers only\d+$/,
  ]);
  return m;
}

const headerShot = (page: Page, info: TestInfo, name: string) =>
  page
    .locator('[data-console-header]')
    .screenshot({ path: info.outputPath(`${name}.png`) });

for (const width of WIDTHS) {
  for (const state of Object.keys(STATES) as StateId[]) {
    test(`${state} at ${width}px: ${STATES[state]}`, async ({ page }, info) => {
      await open(page, state, width);
      const scope = page.locator('[data-scope]');

      if (state === 'B' || state === 'F') {
        await expect(scope.locator('[data-list-title]')).toHaveText("Bob's trucks");
        const note = page.locator('[data-outside-list]');
        await expect(note).toHaveAttribute(
          'aria-label',
          'Outside this list: 2 late, 1 unassigned',
        );
        // Short below 1440 — and below 1680 while a truck is selected (F).
        const full = width >= (state === 'F' ? 1680 : 1440);
        await expect(note).toHaveText(
          full
            ? 'Outside this list: 2 late, 1 unassigned'
            : 'Outside: 2 late · 1 unassigned',
          { useInnerText: true },
        );
      }
      if (state === 'C' || state === 'F') {
        await expect(scope.locator('[data-view-title]')).toHaveText(LONG_VIEW);
        await expect(scope.getByRole('button', { name: /^Scope/ })).toHaveAttribute(
          'title',
          new RegExp(`View: ${LONG_VIEW}`),
        );
      }
      if (state === 'D' || state === 'F') {
        const label = page.locator('[data-feed-down] [data-sync-label]');
        await expect(label).toHaveText(/^Last sync \d{2}:\d{2} · \d+m ago$/);
        await expect(page.locator('[data-feed-announce]')).toHaveText(
          /^Feed down\. Last sync \d{2}:\d{2}\.$/,
        );
      }
      if (state === 'G') {
        await expect(page.locator('[data-sync-stopped] [data-not-updating]')).toHaveText(/^Not updating \d+[sm]$/);
        await expect(page.locator('[data-sync-retry]')).toBeVisible();
      }
      if (state === 'H') {
        await expect(page.locator('[data-feed-down] [data-sync-label] > span').first()).toHaveText(
          /^Last sync \d{2}:\d{2} · \d+m ago$/,
        );
        await expect(page.locator('[data-feed-down] [data-not-updating]')).toHaveText(/^Not updating \d+[sm]$/);
      }
      if (state === 'E' || state === 'F') {
        await expect(page.locator('[data-note="drivers"]')).toHaveAttribute(
          'aria-label',
          /^\d+ without a driver hidden$/,
        );
      }
      if (state === 'F') {
        await expect(page.locator('[data-note="inactive"]')).toHaveAttribute(
          'aria-label',
          '1 inactive hidden',
        );
        // Row 2 at 1440 and up; row 1 below (§12.91).
        await expect(page.locator('[data-selection-hint]:visible')).toHaveCount(1);
        await expect(
          page.locator(
            `[data-header-row="${width >= 1440 ? 2 : 1}"] [data-selection-hint]`,
          ),
        ).toBeVisible();
      }

      await expectHeaderHolds(page, info, state, width);
      await headerShot(page, info, `header-${state}-${width}`);
    });
  }
}

/** Below 1280 is not held to the numbers (§12.91); one picture at 1086. */
test('a picture at 1086px, default state', async ({ page }, info) => {
  await open(page, 'A', 1086);
  await headerShot(page, info, 'header-A-1086');
  await page.screenshot({ path: info.outputPath('page-A-1086.png') });
});

/**
 * §12.83's lesson, kept: the menu is SEEN, not merely open. This asks the
 * browser what is painted at points inside it.
 */
for (const width of [1280, 1440]) {
  test(`the scope menu is visible when open at ${width}px`, async ({ page }, info) => {
    await open(page, 'B', width);
    await withView(page, []);
    await page.reload();
    await page.locator('[data-row-id]').first().waitFor();
    await page.getByRole('button', { name: /^Scope/ }).click();
    const menu = page.getByRole('menu', { name: 'Lists and views' });
    await expect(menu).toBeVisible();
    const painted = await menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [
        [box.left + 12, box.top + 12],
        [box.right - 12, box.bottom - 12],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x!, y!);
        return hit !== null && el.contains(hit);
      });
    });
    expect(painted).toBe(true);
    await expect(
      menu.getByRole('menuitem', { name: /^Fleet\s*All trucks/ }),
    ).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Bob's trucks/ })).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: new RegExp(LONG_VIEW) }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`scope-menu-open-${width}.png`) });
  });
}

test('V opens the scope menu; the x clears the list and keeps the chips', async ({
  page,
}) => {
  await open(page, 'B', 1440);
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/chips=late/);
  await page.keyboard.press('v');
  await expect(page.getByRole('menu', { name: 'Lists and views' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Lists and views' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Show the full fleet' }).click();
  await expect(page.locator('[data-scope] [data-list-title]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/list=/);
  // A list's x keeps the chips.
  await expect(page).toHaveURL(/chips=late/);
});

test('the x on a view resets the chips and the search', async ({ page }) => {
  await withView(page, ['late']);
  await resetWorld({ extraTrucks: 30 });
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/?chips=late');
  await expect(page.locator('[data-scope] [data-view-title]')).toHaveText(LONG_VIEW);
  await page.getByRole('button', { name: 'Show the full fleet' }).click();
  await expect(page.locator('[data-scope] [data-view-title]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^All\s*\d+$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).not.toHaveURL(/chips=/);
});

test('every view function works through the scope menu: save, rename, delete', async ({
  page,
}) => {
  await resetWorld({ extraTrucks: 30 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ft.tour.seen', '1');
    } catch {
      // No storage: the save below fails, and says so.
    }
  });
  await page.setViewportSize({ width: 1440, height: 800 });
  // Upcoming: the fixture's appointments are tomorrow, so this board has rows.
  await page.goto('/?chips=tomorrow');
  await page.locator('[data-row-id]').first().waitFor();
  const scopeButton = page.getByRole('button', { name: /^Scope/ });
  const menu = page.getByRole('menu', { name: 'Lists and views' });

  // Save.
  await scopeButton.click();
  await menu.getByRole('menuitem', { name: 'Save current view…' }).click();
  await menu.getByLabel('Name this view').fill('Late today');
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-scope] [data-view-title]')).toHaveText('Late today');

  // Rename.
  await menu.getByRole('button', { name: 'Rename the view Late today' }).click();
  await menu.getByLabel('New name for Late today').fill('Late this morning');
  await menu.getByLabel('New name for Late today').press('Enter');
  await expect(page.locator('[data-scope] [data-view-title]')).toHaveText(
    'Late this morning',
  );

  // Find narrows the menu.
  await menu.getByLabel('Find a list or view').fill('zzz');
  await expect(menu).toContainText('No view matches “zzz”.');
  await menu.getByLabel('Find a list or view').fill('morning');
  await expect(menu.getByRole('menuitem', { name: /^Late this morning/ })).toBeVisible();

  // Delete.
  await menu.getByRole('button', { name: 'Delete the view Late this morning' }).click();
  await expect(menu).toContainText('No saved views yet');
  await expect(page.locator('[data-scope] [data-view-title]')).toHaveCount(0);
});

/**
 * §12.100 — 768 to 1023px, which §12.91 did not hold to the numbers. With a
 * truck selected, "1 selected · Esc to clear" joins row 1 and the row was
 * wider than the screen: the account button sat past the right edge, and the
 * account menu could not be reached. Worst states as dispatchers meet them:
 * a list active, Drivers only, a truck selected, with the feed healthy and
 * with it down.
 */
const NARROW = [768, 800, 900, 1023] as const;

async function openNarrow(page: Page, width: number, down: boolean): Promise<void> {
  await resetWorld({ extraTrucks: 30, appointmentUtc: new Date(Date.now() - 2 * 3_600_000) });
  const list = await seedList(true);
  if (down) await feedDown();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ft.tour.seen', '1');
    } catch {
      // No storage: the tour may open, and the test then fails on what it covers.
    }
  });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/?list=${list}&chips=drivers`);
  // Below 1086 the map and the list share a toggle, remembered per dispatcher.
  const hideMap = page.getByRole('button', { name: /^Hide map$/ });
  const rows = page.locator('[data-row-id]').first();
  if (down) await expect(page.locator('[data-console-header] [data-feed-down]')).toBeVisible({ timeout: 15_000 });
  /*
   * §12.105. One click each, never retried: the toggle is waited for itself
   * (not "the toggle or a row" — the server's split paints rows before the
   * toggle exists), and a lost click fails here instead of being clicked
   * again until it sticks.
   */
  await expect(hideMap).toBeVisible({ timeout: 15_000 });
  await hideMap.click();
  await expect(page.getByRole('button', { name: /^Show map$/ })).toBeVisible();
  await rows.click();
  await expect(rows).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => document.fonts.ready);
}

for (const width of NARROW) {
  for (const down of [false, true]) {
    test(`${width}px, ${down ? 'feed down' : 'feed healthy'}, list + Drivers only + a truck selected: the account button is on screen and nothing in the header overflows`, async ({
      page,
    }, info) => {
      await openNarrow(page, width, down);
      const header = page.locator('[data-console-header]');
      await expect(header.getByText(/^1 selected/).filter({ visible: true })).toHaveCount(1);
      if (down) {
        // The feed-down block never shortens (§12.91).
        await expect(header.locator('[data-feed-down]')).toContainText(/Last sync \d{2}:\d{2}/);
        await expect(header.locator('[data-feed-down]')).toContainText(/\d+m ago/);
      }
      await headerShot(page, info, `narrow-${width}-${down ? 'down' : 'healthy'}`);

      const m = await measure(page);
      await expect(page.getByRole('button', { name: /^Account/ })).toBeInViewport({ ratio: 1 });
      expect(m.pageScroll, 'the page scrolls sideways').toBeLessThanOrEqual(0);
      // Row 2 runs on two 36px lines below 1024: the status chips, then
      // Drivers only and the notes.
      expect(m.rows.map((r) => r.height), 'row heights').toEqual([48, 72]);
      for (const [i, row] of m.rows.entries()) {
        expect(row.scroll, `row ${i + 1} scrolls sideways`).toBe(0);
        expect(row.overlaps, `row ${i + 1} overlaps`).toEqual([]);
      }
      expect(m.chipsOutside, 'chips off screen').toEqual([]);
      for (const name of m.scopeNames) {
        expect(name.clipped, `scope name "${name.text}" is visible`).toBe(false);
      }
      // Every chip and every note whole, in order.
      const chips = page.getByRole('group', { name: 'Filter by status' }).getByRole('button');
      await expect(chips).toHaveText([
        /^All\d+$/, /^Late\d+$/, /^At risk\d+$/, /^On time\d+$/, /^Arrived\d+$/,
        /^Upcoming\d+$/, /^Data issues\d+$/, /^Inactive\d+$/, /^Drivers only\d+$/,
      ]);
      for (const chip of await chips.all()) await expect(chip).toBeInViewport({ ratio: 1 });
      const notes = header.locator('[data-note]');
      await expect(notes).toHaveCount(3);
      for (const note of await notes.all()) await expect(note).toBeInViewport({ ratio: 1 });
      if (!down) {
        // The age on the label itself (tablets have no hover), the full
        // sentence in its tooltip and its accessible name.
        const sync = header.locator('[data-sync-label]');
        // What is painted: innerText leaves out the invisible width-keeper and
        // includes nothing hidden below 1024.
        expect((await sync.locator('[data-sync-visible]').innerText()).trim()).toMatch(/^\d+[smh]$/);
        await expect(sync).toHaveAttribute('title', /^Synced \d+[smh] ago$/);
        await expect(header.getByText(/^Synced \d+[smh] ago$/)).toHaveCount(1);
      }
    });
  }
}

/**
 * §12.100 — below 1024 the search is a 32px icon that opens the field over
 * row 1. The filter keeps working while it is closed, and a dot on the icon
 * says that it is.
 */
test.describe('below 1024px the search is an icon', () => {
  const rows = (page: Page) => page.locator('[data-row-id]');

  test.beforeEach(async ({ page }) => {
    await resetWorld({ extraTrucks: 12 });
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/');
    const hideMap = page.getByRole('button', { name: /^Hide map$/ });
    // §12.105. One click, never retried (see openNarrow).
    await expect(hideMap).toBeVisible({ timeout: 15_000 });
    await hideMap.click();
    await expect(page.getByRole('button', { name: /^Show map$/ })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('opens on a tap or "/", closes on Esc to the icon, and the query survives', async ({
    page,
  }, info) => {
    const icon = page.getByRole('button', { name: /^Search/ });
    const field = page.getByLabel('Search the fleet');
    await expect(icon).toBeVisible();
    await expect(field).toBeHidden();
    await expect(icon.locator('[data-search-active]')).toHaveCount(0);
    const all = await rows(page).count();

    await icon.click();
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    // Over row 1, at full width — not squeezed into the icon's slot.
    const box = (await field.boundingBox())!;
    expect(box.width).toBeGreaterThan(500);
    await field.fill('Dallas');
    await expect(rows(page)).toHaveCount(1);
    await headerShot(page, info, 'search-open-900');

    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(icon).toBeFocused();
    // Still filtering, and it says so.
    await expect(rows(page)).toHaveCount(1);
    await expect(icon.locator('[data-search-active]')).toHaveCount(1);
    await expect(icon).toHaveAccessibleName(/Dallas/);
    await headerShot(page, info, 'search-closed-active-900');

    await page.locator('body').click({ position: { x: 5, y: 700 } });
    await page.keyboard.press('/');
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Dallas');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(rows(page)).toHaveCount(all);
    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(icon.locator('[data-search-active]')).toHaveCount(0);
  });

  test('⌘K still opens the jump box while the field is closed', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 700 } });
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog').filter({ has: page.getByLabel('Jump to a truck, view or action') })).toBeVisible();
  });

  test('at 1024 the field is in the row, as before', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByLabel('Search the fleet')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Search/ })).toBeHidden();
  });
});

/** §12.123. Retry brings the board back, and the green dot with it. */
test('Not updating clears when Retry gets an answer', async ({ page }) => {
  await open(page, 'G', 1440);
  await page.unroute('**/api/fleet');
  await page.locator('[data-sync-retry]').click();
  await expect(page.locator('[data-console-header] [data-not-updating]')).toHaveCount(0);
  await expect(page.locator('[data-console-header] [data-sync-visible]')).toBeVisible();
});
