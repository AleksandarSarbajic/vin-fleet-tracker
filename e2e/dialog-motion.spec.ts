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

test.describe('Discard changes? by keyboard', () => {
  /** The caret in a field of a dirty form, and Esc has raised the confirm. */
  async function openDiscard(page: Page) {
    await page.goto('/');
    const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
    const street = modal.getByRole('tabpanel').getByLabel('Street address');
    await street.fill('Typed before asking');
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(discard).toBeVisible();
    return {
      modal,
      street,
      discard,
      keep: discard.getByRole('button', { name: 'Keep editing' }),
      remove: discard.getByRole('button', { name: 'Discard' }),
    };
  }

  test('focus goes to Keep editing, and Tab stays inside, both ways round', async ({
    page,
  }) => {
    const { keep, remove } = await openDiscard(page);
    await expect(keep).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(keep).toBeFocused();
  });

  test('Esc means Keep editing, and focus goes back where it was in the form', async ({
    page,
  }) => {
    const { modal, street, discard } = await openDiscard(page);
    await page.keyboard.press('Escape');
    await expect(discard).toBeHidden();
    await expect(modal).toBeVisible();
    await expect(street).toBeFocused();
    await expect(street).toHaveValue('Typed before asking');
    // And the caret is really there: the next key types.
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect(street).toHaveValue('Typed before asking!');
  });

  for (const combo of ['Meta+Enter', 'Control+Enter']) {
    test(`${combo} does nothing: nothing is saved, and the confirm stays`, async ({
      page,
    }) => {
      const { modal, street, discard, keep } = await openDiscard(page);
      const writes: string[] = [];
      page.on('request', (request) => {
        // Ours only: the map posts its own telemetry whenever it likes.
        const { origin, pathname } = new URL(request.url());
        if (request.method() !== 'GET' && origin === new URL(page.url()).origin) {
          writes.push(pathname);
        }
      });
      await page.keyboard.press(combo);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
      expect(writes).toEqual([]);
      await expect(discard).toBeVisible();
      await expect(keep).toBeFocused();
      await expect(modal).toBeVisible();
      await expect(street).toHaveValue('Typed before asking');
    });
  }

  test('typing reaches nothing: not the form, and not the board behind it', async ({
    page,
  }) => {
    const { street, discard, keep } = await openDiscard(page);
    const compact = page.getByRole('group', { name: 'Row density' });
    const pressedBefore = await compact
      .getByRole('button')
      .evaluateAll((all) => all.map((b) => b.getAttribute('aria-pressed')));
    const url = page.url();
    const lateChip = page.locator('button', { hasText: /^Late/ }).first();
    const lateBefore = await lateChip.getAttribute('aria-pressed');

    // Letters, the density key, a filter key, search, a page jump, the sheet. No
    // space: that is a key the focused button answers, like Enter (tested below).
    await page.keyboard.type('xyzd1/gh?');
    await page.keyboard.press('Control+k');

    await expect(discard).toBeVisible();
    await expect(keep).toBeFocused();
    await expect(street).toHaveValue('Typed before asking');
    expect(page.url()).toBe(url);
    expect(await lateChip.getAttribute('aria-pressed')).toBe(lateBefore);
    expect(
      await compact
        .getByRole('button')
        .evaluateAll((all) => all.map((b) => b.getAttribute('aria-pressed'))),
    ).toEqual(pressedBefore);
    // One window at a time: neither the palette nor the sheet came up behind it.
    await expect(page.locator('[role="dialog"]')).toHaveCount(2);
  });

  test('Enter and Space work the button with focus', async ({ page }) => {
    const { modal, street, discard, keep } = await openDiscard(page);
    await page.keyboard.press('Enter');
    await expect(discard).toBeHidden();
    await expect(street).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Space');
    await expect(discard).toBeHidden();
    await expect(street).toBeFocused();
    await expect(modal).toBeVisible();
  });

  test('Discard by keyboard closes everything, and focus goes back to the row', async ({
    page,
  }) => {
    const { modal, discard, remove } = await openDiscard(page);
    await page.keyboard.press('Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(discard).toBeHidden();
    await expect(modal).toBeHidden();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(rowOf(page, IDS.truckChicago)).toBeFocused();
  });

  test('the mouse works as it does', async ({ page }) => {
    const { modal, discard, keep, remove } = await openDiscard(page);
    await keep.click();
    await expect(discard).toBeHidden();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await remove.click();
    await expect(modal).toBeHidden();
  });
});

test.describe('the reorder bar never moves a row', () => {
  const bar = (page: Page) =>
    page.getByRole('button', { name: /rows? would reorder — click to sort/i });
  const rows = (page: Page) => page.locator('[data-row-id]');

  /** A list long enough to be a list, and its rows in place. */
  async function openLongBoard(page: Page, width = 1440) {
    // Due now, so the health strip has a stop today and draws its bar.
    await resetWorld({ extraTrucks: 20, appointmentUtc: new Date() });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await rows(page).first().waitFor();
    return (await rows(page).last().getAttribute('data-row-id'))!;
  }

  /** The next poll says the row drawn last is the most urgent on the board. */
  async function driftOnNextPoll(page: Page, id: string) {
    await page.route('**/api/fleet', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        fleet: { id: string; status: string; apptAt: string | null }[];
      };
      for (const row of body.fleet) {
        if (row.id === id) {
          row.status = 'LATE';
          row.apptAt = '2020-01-01T00:00:00.000Z';
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  }

  type Tops = { __tops: Record<string, number[]>; __stop: boolean };

  /** Every row's top, on every frame, from before the poll until after the bar. */
  const watchRowTops = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as Tops;
      w.__tops = {};
      w.__stop = false;
      const read = () => {
        for (const row of document.querySelectorAll('[data-row-id]')) {
          const id = row.getAttribute('data-row-id')!;
          const top = row.getBoundingClientRect().top;
          const seen = (w.__tops[id] ??= []);
          if (!seen.includes(top)) seen.push(top);
        }
        if (!w.__stop) requestAnimationFrame(read);
      };
      read();
    });

  const rowsThatMoved = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as Tops;
      w.__stop = true;
      return Object.values(w.__tops).filter((tops) => tops.length > 1);
    });

  const rowUnder = (page: Page, x: number, y: number) =>
    page.evaluate(
      ([px, py]) =>
        document
          .elementFromPoint(px!, py!)
          ?.closest('[data-row-id]')
          ?.getAttribute('data-row-id') ?? null,
      [x, y],
    );

  /*
   * 15s, past the old hold's 10: were the hold ever back, this waits for the bar
   * and then fails on the row that moved, which is the point, and not on the wait.
   */
  const SHOWN = { timeout: 15_000 };

  test('drift appears with the pointer on the list: every row keeps its top on every frame', async ({
    page,
  }) => {
    const last = await openLongBoard(page);
    const target = (await rows(page).nth(3).boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await watchRowTops(page);
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    // Some frames with the bar up, so a late shift would be seen.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(await rowsThatMoved(page)).toEqual([]);
  });

  test('a click aimed at a row before the bar appeared lands on that row', async ({
    page,
  }) => {
    const last = await openLongBoard(page);
    const target = rows(page).nth(3);
    const id = (await target.getAttribute('data-row-id'))!;
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    expect(await rowUnder(page, x, y)).toBe(id);
    await page.mouse.click(x, y);
    await expect(rowOf(page, id)).toHaveAttribute('aria-selected', 'true');
  });

  test('two rows checked: the bar shows, and nothing moves', async ({ page }) => {
    const last = await openLongBoard(page);
    await page
      .getByRole('checkbox', { name: `Select truck ${TRUCK_NUMBERS.chicago}` })
      .check();
    await page
      .getByRole('checkbox', { name: `Select truck ${TRUCK_NUMBERS.dallas}` })
      .check();
    await page.mouse.move(1, 1);
    await watchRowTops(page);
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    expect(await rowsThatMoved(page)).toEqual([]);
  });

  test('rows move only when it is clicked, and then it goes', async ({ page }) => {
    const last = await openLongBoard(page);
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    await expect(bar(page)).toHaveText(/^\d+ rows would reorder — click to sort$/i);
    expect(await rows(page).first().getAttribute('data-row-id')).not.toBe(last);
    await bar(page).click();
    await expect(rows(page).first()).toHaveAttribute('data-row-id', last);
    await expect(bar(page)).toHaveCount(0);
  });

  test('it stands in the toolbar line, outside the scroller', async ({ page }) => {
    const last = await openLongBoard(page);
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    const inScroller = await bar(page).evaluate(
      (el) => el.closest('.overflow-y-auto') !== null,
    );
    expect(inScroller).toBe(false);
  });

  /** The list pane at this width, by the split the page reads on load. */
  async function atListWidth(page: Page, width: number) {
    const viewport = 1086;
    await page.addInitScript(
      (pct) => window.localStorage.setItem('ft.splitPct', String(pct)),
      (width / viewport) * 100,
    );
    return openLongBoard(page, viewport);
  }

  const toolbarLine = (page: Page) =>
    bar(page).locator('xpath=ancestor::div[contains(@class,"h-8")][1]');

  const measureLine = (line: Locator) =>
    line.evaluate((el) => ({
      width: Math.round(el.getBoundingClientRect().width),
      overflows: el.scrollWidth > el.clientWidth,
    }));

  /** Split.tsx's LIST_MIN_PX: the narrowest a drag can leave it. */
  test('at the narrowest list pane it fits: the strip gives way, Density stays', async ({
    page,
  }) => {
    const last = await atListWidth(page, 560);
    const density = page.getByRole('group', { name: 'Row density' });
    const before = (await density.boundingBox())!;
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    expect(await measureLine(toolbarLine(page))).toEqual({ width: 560, overflows: false });

    const box = (await bar(page).boundingBox())!;
    const after = (await density.boundingBox())!;
    expect(after).toEqual(before);
    expect(box.x + box.width).toBeLessThanOrEqual(after.x);
    // Same words, whole: it is the strip that gives way.
    expect(await bar(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const strip = toolbarLine(page).locator(':scope > div').first();
    const stripBox = (await strip.boundingBox())!;
    expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(box.x);
    // Its bar narrows and is still there, and the strip's own edge holds it in.
    const meter = (await strip.locator('span[aria-hidden="true"]').boundingBox())!;
    expect(meter.width).toBeGreaterThan(40);
    expect(meter.x + meter.width).toBeLessThanOrEqual(stripBox.x + stripBox.width);
  });

  /** A split stored on a wider window: nothing clamps it on load. */
  test('under the minimum too, Density is whole and inside the line', async ({ page }) => {
    const last = await atListWidth(page, 320);
    const density = page.getByRole('group', { name: 'Row density' });
    const before = (await density.boundingBox())!;
    await driftOnNextPoll(page, last);
    await expect(bar(page)).toBeVisible(SHOWN);
    expect(await measureLine(toolbarLine(page))).toEqual({ width: 320, overflows: false });
    expect(await density.boundingBox()).toEqual(before);
    const line = (await toolbarLine(page).boundingBox())!;
    expect(before.x + before.width).toBeLessThanOrEqual(line.x + line.width);
    const box = (await bar(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(line.x);
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

  /**
   * The same promise on every side of a resting box, half a pixel in, which is
   * the middle of the first pixel: on a bordered thing that is the border itself,
   * which a hit area measured from the padding box would miss.
   */
  test.describe('a press at the very edge lands, on every side', () => {
    const sides: [
      string,
      (b: { x: number; y: number; width: number; height: number }) => [number, number],
    ][] = [
      ['left', (b) => [b.x + 0.5, b.y + b.height / 2]],
      ['right', (b) => [b.x + b.width - 0.5, b.y + b.height / 2]],
      ['top', (b) => [b.x + b.width / 2, b.y + 0.5]],
      ['bottom', (b) => [b.x + b.width / 2, b.y + b.height - 0.5]],
    ];

    for (const [side, at] of sides) {
      test(`a bordered button, on its ${side} edge`, async ({ page }) => {
        await page.goto('/');
        const button = chip(page);
        const [x, y] = at((await button.boundingBox())!);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await expect
          .poll(async () => scaleOf(await button.evaluate(transformOf)))
          .toBeCloseTo(0.96, 3);
        await page.mouse.up();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
      });

      /*
       * Below 1086px, because that is where a row has four edges: above it the
       * last 12px of a row are the Split handle's grab margin, not the row.
       */
      test(`a row, on its ${side} edge`, async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 700 });
        await page.goto('/');
        await page.getByRole('button', { name: 'Hide map' }).click();
        const row = rowOf(page, IDS.truckDallas);
        await row.waitFor();
        const [x, y] = at((await row.boundingBox())!);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await expect
          .poll(async () => scaleOf(await row.evaluate(transformOf)))
          .toBeCloseTo(0.995, 3);
        await page.mouse.up();
        await expect(row).toHaveAttribute('aria-selected', 'true');
      });
    }
  });

  /**
   * A tap is over before anything has moved, with the button already up 1px under
   * the pointer. The hit area must not lose that pixel when the press begins.
   */
  test('a quick tap on the bottom edge of a lifted button lands', async ({ page }) => {
    await page.goto('/');
    const button = chip(page);
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 0.5);
    await expect
      .poll(() => button.evaluate(transformOf))
      .toBe('matrix(1, 0, 0, 1, 0, -1)');
    await page.mouse.down();
    await page.mouse.up();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * A scroller that grows shows its scrollbars. Read on every frame, in the page,
   * from before the gesture until after it, because a scrollbar that flashes for
   * the first frames of a press is the same bug. No tolerance: one pixel is a
   * scrollbar.
   */
  test.describe('a press or a hover never makes a scroller grow', () => {
    type Watched = { __sizes: string[]; __stop: boolean };

    const watch = (scroller: Locator) =>
      scroller.evaluate((el) => {
        const w = window as unknown as Watched;
        w.__sizes = [];
        w.__stop = false;
        const read = () => {
          w.__sizes.push(
            `${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`,
          );
          if (!w.__stop) requestAnimationFrame(read);
        };
        read();
        return w.__sizes[0]!;
      });

    const seen = (page: Page) =>
      page.evaluate(() => {
        const w = window as unknown as Watched;
        w.__stop = true;
        return [...new Set(w.__sizes)];
      });

    /**
     * Hover, press, and off it before letting go, since a click would select or
     * pin. Then the same at full speed, where the lift and the press overlap.
     */
    async function gesture(
      page: Page,
      target: Locator,
      how: { press: number; lifts: boolean; away?: [number, number] },
    ) {
      const box = (await target.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const [awayX, awayY] = how.away ?? [1, 1];
      const atRest = () => expect.poll(() => target.evaluate(transformOf)).toBe('none');

      await page.mouse.move(x, y);
      if (how.lifts) {
        await expect
          .poll(() => target.evaluate(transformOf))
          .toBe('matrix(1, 0, 0, 1, 0, -1)');
      }
      await page.mouse.down();
      await expect
        .poll(async () => scaleOf(await target.evaluate(transformOf)))
        .toBeCloseTo(how.press, 3);
      await page.mouse.move(awayX, awayY);
      await page.mouse.up();
      await atRest();

      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(awayX, awayY);
      await page.mouse.up();
      await atRest();
    }

    async function expectNoGrowth(
      page: Page,
      scroller: Locator,
      target: Locator,
      how: { press: number; lifts: boolean; away?: [number, number] },
    ) {
      const rest = await watch(scroller);
      await gesture(page, target, how);
      expect(await seen(page)).toEqual([rest]);
    }

    const boardRows = (page: Page) => page.locator('[data-row-id]');
    const boardScroller = (page: Page) =>
      boardRows(page)
        .first()
        .locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');

    async function openBoard(page: Page) {
      await resetWorld({ extraTrucks: 20 });
      await page.setViewportSize({ width: 1440, height: 700 });
      await page.goto('/');
      await boardRows(page).first().waitFor();
      const scroller = boardScroller(page);
      // The list must really scroll, or its last row is not at any edge.
      expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
        true,
      );
      return scroller;
    }

    const toBottom = (scroller: Locator) =>
      scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

    /**
     * A test that passes because nothing was at the edge has tested nothing. It
     * polls because the board is virtualized: straight after a scroll, the last
     * row in the DOM is only the last one drawn so far.
     */
    const expectAtTheBottomEdge = (scroller: Locator, target: Locator) =>
      expect
        .poll(async () => {
          const s = (await scroller.boundingBox())!;
          const t = (await target.boundingBox())!;
          return Math.abs(s.y + s.height - (t.y + t.height));
        })
        .toBeLessThan(1);

    test('the board, a middle row', async ({ page }) => {
      const scroller = await openBoard(page);
      const row = boardRows(page).nth(8);
      await row.scrollIntoViewIfNeeded();
      await expectNoGrowth(page, scroller, row, { press: 0.995, lifts: false });
    });

    test('the board, the last row', async ({ page }) => {
      const scroller = await openBoard(page);
      await toBottom(scroller);
      const row = boardRows(page).last();
      await expectAtTheBottomEdge(scroller, row);
      await expectNoGrowth(page, scroller, row, { press: 0.995, lifts: false });
    });

    test('the board, the pin button inside a middle row', async ({ page }) => {
      const scroller = await openBoard(page);
      const row = boardRows(page).nth(8);
      await row.scrollIntoViewIfNeeded();
      const pin = row.getByRole('button', { name: /^(Un)?[Pp]in truck/ });
      await expectNoGrowth(page, scroller, pin, { press: 0.96, lifts: true });
    });

    test('the board, the pin button inside the last row', async ({ page }) => {
      const scroller = await openBoard(page);
      await toBottom(scroller);
      await expectAtTheBottomEdge(scroller, boardRows(page).last());
      const pin = boardRows(page)
        .last()
        .getByRole('button', { name: /^(Un)?[Pp]in truck/ });
      await expectNoGrowth(page, scroller, pin, { press: 0.96, lifts: true });
    });

    /** A real scrolling menu: enough saved views to fill the scope menu's list. */
    async function openLongViewList(page: Page) {
      await page.addInitScript(() => {
        const views = Array.from({ length: 24 }, (_, i) => ({
          id: `view-${i}`,
          name: `View ${i}`,
          query: `q${i}`,
          chips: [],
        }));
        window.localStorage.setItem('ft.views', JSON.stringify(views));
      });
      await page.goto('/');
      await page.locator('[data-scope] [aria-haspopup="menu"]').click();
      await expect(page.locator('[data-views-menu]')).toBeVisible();
      await expect(page.locator('.animate-menu-in')).toHaveCount(0);
      const list = page.locator('[data-view-list]');
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await toBottom(list);
      return list;
    }

    test('a scrolling menu, the button at its bottom edge', async ({ page }) => {
      const list = await openLongViewList(page);
      const last = list.getByRole('menuitem', { name: /^View 23/ });
      await expectAtTheBottomEdge(list, last);
      await expectNoGrowth(page, list, last, { press: 0.995, lifts: false });
    });

    test('a scrolling menu, the delete button in its bottom corner', async ({ page }) => {
      const list = await openLongViewList(page);
      const remove = list.locator('button').last();
      await expectNoGrowth(page, list, remove, { press: 0.995, lifts: false });
    });

    /**
     * Nothing real sits within 16px of this scroller's edge today, so nothing real
     * can fail here: a button is placed flush in its bottom right corner, with
     * no border, an even one and an uneven one.
     */
    for (const [name, style] of [
      ['no border', 'border:0'],
      ['an even border', 'border:1px solid'],
      ['an uneven border', 'border:0;border-left:3px solid;border-top:1px solid'],
    ] as const) {
      test(`the edit window's scroll area, a button in its corner with ${name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 700 });
        await page.goto('/');
        const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
        await modal.getByRole('tabpanel').waitFor();
        await expect(panelOf(modal)).not.toHaveClass(/animate-/);
        const scroller = modal.locator('[data-edit-scroll]');
        await scroller.evaluate((el, css) => {
          const probe = document.createElement('button');
          probe.type = 'button';
          probe.textContent = 'At the edge';
          probe.setAttribute('data-edge-probe', '');
          probe.style.cssText = `display:block;margin-left:auto;padding:8px 40px;${css}`;
          el.append(probe);
          el.scrollTop = el.scrollHeight;
        }, style);
        const probe = scroller.locator('[data-edge-probe]');
        await expectAtTheBottomEdge(scroller, probe);
        const heading = (await modal.locator('h2').first().boundingBox())!;
        await expectNoGrowth(page, scroller, probe, {
          press: 0.96,
          lifts: true,
          away: [heading.x + 4, heading.y + 4],
        });
      });
    }

    test("the edit window's scroll area, the real button nearest its edge", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 700 });
      await page.goto('/');
      const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
      await modal.getByRole('tabpanel').waitFor();
      await expect(panelOf(modal)).not.toHaveClass(/animate-/);
      const heading = (await modal.locator('h2').first().boundingBox())!;
      await expectNoGrowth(
        page,
        modal.locator('[data-edit-scroll]'),
        modal.locator('button', { hasText: /^FCFS$/ }),
        { press: 0.96, lifts: true, away: [heading.x + 4, heading.y + 4] },
      );
    });

    test('a phone card, the last in its scrolling list', async ({ browser }) => {
      await resetWorld({ extraTrucks: 20 });
      const { context, page } = await onPhone(browser, SIZES[3]!);
      try {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto('/');
        const list = page.locator('[data-phone-cards]');
        await page.locator('[data-phone-card]').first().waitFor();
        expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
        await toBottom(list);
        const card = page.locator('[data-phone-card]').last();
        await expectAtTheBottomEdge(list, card);
        await expectNoGrowth(page, list, card, { press: 0.995, lifts: false });
      } finally {
        await context.close();
      }
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
