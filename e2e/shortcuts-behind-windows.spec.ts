import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, resetWorld } from './fixtures';
import { HISTORY_NOW, seedHistory } from './history-seed';

/**
 * Phase 3bc follow-up. The board's shortcuts asked only whether the caret was in
 * a field, so with focus on a BUTTON in a window they fired behind it: `G H` left
 * the page with typed work in the edit window and no question, and "gh" is in
 * ordinary words. `isWindowOpen` (keymap.ts) is the one answer every board-level
 * listener now asks for.
 *
 * Every case puts focus on a button first and proves it: in a field the old guard
 * already held, so a case with the caret in a field would pass on the old code.
 */

test.beforeEach(async () => {
  await resetWorld();
});

const TYPED = 'Typed before the keys';
/**
 * A key that wrongly fires shows at once in everything but `G H`, whose navigation
 * is a fetch away; that is caught by its request, and this covers a router that
 * already had the page. A wait for something NOT to happen, so nothing to poll for.
 */
const SETTLE_MS = 300;

const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const checkbox = (page: Page, truck: number) =>
  page.getByRole('checkbox', { name: `Select truck ${truck}` });
const editModal = (page: Page) =>
  page.getByRole('dialog', { name: /^(Edit|New) load for truck 101$/ });

/**
 * The row, and the address that follows it. That lands a moment later by itself
 * (`router.replace`), so a reading taken before it would blame the next key.
 */
async function selectChicago(page: Page) {
  await rowOf(page, IDS.truckChicago).click();
  await expect(rowOf(page, IDS.truckChicago)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]truck=101\b/);
}

/** Everything a board shortcut could change, read from the page. */
const behind = (page: Page) =>
  page.evaluate(() => {
    const onTheBoard = (el: Element) => !el.closest('[aria-modal="true"]');
    return {
      path: location.pathname + location.search,
      pressed: [...document.querySelectorAll('[aria-pressed]')]
        .filter(onTheBoard)
        .map((el) => el.getAttribute('aria-pressed')),
      selected: [...document.querySelectorAll('[data-row-id][aria-selected="true"]')].map(
        (el) => el.getAttribute('data-row-id'),
      ),
      checked: [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        .filter(onTheBoard)
        .filter((el) => el.checked)
        .map((el) => el.getAttribute('aria-label')),
      search: document.querySelector<HTMLInputElement>('[aria-label="Search the fleet"]')
        ?.value,
      density: localStorage.getItem('ft.density'),
      pinned: localStorage.getItem('ft.pinned'),
      menus: document.querySelectorAll('[role="menu"]').length,
      windows: [...document.querySelectorAll('[aria-modal="true"]')].map((el) =>
        el.getAttribute('aria-label'),
      ),
      focus: document.activeElement?.tagName,
      focusWords: document.activeElement?.textContent?.trim().slice(0, 40),
    };
  });

/** Anything the page really asked to leave for, prefetches aside. */
function watchLeaving(page: Page): string[] {
  const left: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(page.url()).origin) return;
    if (url.pathname !== '/history' && url.pathname !== '/') return;
    if (url.pathname === new URL(page.url()).pathname) return;
    if (request.headers()['next-router-prefetch']) return;
    left.push(url.pathname);
  });
  return left;
}

/**
 * The filter keys last: behind the edit window, a chip that hid its truck closed the
 * window and took the typed work with it, so nothing after one could be tried.
 */
const BOARD_KEYS = ['d', '/', 'p', 'x', 'v', 'ArrowDown', 'ArrowUp', '1', '7', '8', '0'];

/**
 * Focus on the button, every board key in turn, and nothing behind has moved. Each key
 * answers for itself, from a fresh focus and a fresh reading, so one that fires does
 * not hide the next: a `/` that took the focus would turn the rest into typing.
 */
async function nothingMovesBehind(page: Page, button: Locator, keys = BOARD_KEYS) {
  const left = watchLeaving(page);
  await button.focus();
  await expect(button).toBeFocused();
  const start = await behind(page);
  expect(start.focus, 'focus has to be on a button: in a field the old guard held').toBe(
    'BUTTON',
  );
  expect(start.windows.length).toBeGreaterThan(0);

  for (const key of keys) {
    await button.focus();
    const before = await behind(page);
    await page.keyboard.press(key);
    expect.soft(await behind(page), `after ${key}`).toEqual(before);
  }

  await button.focus();
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.waitForTimeout(SETTLE_MS);
  expect(left, 'G H behind a window').toEqual([]);
  expect(await behind(page), 'after everything').toEqual(start);
}

/** The caret in a field of a dirty form. */
async function editWithWork(page: Page) {
  await page.goto('/');
  await selectChicago(page);
  await page.keyboard.press('Enter');
  const modal = editModal(page);
  await expect(modal).toBeVisible();
  const street = modal.getByRole('tabpanel').getByLabel('Street address');
  await street.fill(TYPED);
  const clear = modal.getByRole('button', { name: 'Clear stop' });
  await clear.scrollIntoViewIfNeeded();
  return { modal, street, clear };
}

async function checkTwo(page: Page) {
  await page.goto('/');
  await selectChicago(page);
  await checkbox(page, TRUCK_NUMBERS.chicago).check();
  await checkbox(page, TRUCK_NUMBERS.dallas).check();
}

async function openTimeline(page: Page) {
  await page.goto('/');
  await selectChicago(page);
  await page.getByRole('button', { name: 'Timeline' }).click();
  const timeline = page.getByRole('dialog', { name: /Timeline for truck 101/ });
  await expect(timeline).toBeVisible();
  return timeline;
}

test.describe('the edit window with typed work, and focus on a button', () => {
  test('G H stays on the page and the typed work is still there', async ({ page }) => {
    const { modal, street, clear } = await editWithWork(page);
    const left = watchLeaving(page);
    await clear.focus();
    await expect(clear).toBeFocused();

    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.waitForTimeout(SETTLE_MS);

    expect(left).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(modal).toBeVisible();
    await expect(street).toHaveValue(TYPED);
  });

  test('"gh" inside an ordinary word stays on the page too', async ({ page }) => {
    const { modal, street, clear } = await editWithWork(page);
    const left = watchLeaving(page);
    await clear.focus();
    await page.keyboard.type('freight');
    await page.waitForTimeout(SETTLE_MS);
    expect(left).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(modal).toBeVisible();
    await expect(street).toHaveValue(TYPED);
  });

  test('D, 1, / and the rest do nothing behind it', async ({ page }) => {
    const { street, clear } = await editWithWork(page);
    await nothingMovesBehind(page, clear);
    await expect(street).toHaveValue(TYPED);
  });

  for (const combo of ['Control+k', 'Meta+k', '?']) {
    test(`${combo} opens nothing, over it or under it`, async ({ page }) => {
      const { modal, street, clear } = await editWithWork(page);
      await nothingMovesBehind(page, clear, [combo]);
      await expect(modal).toBeVisible();
      await expect(street).toHaveValue(TYPED);
    });
  }

  /**
   * In one go, in the page: G's window is 1.5s, and a Playwright round trip between
   * the keys could outlast it and test nothing. The elapsed time says it did not.
   */
  test('G pressed before the window opened does not arm H inside it, or after it', async ({
    page,
  }) => {
    await page.goto('/');
    const left = watchLeaving(page);
    await selectChicago(page);
    await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible();
    const elapsed = await page.evaluate(async () => {
      const key = (name: string) =>
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
        );
      const windowOpen = () => document.querySelector('[aria-modal="true"]') !== null;
      const until = async (done: () => boolean) => {
        while (!done()) await new Promise((resolve) => setTimeout(resolve, 10));
      };
      const start = performance.now();
      key('g');
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Timeline')!
        .click();
      await until(windowOpen);
      key('h');
      key('Escape');
      await until(() => !windowOpen());
      key('h');
      return performance.now() - start;
    });
    expect(elapsed).toBeLessThan(1_500);
    await page.waitForTimeout(SETTLE_MS);
    expect(left).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

test.describe('every other window, with focus on a button', () => {
  const KEYS_AND_OVERLAYS = [...BOARD_KEYS, '?', 'Control+k', 'Meta+k'];

  test('a confirm: Clear stop', async ({ page }) => {
    const { modal, street, clear } = await editWithWork(page);
    await clear.click();
    const confirm = page.getByRole('dialog', { name: 'Confirm clear stop' });
    await expect(confirm).toBeVisible();
    await nothingMovesBehind(
      page,
      confirm.getByRole('button', { name: 'Back' }),
      KEYS_AND_OVERLAYS,
    );
    await expect(confirm).toBeVisible();
    await expect(modal).toBeVisible();
    await expect(street).toHaveValue(TYPED);
  });

  test('the timeline', async ({ page }) => {
    const timeline = await openTimeline(page);
    await nothingMovesBehind(
      page,
      timeline.getByRole('button', { name: 'Close' }),
      KEYS_AND_OVERLAYS,
    );
    await expect(timeline).toBeVisible();
  });

  test('the truck list editor', async ({ page }) => {
    await page.goto('/');
    await selectChicago(page);
    await page.locator('[data-scope] [aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'New list…' }).click();
    const editor = page.getByRole('dialog', { name: 'New list' });
    await expect(editor).toBeVisible();
    await editor.getByLabel('List name').fill('Night shift');
    await nothingMovesBehind(
      page,
      editor.getByRole('button', { name: 'Cancel' }),
      KEYS_AND_OVERLAYS,
    );
    await expect(editor.getByLabel('List name')).toHaveValue('Night shift');
  });

  test('the bulk modal', async ({ page }) => {
    await checkTwo(page);
    await page.getByRole('button', { name: 'Force status…' }).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await nothingMovesBehind(
      page,
      modal.getByRole('button', { name: 'Cancel' }),
      KEYS_AND_OVERLAYS,
    );
    await expect(checkbox(page, TRUCK_NUMBERS.chicago)).toBeChecked();
  });

  test('the add-to-list modal', async ({ page }) => {
    await checkTwo(page);
    await page.getByRole('button', { name: 'Add to list…' }).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await nothingMovesBehind(
      page,
      modal.getByRole('button', { name: 'Cancel' }),
      KEYS_AND_OVERLAYS,
    );
    await expect(checkbox(page, TRUCK_NUMBERS.chicago)).toBeChecked();
  });

  test('the shortcut sheet: the board keys, and not its own', async ({ page }) => {
    await page.goto('/');
    await selectChicago(page);
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await nothingMovesBehind(page, sheet.getByRole('button').first());
    await expect(sheet).toBeVisible();
  });

  test('the palette: the board keys, from a button', async ({ page }) => {
    await page.goto('/');
    await selectChicago(page);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await nothingMovesBehind(
      page,
      palette.getByRole('option').first(),
    );
    await expect(palette).toBeVisible();
  });
});

async function openSheetOverChecks(page: Page) {
  await checkTwo(page);
  // A checkbox is a field to the typing guard, and ? would stand down.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button').first().focus();
}

/** Re-renders the console, which re-registers its listeners behind the window's. */
async function aPollLands(page: Page) {
  await page.waitForResponse((r) => new URL(r.url()).pathname === '/api/fleet', {
    timeout: 25_000,
  });
  await page.waitForTimeout(SETTLE_MS);
}

async function escapeLeavesTheBoardAlone(page: Page, window_: Locator) {
  await page.keyboard.press('Escape');
  await expect(window_).toHaveCount(0);
  await expect(rowOf(page, IDS.truckChicago)).toHaveAttribute('aria-selected', 'true');
  await expect(checkbox(page, TRUCK_NUMBERS.chicago)).toBeChecked();
  await expect(checkbox(page, TRUCK_NUMBERS.dallas)).toBeChecked();
}

test.describe("a window's own keys keep working", () => {
  test('the edit window: Tab stays inside, Esc asks, and Cmd/Ctrl+Enter saves', async ({
    page,
  }) => {
    const { modal, street, clear } = await editWithWork(page);
    await clear.focus();

    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('[aria-modal="true"]')),
    ).toBe(true);

    await clear.focus();
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(discard).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(discard).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(street).toHaveValue(TYPED);

    await clear.focus();
    const posted = page.waitForRequest(
      (r) => r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/stops'),
    );
    await page.keyboard.press('Control+Enter');
    await posted;
  });

  test('Enter works the button with focus, and opens nothing behind it', async ({
    page,
  }) => {
    const timeline = await openTimeline(page);
    await timeline.getByRole('button', { name: 'Close' }).focus();
    await page.keyboard.press('Enter');
    await expect(timeline).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    await expect(editModal(page)).toHaveCount(0);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });

  test('Enter on a confirm answers it: Back goes back', async ({ page }) => {
    const { modal, street, clear } = await editWithWork(page);
    await clear.click();
    const confirm = page.getByRole('dialog', { name: 'Confirm clear stop' });
    await confirm.getByRole('button', { name: 'Back' }).focus();
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(street).toHaveValue(TYPED);
  });

  test('the palette: ⌘K closes it, the arrows and Enter run it, and ? is a letter', async ({
    page,
  }) => {
    await page.goto('/');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(palette).toHaveCount(0);

    await page.keyboard.press('Meta+k');
    await expect(palette).toBeVisible();
    const field = palette.getByRole('combobox');
    await expect(field).toBeFocused();
    await page.keyboard.type('?');
    await expect(field).toHaveValue('?');
    await field.fill(String(TRUCK_NUMBERS.chicago));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(rowOf(page, IDS.truckChicago)).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter on a palette row with focus runs that row, and opens nothing behind it', async ({
    page,
  }) => {
    await page.goto('/');
    await selectChicago(page);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(String(TRUCK_NUMBERS.dallas));
    await palette.getByRole('option').first().focus();
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(rowOf(page, IDS.truckDallas)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(SETTLE_MS);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });

  test('the sheet: ? closes it, ⌘K hands over, and the tour gives way to ⌘K (§14.5)', async ({
    page,
  }) => {
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await page.keyboard.press('?');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('?');
    await expect(sheet).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(palette).toHaveCount(0);

    await page.keyboard.press('?');
    await page.getByRole('button', { name: 'Take the tour again' }).click();
    await expect(page.getByText(/1 of 6/i)).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await expect(page.getByText(/1 of 6/i)).toHaveCount(0);
  });

  /**
   * The press that closes a window must end there. The close lands in a microtask,
   * before the next listener runs, so by then `isWindowOpen` is rightly false and only
   * stopping the event keeps the board from answering the same press. With the guard
   * alone, Esc on the sheet cleared the selection, and after a poll the checked rows
   * instead. The timeline never failed here: closing it re-renders Console, which
   * removes the board's listener mid-press. `TruckTimeline.test.tsx` holds that one.
   */
  test("Esc on the sheet closes the sheet, and not the board's selection or checks", async ({
    page,
  }) => {
    await openSheetOverChecks(page);
    await escapeLeavesTheBoardAlone(page, page.getByRole('dialog', { name: 'Keyboard shortcuts' }));
  });

  test('the same, after a poll has re-rendered the board under the sheet', async ({ page }) => {
    await openSheetOverChecks(page);
    await aPollLands(page);
    await escapeLeavesTheBoardAlone(page, page.getByRole('dialog', { name: 'Keyboard shortcuts' }));
  });

  test("Esc on the timeline closes the timeline, and not the board's selection or checks", async ({
    page,
  }) => {
    await checkTwo(page);
    await page.getByRole('button', { name: 'Timeline' }).click();
    const timeline = page.getByRole('dialog', { name: /Timeline for truck 101/ });
    await expect(timeline).toBeVisible();
    await escapeLeavesTheBoardAlone(page, timeline);
  });

  test('the same, after a poll has re-rendered the board under the timeline', async ({
    page,
  }) => {
    await checkTwo(page);
    await page.getByRole('button', { name: 'Timeline' }).click();
    const timeline = page.getByRole('dialog', { name: /Timeline for truck 101/ });
    await expect(timeline).toBeVisible();
    await aPollLands(page);
    await escapeLeavesTheBoardAlone(page, timeline);
  });
});

test.describe('what is not a window', () => {
  test('a menu is not one: the board keys work as they did with it open', async ({
    page,
  }) => {
    await page.goto('/');
    const before = await behind(page);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    await page.keyboard.press('d');
    await expect.poll(async () => (await behind(page)).density).not.toBe(before.density);
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
  });

  /**
   * The phone sheets are `md:hidden` and stay mounted: one left open and then
   * widened is still in the document, marked modal, and nobody can see it or close
   * it. Counted, it would kill every shortcut on the board with nothing on screen.
   */
  test('a phone sheet left open and widened past 768: gone from sight, so the keys work', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator(`[data-phone-card="${IDS.truckChicago}"]`).click();
    const sheet = page.locator('[data-truck-sheet]');
    await expect(sheet).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toBeHidden();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');

    const before = await behind(page);
    await page.keyboard.press('d');
    await expect.poll(async () => (await behind(page)).density).not.toBe(before.density);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.waitForURL(/\/history/);
  });

  test.describe('the fading copy', () => {
    test.use({ contextOptions: { reducedMotion: 'no-preference' } });

    test('does not count: keys work during the fade', async ({ page }) => {
      const timeline = await openTimeline(page);
      await timeline.getByRole('button', { name: 'Close' }).focus();
      const during = await page.evaluate(async () => {
        const close = document.activeElement as HTMLElement;
        const before = localStorage.getItem('ft.density');
        close.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const copy = document.querySelector('[data-dialog-fading]');
        const modalInCopy = copy?.querySelectorAll('[aria-modal]').length;
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          fading: !!document.querySelector('[data-dialog-fading]'),
          copy: !!copy,
          copyIsModal: copy?.hasAttribute('aria-modal'),
          modalInCopy,
          real: document.querySelectorAll('[aria-modal="true"]').length,
          moved: localStorage.getItem('ft.density') !== before,
        };
      });
      expect(during).toEqual({
        fading: true,
        copy: true,
        copyIsModal: false,
        modalInCopy: 0,
        real: 0,
        moved: true,
      });
    });
  });
});

/**
 * Neither page has a window of its own at desktop width. Assignments' one question
 * is the browser's `window.confirm`, and History's two windows are phone sheets,
 * where these listeners are inert (§12.96). So a stand-in plays the part: an element
 * marked exactly as `DialogFrame` marks a real one. The guards are there for the next
 * window on either page, and this holds them to it.
 */
async function standIn(page: Page) {
  const button = await page.evaluateHandle(() => {
    const window_ = document.createElement('div');
    window_.setAttribute('role', 'dialog');
    window_.setAttribute('aria-modal', 'true');
    window_.setAttribute('aria-label', 'Stand-in');
    window_.dataset.standIn = '';
    const inner = document.createElement('button');
    inner.textContent = 'Stand-in';
    window_.append(inner);
    document.body.append(window_);
    inner.focus();
    return inner;
  });
  return button;
}
const removeStandIn = (page: Page) =>
  page.evaluate(() => {
    document.querySelector('[data-stand-in]')?.remove();
    (document.activeElement as HTMLElement | null)?.blur();
  });

test.describe('Assignments', () => {
  const save = (page: Page) => page.getByRole('button', { name: /Save assignments/ });

  /** A draft the board would save: Ana to the free truck, nobody displaced. */
  async function dirty(page: Page) {
    await page.goto('/assignments');
    const zip = page.getByRole('combobox', {
      name: `Driver for truck ${TRUCK_NUMBERS.chicago}`,
    });
    await expect(zip).toBeVisible({ timeout: 20_000 });
    await page
      .getByRole('combobox', { name: `Driver for truck ${TRUCK_NUMBERS.dallas}` })
      .click();
    await page.getByRole('button', { name: /Unassigned — clear this truck/ }).click();
    await expect(save(page)).toBeEnabled();
  }

  test('behind a window: / and Cmd/Ctrl+Enter do nothing; with none, both work', async ({
    page,
  }) => {
    await dirty(page);
    const writes: string[] = [];
    page.on('request', (request) => {
      const { origin, pathname } = new URL(request.url());
      if (request.method() !== 'GET' && origin === new URL(page.url()).origin) {
        writes.push(pathname);
      }
    });

    await standIn(page);
    await page.keyboard.press('/');
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(SETTLE_MS);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Stand-in');

    await removeStandIn(page);
    await page.keyboard.press('/');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const saved = page.waitForRequest((r) => r.method() !== 'GET');
    await page.keyboard.press('Control+Enter');
    await saved;
    await expect(page.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('History', () => {
  test('behind a window: / and G B do nothing; with none, both work', async ({ page }) => {
    await seedHistory();
    await page.clock.setFixedTime(HISTORY_NOW);
    await page.goto('/history?week=2026-W40');
    const filter = page.getByRole('textbox', { name: 'Filter drivers' });
    await expect(filter).toBeVisible({ timeout: 20_000 });
    const left = watchLeaving(page);

    await standIn(page);
    await page.keyboard.press('/');
    await expect(filter).not.toBeFocused();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.waitForTimeout(SETTLE_MS);
    expect(left).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/history');

    await removeStandIn(page);
    await page.keyboard.press('/');
    await expect(filter).toBeFocused();
    await filter.blur();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.waitForURL((url) => url.pathname === '/');
  });
});

test.describe('the control: with no window open, every shortcut still works', () => {
  test('the board', async ({ page }) => {
    await page.goto('/');
    const chicago = rowOf(page, IDS.truckChicago);
    const dallas = rowOf(page, IDS.truckDallas);
    await chicago.click();
    await expect(chicago).toHaveAttribute('aria-selected', 'true');

    // ↓ ↑ move the selection.
    await page.keyboard.press('ArrowDown');
    await expect(chicago).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('ArrowUp');
    await expect(chicago).toHaveAttribute('aria-selected', 'true');

    // D the density.
    const density = (await behind(page)).density;
    await page.keyboard.press('d');
    await expect.poll(async () => (await behind(page)).density).not.toBe(density);

    // 1–7 and 8 the chips, 0 back to All.
    const lateChip = page.locator('button', { hasText: /^Late/ }).first();
    await expect(lateChip).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('1');
    await expect(lateChip).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('0');
    await expect(lateChip).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('8');
    await expect(page.locator('button', { hasText: /^Drivers/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('0');
    await expect(chicago).toBeVisible();
    await expect(dallas).toBeVisible();

    // P the pin, X the check, and Esc the checks, then the selection.
    await chicago.click();
    await page.keyboard.press('p');
    await expect
      .poll(async () => (await behind(page)).pinned)
      .toContain(IDS.truckChicago);
    await page.keyboard.press('x');
    await expect(checkbox(page, TRUCK_NUMBERS.chicago)).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(checkbox(page, TRUCK_NUMBERS.chicago)).not.toBeChecked();
    await expect(chicago).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(chicago).toHaveAttribute('aria-selected', 'false');

    // / the search.
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search the fleet' })).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // V the menu.
    await page.keyboard.press('v');
    await expect(page.getByRole('menu').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // ? the sheet, ⌘K the palette.
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await page.keyboard.press('?');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    // Enter the edit window.
    await chicago.click();
    await page.keyboard.press('Enter');
    await expect(editModal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editModal(page)).toHaveCount(0);

    // G H, then G B.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.waitForURL(/\/history/);
    await expect(page.getByRole('textbox', { name: 'Filter drivers' })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.waitForURL((url) => url.pathname === '/');
  });

  test('a key straight after a window closes reaches the board', async ({ page }) => {
    const timeline = await openTimeline(page);
    await timeline.getByRole('button', { name: 'Close' }).click();
    await expect(timeline).toHaveCount(0);
    const density = (await behind(page)).density;
    await page.keyboard.press('d');
    await expect.poll(async () => (await behind(page)).density).not.toBe(density);
  });
});
