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

type StateId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

const STATES: Record<StateId, string> = {
  A: 'default',
  B: 'shared list active, with the outside-list note',
  C: 'saved view with a 40-character name',
  D: 'feed down',
  E: 'Drivers only, with its hidden note',
  F: 'worst case: list + 40-character view + feed down + three notes + a selected truck',
};

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
  if (state === 'D' || state === 'F') await feedDown();
  if (state === 'E') url = '/?chips=drivers';

  await page.setViewportSize({ width, height: 800 });
  await page.goto(url);
  await page.locator('[data-row-id]').first().waitFor();
  if (state === 'F') await page.locator('[data-row-id]').first().click();
  // Fonts decide every width below.
  await page.evaluate(() => document.fonts.ready);
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
        if (!laid(child)) continue;
        // The chip group is measured chip by chip.
        if (child.getAttribute('role') === 'group')
          items.push(...[...child.children].filter(laid));
        else items.push(child);
      }
      const boxes = items
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .sort((a, b) => a.r.left - b.r.left);
      const name = (el: Element) =>
        (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
          .trim()
          .slice(0, 40);
      const overlaps: string[] = [];
      for (let i = 1; i < boxes.length; i += 1) {
        const [a, b] = [boxes[i - 1]!, boxes[i]!];
        if (b.r.left < a.r.right - 0.5) overlaps.push(`${name(a.el)} ⟂ ${name(b.el)}`);
      }
      for (const { el, r } of boxes) {
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5) {
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
