import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, resetWorld } from './fixtures';

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
            ? 'fading background'
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
      const panel = document.querySelector('[role="dialog"] > .animate-dialog-in');
      if (panel && !w.__opening.panel) w.__opening.panel = read(panel);
      const scrim = document.querySelector('[role="dialog"].animate-scrim-in');
      if (scrim && !w.__opening.scrim) w.__opening.scrim = read(scrim);
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
      duration: '0.15s',
      timing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'backwards',
    },
    scrim: { name: 'fade-in', duration: '0.15s', timing: 'linear', fill: 'backwards' },
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

test('reopening during the fade: the old background goes at once, and the new modal opens normally', async ({
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
  expect(await seen()).toEqual([
    'animate-dialog-in',
    'animate-scrim-in',
    'fading background',
  ]);
});

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the modal opens and closes with no motion and no fading background', async ({
    page,
  }) => {
    await page.goto('/');
    const seen = await watchMotion(page);
    const modal = await openModal(page, IDS.truckChicago, TRUCK_NUMBERS.chicago);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // No wait needed: an opening class lands as the modal mounts, and a
    // fading background in the microtask after it closes, both before this.
    expect(await seen()).toEqual([]);
    await expect(page.locator('[data-dialog-fading]')).toHaveCount(0);
  });
});
