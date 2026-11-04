import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.148 in a real browser: the real CSS, the real timing, and the real
 * console underneath.
 *
 * The timing-sensitive steps run inside one `page.evaluate`, with the keys
 * dispatched in the page: a Playwright round trip between "closed" and "next
 * key" could outlast the 100ms fade, and then a test of "during the fade"
 * would quietly test nothing. Each of those steps first asserts that the fade
 * is there.
 */

// The one spec about motion: the suite's default is reduced (playwright.config.ts).
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test.beforeEach(async () => {
  await resetWorld();
});

const rowOf = (page: Page, truckId: string) => page.locator(`[data-row-id="${truckId}"]`);
const editModal = (page: Page, truck: number) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${truck}$`) });
const panelOf = (dialog: Locator) => dialog.locator(':scope > div').first();

async function openModal(page: Page, truckId: string, truck: number) {
  await rowOf(page, truckId).click();
  await page.keyboard.press('Enter');
  const modal = editModal(page, truck);
  await expect(modal).toBeVisible();
  return modal;
}

/** What the motion left on an element: nothing, once the opening is over. */
const rest = (el: Element) => {
  const cs = getComputedStyle(el);
  return {
    opacity: cs.opacity,
    transform: cs.transform,
    animations: el.getAnimations().length,
    delay: (el as HTMLElement).style.animationDelay,
  };
};

/** Records every motion class and fading background that ever appears. */
async function watchMotion(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __motionSeen: string[] };
    w.__motionSeen = [];
    const look = () => {
      for (const el of document.querySelectorAll(
        '.animate-dialog-in, .animate-scrim-in, [data-dialog-fading]',
      )) {
        w.__motionSeen.push(
          el.hasAttribute('data-dialog-fading')
            ? 'fading copy'
            : (el.className.match(/animate-(dialog|scrim)-in/)?.[0] ?? '?'),
        );
      }
    };
    new MutationObserver(look).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  return () =>
    page.evaluate(() =>
      [...new Set((window as unknown as { __motionSeen: string[] }).__motionSeen)].sort(),
    );
}

/**
 * The computed animation of an opening, read in the page at the instant its
 * class lands. A handle from Playwright could not do this: the reading panel
 * can give way to the editor between finding an element and asking about it,
 * and a detached element computes to nothing.
 */
async function recordOpening(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __opening: Record<string, Record<string, string>> };
    w.__opening = {};
    const read = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        name: cs.animationName,
        duration: cs.animationDuration,
        timing: cs.animationTimingFunction,
        fill: cs.animationFillMode,
      };
    };
    const look = () => {
      const panel = document.querySelector('.animate-dialog-in');
      if (panel && !w.__opening.panel) w.__opening.panel = read(panel);
      const scrim = document.querySelector('.animate-scrim-in');
      if (scrim && !w.__opening.scrim) w.__opening.scrim = read(scrim);
      const menu = document.querySelector('.animate-menu-in');
      if (menu && !w.__opening.menu) w.__opening.menu = read(menu);
    };
    new MutationObserver(look).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { __opening: Record<string, Record<string, string>> })
          .__opening,
    );
}

test('the edit modal opens with motion, from the tokens, and leaves nothing on itself', async ({
  page,
}) => {
  await page.goto('/');
  await rowOf(page, IDS.truckChicago).click();
  const opening = await recordOpening(page);
  await page.keyboard.press('Enter');

  const modal = editModal(page, TRUCK_NUMBERS.chicago);
  await expect(modal).toBeVisible();
  expect(await opening()).toEqual({
    panel: {
      name: 'dialog-in',
      duration: '0.22s',
      timing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      fill: 'backwards',
    },
    scrim: { name: 'fade-in', duration: '0.22s', timing: 'linear', fill: 'backwards' },
  });

  const panel = panelOf(modal);
  // The class comes off when the opening ends …
  await expect(panel).not.toHaveClass(/animate-/);
  await expect(modal).not.toHaveClass(/animate-/);
  // … and nothing of it is left: no transform, no opacity, no animation.
  expect(await panel.evaluate(rest)).toEqual({
    opacity: '1',
    transform: 'none',
    animations: 0,
    delay: '',
  });
  expect(await modal.evaluate(rest)).toEqual({
    opacity: '1',
    transform: 'none',
    animations: 0,
    delay: '',
  });
});

test('closing never waits: the dialog, the focus, the next click and the next key, at once', async ({
  page,
}) => {
  await page.goto('/');
  const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await expect(panelOf(modal)).not.toHaveClass(/animate-/);

  const result = await page.evaluate(
    async ({ a, b }) => {
      const rowB = document.querySelector<HTMLElement>(`[data-row-id="${b}"]`)!;
      const where = () =>
        document.activeElement?.closest('[data-row-id]')?.getAttribute('data-row-id') ??
        document.activeElement?.tagName;
      // Where focus will come back to: what had it before the modal opened.
      const before = a;
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      // One task: React's commit and the fade's microtask, nothing longer.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const box = rowB.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return {
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        fading: document.querySelectorAll('[data-dialog-fading]').length,
        focusBack: where() === before,
        clickReachesRowB: hit !== null && rowB.contains(hit),
        center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      };
    },
    { a: IDS.truckChicago, b: IDS.truckDallas },
  );
  expect(result).toMatchObject({
    dialogs: 0,
    fading: 1,
    focusBack: true,
    clickReachesRowB: true,
  });

  // And for real: a click on another row and a key, straight away.
  await page.mouse.click(result.center.x, result.center.y);
  await expect(rowOf(page, IDS.truckDallas)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(editModal(page, TRUCK_NUMBERS.dallas)).toBeVisible();
  await expect(page.locator('[data-dialog-fading]')).toHaveCount(0);
});

test('reopening during the fade: the old copy goes at once, and the new modal opens normally', async ({
  page,
}) => {
  await page.goto('/');
  await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);

  const result = await page.evaluate(async (truck) => {
    const key = (k: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    key('Escape');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fadingBefore = document.querySelectorAll('[data-dialog-fading]').length;
    // Focus is back on the row: Enter opens it again, mid-fade.
    key('Enter');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const scrim = document.querySelector(
      `[role="dialog"][aria-label$="load for truck ${truck}"]`,
    );
    const panel = scrim?.firstElementChild as HTMLElement | null;
    return {
      fadingBefore,
      fadingAfter: document.querySelectorAll('[data-dialog-fading]').length,
      scrims: document.querySelectorAll('.bg-scrim').length,
      opening: panel?.classList.contains('animate-dialog-in') ?? false,
      fromItsStart: panel?.style.animationDelay ?? 'no panel',
    };
  }, TRUCK_NUMBERS.chicago);

  expect(result).toEqual({
    fadingBefore: 1,
    fadingAfter: 0,
    scrims: 1,
    opening: true,
    fromItsStart: '',
  });
});

test('a confirm over the modal opens with motion, and closing it gives the modal back at once', async ({
  page,
}) => {
  await page.goto('/');
  const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  const seen = await watchMotion(page);
  const clear = modal.getByRole('button', { name: 'Clear stop' });
  await clear.scrollIntoViewIfNeeded();
  await clear.click();
  const confirm = page.getByRole('dialog', { name: 'Confirm clear stop' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Close load' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(modal).toBeVisible();
  // The modal under it was not replayed.
  await expect(panelOf(modal)).not.toHaveClass(/animate-/);
  await expect(page.locator('[data-dialog-fading]')).toHaveCount(0);
  expect(await seen()).toEqual(['animate-dialog-in', 'animate-scrim-in', 'fading copy']);
});

/**
 * The read arrives once, then it is in hand: the second opening is the editor
 * from its first frame, with no reading panel to give way.
 */
async function openAndClose(page: Page) {
  const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await modal.getByRole('tabpanel').waitFor();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('[data-dialog-fading]')).toHaveCount(0);
}

/**
 * Opens the editor and holds it 20% of the way through its opening, so what
 * happens "during the opening" cannot depend on how fast a robot is. In the
 * page, in one task, for the same reason.
 */
const openAndHold = (page: Page) =>
  page.evaluate(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const running = document
      .getAnimations()
      .filter((a) =>
        ((a.effect as KeyframeEffect).target as Element | null)?.closest(
          '[role="dialog"]',
        ),
      );
    for (const a of running) {
      a.pause();
      a.currentTime = 44;
    }
    const pickUp = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent?.trim() === 'Pick up',
    )!;
    const box = pickUp.getBoundingClientRect();
    return {
      held: running.length,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
  });

const afterTheClick = (page: Page) =>
  page.evaluate(() => ({
    top: document.querySelector<HTMLElement>('[data-edit-scroll]')!.scrollTop,
    pressed: [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent?.trim() === 'Pick up')!
      .getAttribute('aria-pressed'),
    stillOpening: document.querySelector('.animate-dialog-in') !== null,
  }));

test('a real mouse click during the 220ms opening lands, and scrolls nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openAndClose(page);
  const at = await openAndHold(page);
  expect(at.held).toBeGreaterThanOrEqual(2);
  await page.mouse.click(at.x, at.y);
  expect(await afterTheClick(page)).toEqual({
    top: 0,
    pressed: 'true',
    stillOpening: true,
  });
});

test('the same click at full speed, with nothing held, lands too', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openAndClose(page);
  await page.keyboard.press('Enter');
  const box = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')]
      .find((x) => x.textContent?.trim() === 'Pick up')!
      .getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  const after = await afterTheClick(page);
  expect(after.top).toBe(0);
  expect(after.pressed).toBe('true');
});

test('closed mid-opening, the copy fades from where it stood', async ({ page }) => {
  await page.goto('/');
  await openAndClose(page);
  await openAndHold(page);
  const result = await page.evaluate(async () => {
    const scrim = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const panel = scrim.firstElementChild as HTMLElement;
    const stood = {
      scrim: getComputedStyle(scrim).opacity,
      panel: getComputedStyle(panel).opacity,
      transform: getComputedStyle(panel).transform,
    };
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copy = document.querySelector<HTMLElement>('[data-dialog-fading]')!;
    const inner = copy.firstElementChild as HTMLElement;
    return {
      stood,
      copy: {
        scrim: copy.style.opacity,
        panel: inner.style.opacity,
        transform: inner.style.transform,
      },
      fade: getComputedStyle(copy).animationName,
      duration: getComputedStyle(copy).animationDuration,
      gone: document.querySelectorAll('[role="dialog"]').length === 0,
    };
  });
  expect(Number(result.stood.panel)).toBeLessThan(1);
  expect(result.stood.transform).not.toBe('none');
  expect(result.copy).toEqual(result.stood);
  expect(result.fade).toBe('fade-away');
  expect(result.duration).toBe('0.14s');
  expect(result.gone).toBe(true);
});

test('the copy shows what was on screen: typed text, a select choice, the scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto('/');
  const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await expect(panelOf(modal)).not.toHaveClass(/animate-/);
  await modal
    .getByRole('tabpanel')
    .getByLabel('Street address')
    .fill('Typed before closing');
  await modal.getByLabel('Load status').selectOption({ index: 1 });
  const status = await modal.getByLabel('Load status').inputValue();
  const scrolled = await modal.locator('[data-edit-scroll]').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.getByText('Discard changes?').waitFor();

  const result = await page.evaluate(async (rowId) => {
    const discard = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Discard',
    )!;
    discard.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copies = [...document.querySelectorAll<HTMLElement>('[data-dialog-fading]')];
    const editor = copies.find((c) => c.classList.contains('z-40'))!;
    const row = document.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`)!;
    const r = row.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      copies: copies.length,
      typed: [...editor.querySelectorAll('input')].some(
        (i) => i.value === 'Typed before closing',
      ),
      select: [...editor.querySelectorAll('select')].map((s) => s.value),
      scroll: [...editor.querySelectorAll('*')].map((e) => e.scrollTop).find(Boolean),
      identity: editor.querySelectorAll(
        '[id],[role],[name],[for],[tabindex],[aria-label]',
      ).length,
      realDialogs: document.querySelectorAll('[role="dialog"]').length,
      clickReachesRow: hit !== null && row.contains(hit),
    };
  }, IDS.truckChicago);

  expect(result.copies).toBe(2);
  expect(result.typed).toBe(true);
  expect(result.select).toContain(status);
  expect(result.scroll).toBe(scrolled);
  expect(result.identity).toBe(0);
  expect(result.realDialogs).toBe(0);
  expect(result.clickReachesRow).toBe(true);
  await expect(page.locator('[data-dialog-fading]')).toHaveCount(0);
});

const WINDOW = {
  panel: {
    name: 'dialog-in',
    duration: '0.22s',
    timing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    fill: 'backwards',
  },
  scrim: { name: 'fade-in', duration: '0.22s', timing: 'linear', fill: 'backwards' },
};
const MENU = {
  menu: {
    name: 'menu-in',
    duration: '0.18s',
    timing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    fill: 'backwards',
  },
};
const copies = (page: Page) => page.locator('[data-dialog-fading]');

/** What a copy looks like the task after its window or menu closes. */
const copyJustClosed = (page: Page, button?: string) =>
  page.evaluate(async (name) => {
    if (name) {
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === name)!
        .click();
    } else {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copy = document.querySelector<HTMLElement>('[data-dialog-fading]');
    return copy
      ? {
          fade: getComputedStyle(copy).animationName,
          duration: getComputedStyle(copy).animationDuration,
          position: getComputedStyle(copy).position,
          clicks: getComputedStyle(copy).pointerEvents,
          hasWords: (copy.textContent ?? '').trim().length > 0,
        }
      : null;
  }, button);

test.describe('every window opens at Medium, and fades when it closes', () => {
  const windows: [string, (page: Page) => Promise<void>][] = [
    ['the command palette', (page) => page.keyboard.press('Control+k')],
    ['the shortcut sheet', (page) => page.keyboard.press('?')],
    [
      'the bulk modal',
      async (page) => {
        await page
          .getByRole('checkbox', { name: `Select truck ${TRUCK_NUMBERS.chicago}` })
          .check();
        await page
          .getByRole('checkbox', { name: `Select truck ${TRUCK_NUMBERS.dallas}` })
          .check();
        await page.getByRole('button', { name: 'Force status…' }).click();
      },
    ],
    [
      'the add-to-list modal',
      async (page) => {
        await page
          .getByRole('checkbox', { name: `Select truck ${TRUCK_NUMBERS.chicago}` })
          .check();
        await page
          .getByRole('checkbox', { name: `Select truck ${TRUCK_NUMBERS.dallas}` })
          .check();
        await page.getByRole('button', { name: 'Add to list…' }).click();
      },
    ],
  ];

  for (const [name, open] of windows) {
    test(name, async ({ page }) => {
      await page.goto('/');
      const opening = await recordOpening(page);
      await open(page);
      await expect.poll(opening).toEqual(WINDOW);
      await expect(page.locator('.animate-dialog-in')).toHaveCount(0);
      // The bulk modal has no Esc of its own (phase 3bb's report): Cancel closes it.
      const button = name === 'the bulk modal' ? 'Cancel' : undefined;
      expect(await copyJustClosed(page, button)).toEqual({
        fade: 'fade-away',
        duration: '0.14s',
        position: 'fixed',
        clicks: 'none',
        hasWords: true,
      });
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      await expect(copies(page)).toHaveCount(0);
    });
  }

  test('the tour', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('?');
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();
    const opening = await recordOpening(page);
    await page.getByRole('button', { name: 'Take the tour again' }).click();
    // A different window: an opening of its own, not a continuation.
    await expect.poll(opening).toEqual(WINDOW);
  });

  test('the palette giving way to the edit modal opens the modal', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('.animate-dialog-in')).toHaveCount(0);
    const opening = await recordOpening(page);
    await page.keyboard.type(String(TRUCK_NUMBERS.chicago));
    await page.keyboard.press('Enter');
    await rowOf(page, IDS.truckChicago).waitFor();
    await page.keyboard.press('Enter');
    await expect(editModal(page, TRUCK_NUMBERS.chicago)).toBeVisible();
    await expect.poll(opening).toEqual(WINDOW);
    await expect(copies(page)).toHaveCount(0);
  });

  test('Discard changes says what it is', async ({ page }) => {
    await page.goto('/');
    const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
    await modal.getByRole('tabpanel').getByLabel('Street address').fill('Typed');
    const opening = await recordOpening(page);
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(discard).toBeVisible();
    await expect(discard).toHaveAttribute('aria-modal', 'true');
    await expect.poll(opening).toEqual(WINDOW);
  });
});

test.describe('every menu and dropdown opens at Medium, and fades when it closes', () => {
  const closes = async (page: Page) => {
    await expect(page.locator('.animate-menu-in')).toHaveCount(0);
    const copy = await copyJustClosed(page);
    expect(copy).toEqual({
      fade: 'fade-away',
      duration: '0.1s',
      position: 'fixed',
      clicks: 'none',
      hasWords: true,
    });
    await expect(copies(page)).toHaveCount(0);
  };

  test('the account menu', async ({ page }) => {
    await page.goto('/');
    const opening = await recordOpening(page);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    await expect.poll(opening).toEqual(MENU);
    await closes(page);
    await expect(page.getByRole('menu', { name: 'Account' })).toHaveCount(0);
  });

  test('the scope menu, a fixed popover, comes back in the same place', async ({
    page,
  }) => {
    await page.goto('/');
    const opening = await recordOpening(page);
    await page.locator('[aria-controls], [aria-haspopup="menu"]').first().click();
    const menu = page.locator('[data-views-menu]');
    await expect(menu).toBeVisible();
    await expect.poll(opening).toEqual(MENU);
    await expect(page.locator('.animate-menu-in')).toHaveCount(0);
    const stood = await menu.boundingBox();
    const seen = await page.evaluate(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const b = document.querySelector('[data-dialog-fading]')?.getBoundingClientRect();
      return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    });
    expect(seen).toEqual(stood);
  });

  test('the driver dropdown in the edit window fades above the window', async ({
    page,
  }) => {
    await page.goto('/');
    const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
    await expect(panelOf(modal)).not.toHaveClass(/animate-/);
    const opening = await recordOpening(page);
    await modal.getByRole('combobox').first().click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect.poll(opening).toEqual(MENU);
    await expect(page.locator('.animate-menu-in')).toHaveCount(0);
    // A click on the window's own heading closes the list and lands.
    const hit = await page.evaluate(async () => {
      const heading = document.querySelector('[role="dialog"] h2')!;
      heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const copy = document.querySelector<HTMLElement>('[data-dialog-fading]')!;
      const b = copy.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        zIndex: Number(getComputedStyle(copy).zIndex),
        listGone: document.querySelector('[role="listbox"]') === null,
        clickGoesThrough: top !== null && !copy.contains(top),
      };
    });
    expect(hit.zIndex).toBeGreaterThan(60);
    expect(hit.listGone).toBe(true);
    expect(hit.clickGoesThrough).toBe(true);
    await expect(copies(page)).toHaveCount(0);
  });

  test('the week picker on the history page', async ({ page }) => {
    await page.goto('/history');
    const trigger = page.getByRole('button', { name: /choose a week$/ });
    await trigger.waitFor();
    const opening = await recordOpening(page);
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Choose a week' })).toBeVisible();
    await expect.poll(opening).toEqual(MENU);
  });
});

test.describe('on a phone', () => {
  const size = SIZES[3]!;

  test('the truck sheet opens at Medium from the bottom, and its backdrop never moves', async ({
    browser,
  }) => {
    const { context, page } = await onPhone(browser, size);
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      const card = page.locator(`[data-phone-card="${IDS.truckChicago}"]`);
      await card.waitFor();
      const opening = await recordOpening(page);
      await card.tap();
      const sheet = page.locator('[data-truck-sheet]');
      await expect(sheet).toBeVisible();
      await expect.poll(opening).toEqual(WINDOW);
      await expect(page.locator('.animate-dialog-in')).toHaveCount(0);
      expect(await sheet.getAttribute('role')).toBe('dialog');

      const backdrop = page.getByRole('button', { name: 'Close the truck sheet' });
      const box = (await backdrop.boundingBox())!;
      await page.mouse.move(box.x + 8, box.y + 8);
      await page.mouse.down();
      expect(await backdrop.evaluate((el) => getComputedStyle(el).transform)).toBe(
        'none',
      );
      await page.mouse.up();
      await expect(sheet).toHaveCount(0);
      await expect(copies(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('the filters sheet opens at Medium', async ({ browser }) => {
    const { context, page } = await onPhone(browser, size);
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      const more = page.getByRole('button', { name: /^More filters/ });
      await more.waitFor();
      const opening = await recordOpening(page);
      await more.tap();
      await expect(page.locator('[data-phone-more-sheet]')).toBeVisible();
      await expect.poll(opening).toEqual(WINDOW);
    } finally {
      await context.close();
    }
  });
});

test.describe('hover and press', () => {
  const pseudo = (el: Element) => {
    const cs = getComputedStyle(el, '::after');
    return { opacity: Number(cs.opacity), width: cs.width };
  };
  const transformOf = (el: Element) => getComputedStyle(el).transform;
  const chip = (page: Page) => page.locator('button', { hasText: /^Late/ }).first();
  const scaleOf = (matrix: string) =>
    Number(matrix.match(/matrix\(([^,]+)/)?.[1] ?? 'NaN');

  test('a row never moves on hover: no transform at all, and the grey bar shows', async ({
    page,
  }) => {
    await page.goto('/');
    const row = rowOf(page, IDS.truckDallas);
    await row.hover();
    await expect.poll(() => row.evaluate(pseudo)).toEqual({ opacity: 0.8, width: '3px' });
    // Not even a zero one: translateX(0) would compute to a matrix, not to none.
    expect(await row.evaluate(transformOf)).toBe('none');
  });

  test('a selected row has no hover bar: its accent rail says enough', async ({
    page,
  }) => {
    await page.goto('/');
    const row = rowOf(page, IDS.truckDallas);
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await row.hover();
    expect(await row.evaluate((el) => getComputedStyle(el, '::after').content)).toBe(
      'none',
    );
  });

  test('a row shrinks only while pressed, and the click lands', async ({ page }) => {
    await page.goto('/');
    const row = rowOf(page, IDS.truckDallas);
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => scaleOf(await row.evaluate(transformOf)))
      .toBeCloseTo(0.995, 3);
    await page.mouse.up();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => row.evaluate(transformOf)).toBe('none');
  });

  test('pressing a control in a row does not press the row', async ({ page }) => {
    await page.goto('/');
    const row = rowOf(page, IDS.truckDallas);
    const box = (await row.locator('input[type="checkbox"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Long enough for a press to have shown, had there been one.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(await row.evaluate(transformOf)).toBe('none');
    await page.mouse.up();
  });

  test('a button lifts 1px on hover and shrinks to 96% on press', async ({ page }) => {
    await page.goto('/');
    const button = chip(page);
    await button.hover();
    await expect
      .poll(() => button.evaluate(transformOf))
      .toBe('matrix(1, 0, 0, 1, 0, -1)');
    await page.mouse.down();
    await expect
      .poll(async () => scaleOf(await button.evaluate(transformOf)))
      .toBeCloseTo(0.96, 3);
    await page.mouse.up();
    await page.mouse.move(2, 2);
    await expect.poll(() => button.evaluate(transformOf)).toBe('none');
  });

  test('a press at the very edge of a button still clicks', async ({ page }) => {
    await page.goto('/');
    const button = chip(page);
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => scaleOf(await button.evaluate(transformOf)))
      .toBeCloseTo(0.96, 3);
    await page.mouse.up();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * The menu is fixed, and placed from a measurement taken during the click. By
   * then a mouse has the button at 96%, so the measurement has to come from
   * something the press does not move. Each case holds the press until it has
   * landed: how fast a robot lets go must not decide whether this can fail.
   */
  test.describe('the scope menu opens at the resting edge of its button', () => {
    const scopeButton = (page: Page) =>
      page.locator('[data-scope] [aria-haspopup="menu"]');

    /** Where the button stands with nothing on it: no press and no lift. */
    const resting = async (page: Page) => {
      await page.goto('/');
      const button = scopeButton(page);
      await button.waitFor();
      expect(await button.evaluate(transformOf)).toBe('none');
      return (await button.boundingBox())!;
    };

    const pressLanded = (page: Page) =>
      expect
        .poll(async () => scaleOf(await scopeButton(page).evaluate(transformOf)))
        .toBeCloseTo(0.96, 3);

    const expectMenuAt = async (
      page: Page,
      rest: { x: number; y: number; height: number },
    ) => {
      const menu = page.locator('[data-views-menu]');
      await expect(menu).toBeVisible();
      await expect(page.locator('.animate-menu-in')).toHaveCount(0);
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeCloseTo(rest.x, 1);
      expect(box.y).toBeCloseTo(rest.y + rest.height + 4, 1);
    };

    test('a real mouse click, and the button keeps its press', async ({ page }) => {
      const rest = await resting(page);
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
      await page.mouse.down();
      await pressLanded(page);
      await page.mouse.up();
      await expectMenuAt(page, rest);
    });

    test('Enter on the focused button', async ({ page }) => {
      const rest = await resting(page);
      await scopeButton(page).focus();
      await page.keyboard.press('Enter');
      await expectMenuAt(page, rest);
    });

    test('Space on the focused button, which presses it while held', async ({ page }) => {
      const rest = await resting(page);
      await scopeButton(page).focus();
      await page.keyboard.down(' ');
      await pressLanded(page);
      await page.keyboard.up(' ');
      await expectMenuAt(page, rest);
    });

    test('V, with the pointer resting on the button and lifting it', async ({ page }) => {
      const rest = await resting(page);
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
      await expect
        .poll(() => scopeButton(page).evaluate(transformOf))
        .toBe('matrix(1, 0, 0, 1, 0, -1)');
      await page.keyboard.press('v');
      await expectMenuAt(page, rest);
    });
  });

  test('hover does not flicker on the bottom edge of a lifting button', async ({
    page,
  }) => {
    await page.goto('/');
    const button = chip(page);
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 1);
    const flips = await button.evaluate(async (el) => {
      const seen: boolean[] = [];
      for (let i = 0; i < 40; i += 1) {
        await new Promise(requestAnimationFrame);
        seen.push(el.matches(':hover'));
      }
      return seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    });
    expect(flips).toBe(0);
  });

  test('a menu item does not lift, and presses by 0.5%', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Account:/ }).click();
    const item = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(page.locator('.animate-menu-in')).toHaveCount(0);
    await item.hover();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 220)));
    expect(await item.evaluate(transformOf)).toBe('none');
    const box = (await item.boundingBox())!;
    await page.mouse.down();
    await expect
      .poll(async () => scaleOf(await item.evaluate(transformOf)))
      .toBeCloseTo(0.995, 3);
    // Let go off the item, so this test signs nobody out.
    await page.mouse.move(box.x - 40, box.y - 200);
    await page.mouse.up();
  });

  test('what a transform would break never gets one', async ({ page }) => {
    await page.goto('/');
    const kinds = [
      'sticky top-0',
      'fixed left-[300px] top-[300px]',
      'absolute top-[320px] left-[320px] -translate-y-1/2',
      'absolute inset-0',
      'a',
    ];
    const held = await page.evaluate((list) => {
      const results: string[] = [];
      for (const cls of list) {
        const b = document.createElement('button');
        b.textContent = 'x';
        if (cls === 'a') b.setAttribute('data-no-press', '');
        else b.className = cls;
        b.setAttribute('data-probe', cls);
        document.body.append(b);
        results.push(cls);
      }
      return results;
    }, kinds);
    expect(held).toHaveLength(kinds.length);
    for (const cls of kinds) {
      const b = page.locator(`[data-probe="${cls}"]`);
      const box = (await b.boundingBox())!;
      await page.mouse.move(box.x + 2, box.y + 2);
      await page.mouse.down();
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120)));
      const own = await b.evaluate(transformOf);
      // The copy button's kind keeps its own translate: never scaled, never lifted further.
      if (cls.includes('translate')) expect(scaleOf(own), cls).toBe(1);
      else expect(own, cls).toBe('none');
      await page.mouse.up();
    }
  });

  test('nothing that moves holds a fixed popover or a sticky element', async ({
    page,
  }) => {
    const offenders = () =>
      page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll('button, a[href], [data-row-id]')) {
          for (const inner of el.querySelectorAll('*')) {
            const { position } = getComputedStyle(inner);
            if (position === 'fixed' || position === 'sticky') {
              out.push(`${el.tagName} ${el.textContent?.slice(0, 20)} holds ${position}`);
            }
          }
        }
        return out;
      });
    await page.goto('/');
    await rowOf(page, IDS.truckChicago).waitFor();
    expect(await offenders()).toEqual([]);
    await page.locator('[aria-controls], [aria-haspopup="menu"]').first().click();
    await expect(page.locator('[data-views-menu]')).toBeVisible();
    expect(await offenders()).toEqual([]);
    await page.keyboard.press('Escape');
    await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
    expect(await offenders()).toEqual([]);
  });

  test.describe('under reduced motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('nothing lifts or shrinks, and the bar is simply there', async ({ page }) => {
      await page.goto('/');
      // The row first: pressing the chip filters this row away.
      const row = rowOf(page, IDS.truckDallas);
      await row.hover();
      expect(await row.evaluate(pseudo)).toEqual({ opacity: 0.8, width: '3px' });
      expect(await row.evaluate(transformOf)).toBe('none');
      const button = chip(page);
      await button.hover();
      expect(await button.evaluate(transformOf)).toBe('none');
      await page.mouse.down();
      expect(await button.evaluate(transformOf)).toBe('none');
      await page.mouse.up();
    });
  });
});

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the modal opens and closes with no motion and no fading copy', async ({
    page,
  }) => {
    await page.goto('/');
    const seen = await watchMotion(page);
    const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // No wait needed: an opening class lands as the modal mounts, and a
    // fading copy in the microtask after it closes, both before this.
    expect(await seen()).toEqual([]);
    await expect(page.locator('[data-dialog-fading]')).toHaveCount(0);
  });
});
