import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';

/**
 * Phase 3bd, the new motion (§12.149), in a real browser with motion on and a real
 * pointer. The suite's default is reduced (playwright.config.ts), so this file turns
 * it back on, as `dialog-motion.spec.ts` does.
 *
 * What every motion here is held to, by `watchFrames`: nothing grows a scroller on
 * any frame, and nothing is left when it ends.
 */
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

/**
 * The numbers of §12.149, written out and not read from `tokens.ts`: a test reading the
 * token passes whatever the token says.
 */
const DIALOG_CURVE = 'cubic-bezier(.22,.61,.36,1)';
const SEGMENT_MS = 180;
const ROLL_MS = 240;
const FLASH_MS = 1600;

test.beforeEach(async () => {
  await resetWorld();
});

type Frames = {
  __stop: boolean;
  __count: number;
  /** For each scroller: the most it could scroll on any frame, across and down. */
  __peak: Map<Element, [number, number]>;
  __start: Map<Element, [number, number]>;
};

const OVERFLOWS = /auto|scroll|hidden/;

/**
 * Every scroller on the page, read on every frame. A thing moving past its box makes
 * the box able to scroll further for that frame, and the bars appear: §12.148, 3bb's
 * live bug. Hidden boxes count too, since what moves past one still counts against it.
 * The map's own insides do not.
 *
 * Growth is measured against the larger of the two ends, because a list that changes
 * length has really changed its size.
 */
async function watchFrames(page: Page) {
  await page.evaluate((pattern) => {
    const overflows = new RegExp(pattern);
    const w = window as unknown as Frames;
    w.__stop = false;
    w.__count = 0;
    w.__peak = new Map();
    w.__start = new Map();
    const find = () => [
      document.documentElement,
      document.body,
      ...[...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
        // A screen reader's 1px box: what it says changes with the clock.
        if (el.closest('.mapboxgl-map') || el.classList.contains('sr-only')) return false;
        const cs = getComputedStyle(el);
        return overflows.test(cs.overflowX) || overflows.test(cs.overflowY);
      }),
    ];
    let scrollers = find();
    const read = () => {
      if (w.__stop) return;
      w.__count += 1;
      // The list of them changes rarely, and finding them is the one slow part.
      if (w.__count % 30 === 0) scrollers = find();
      for (const el of scrollers) {
        const x = el.scrollWidth - el.clientWidth;
        const y = el.scrollHeight - el.clientHeight;
        if (!w.__start.has(el)) w.__start.set(el, [x, y]);
        const peak = w.__peak.get(el);
        w.__peak.set(el, peak ? [Math.max(peak[0], x), Math.max(peak[1], y)] : [x, y]);
      }
      requestAnimationFrame(read);
    };
    read();
  }, OVERFLOWS.source);

  return async () =>
    page.evaluate(() => {
      const w = window as unknown as Frames;
      w.__stop = true;
      const grew: string[] = [];
      for (const [el, [px, py]] of w.__peak) {
        if (!el.isConnected) continue;
        const [sx, sy] = w.__start.get(el)!;
        const ex = el.scrollWidth - el.clientWidth;
        const ey = el.scrollHeight - el.clientHeight;
        if (px > Math.max(sx, ex) || py > Math.max(sy, ey)) {
          const name = `${el.tagName} ${String(el.className).slice(0, 60)}`;
          grew.push(`${name}: ${sx},${sy} -> peak ${px},${py} -> ${ex},${ey}`);
        }
      }
      return { frames: w.__count, grew };
    });
}

test.describe('the watch itself', () => {
  /** A sweep that cannot fail has tested nothing. */
  test('a control: something planted past the edge of a box is found', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    const stop = await watchFrames(page);
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
          const planted = document.createElement('div');
          planted.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px';
          planted.style.transform = 'translateY(5000px)';
          scroller.querySelector('[style*="relative"]')!.append(planted);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              planted.remove();
              requestAnimationFrame(() => done());
            }),
          );
        }),
    );
    const { grew } = await stop();
    expect(grew.join('\n')).toContain('overflow-y-auto');
  });
});

test.describe('step 1, the map toggle is a long thing', () => {
  const toggle = (page: Page) => page.getByRole('button', { name: /^(Hide|Show) map$/ });
  const transformOf = (el: Element) => getComputedStyle(el).transform;
  const scaleOf = (matrix: string) =>
    matrix === 'none' ? 1 : Number(/matrix\(([^,]+)/.exec(matrix)![1]);

  test('pressed, it shrinks by half a percent and does not lift, and the stored split stays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto('/');
    await toggle(page).waitFor();
    const stored = () =>
      page.evaluate(() => [
        window.localStorage.getItem('ft.splitPct'),
        window.localStorage.getItem('ft.narrowPane'),
      ]);
    const before = await stored();
    const box = (await toggle(page).boundingBox())!;
    const stop = await watchFrames(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    expect(await toggle(page).evaluate(transformOf)).toBe('none');

    await page.mouse.down();
    await expect.poll(async () => scaleOf(await toggle(page).evaluate(transformOf))).toBeCloseTo(0.995, 3);
    const held = (await toggle(page).boundingBox())!;
    expect(box.width - held.width).toBeLessThan(box.width * 0.006);
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await expect.poll(() => toggle(page).evaluate(transformOf)).toBe('none');

    const { frames, grew } = await stop();
    expect(frames).toBeGreaterThan(5);
    expect(grew).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  test('a click still toggles it, and the stored split still stays', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto('/');
    await toggle(page).waitFor();
    const split = () => page.evaluate(() => window.localStorage.getItem('ft.splitPct'));
    const before = await split();
    const name = await toggle(page).textContent();
    await toggle(page).click();
    await expect(toggle(page)).not.toHaveText(name!);
    expect(await split()).toBe(before);
  });
});

/**
 * Whatever `read` returns, on every frame, until stopped. As a string so it runs in
 * the page with no help from Playwright between frames.
 */
async function record<T>(page: Page, read: () => T) {
  await page.evaluate(`(() => {
    const read = ${read.toString()};
    window.__rec = [];
    window.__recStop = false;
    const tick = () => {
      if (window.__recStop) return;
      window.__rec.push(read());
      requestAnimationFrame(tick);
    };
    tick();
  })()`);
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { __rec: unknown[]; __recStop: boolean };
      w.__recStop = true;
      return w.__rec as T[];
    });
}

/**
 * The page's own frames have settled. The map's first load, drawn in software here,
 * runs frames of 200ms and more for a second or so after a page opens (measured), and a
 * 180ms motion started in them is only a frame or two. A condition, not a wait.
 */
const quiet = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = performance.now();
        let calm = 0;
        const tick = (now: number) => {
          calm = now - last < 25 ? calm + 1 : 0;
          last = now;
          if (calm >= 12) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/** A curve as the browser prints it, and as the token writes it, compared as numbers. */
const curve = (easing: string) => easing.replace(/\s/g, '').replace(/([(,])0\./g, '$1.');

/** Everything the page is still running, other than a button letting go of a press. */
const stillMoving = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) => !(a instanceof CSSTransition && ['--press', '--lift', 'transform'].includes(a.transitionProperty)),
        )
        .map((a) => (a instanceof CSSTransition ? a.transitionProperty : a.constructor.name)).length,
  );

test.describe('step 2, a segment highlight slides', () => {
  const OVERLAY = '[data-segment-slide]';
  const overlayFrame = () => {
    const found = [...document.querySelectorAll('[data-segment-slide]')];
    const w = window as unknown as { __from?: Element; __to?: Element };
    return {
      count: found.length,
      x: found[0]?.getBoundingClientRect().x ?? null,
      from: w.__from ? getComputedStyle(w.__from).backgroundColor : null,
      to: w.__to ? getComputedStyle(w.__to).backgroundColor : null,
    };
  };

  const expectSlid = async (page: Page, target: Locator) => {
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(target).not.toHaveAttribute('data-segment-target', '');
    await expect.poll(() => stillMoving(page)).toBe(0);
  };

  const groundOf = (el: Element) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.borderTopColor, cs.boxShadow];
  };

  /** One gesture on one control: a real pointer, with every frame read. */
  async function slideOnce(page: Page, from: Locator, to: Locator) {
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-segment-slide]').length,
    );
    expect(before).toBe(0);
    // The stacking context that lets it sit under the words and over the ground.
    expect(
      await to.evaluate((el) => {
        const cs = getComputedStyle(el.parentElement!);
        return cs.isolation === 'isolate' || cs.zIndex !== 'auto';
      }),
    ).toBe(true);
    await from.evaluate((el) => {
      (window as unknown as { __from: Element }).__from = el;
    });
    await to.evaluate((el) => {
      (window as unknown as { __to: Element }).__to = el;
    });
    const stop = await watchFrames(page);
    const frames = await record(page, overlayFrame);
    const box = (await to.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const timing = await page
      .locator(OVERLAY)
      .evaluate((el) => {
        const [a] = el.getAnimations();
        const t = a!.effect!.getTiming();
        return { duration: t.duration, easing: t.easing, fill: t.fill };
      })
      .then((t) => ({ ...t, easing: curve(String(t.easing)) }))
      .catch(() => null);
    await expectSlid(page, to);
    const seen = await frames();
    const { frames: count, grew } = await stop();

    expect(grew).toEqual([]);
    expect(count).toBeGreaterThan(5);
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    const xs = seen.flatMap((f) => (f.x === null ? [] : [f.x]));
    // Two at least: choosing a basemap reloads the map, heavy in software, in the same moment.
    expect(xs.length).toBeGreaterThan(1);
    // The old ground is gone as the overlay leaves it, and the new one is there as it
    // lands: neither fades on its own beside the overlay. A hover can show on `from`.
    const flying = seen.filter((f) => f.count === 1);
    expect(new Set(flying.map((f) => f.to))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
    const landed = seen.slice(seen.map((f) => f.count).lastIndexOf(1) + 1);
    expect(new Set(landed.map((f) => f.to)).size).toBe(1);
    expect(flying[0]!.from).toBe(flying.at(-1)!.from);
    const direction = Math.sign(xs[xs.length - 1]! - xs[0]!);
    expect(direction).not.toBe(0);
    for (let i = 1; i < xs.length; i += 1) {
      // It only ever goes one way, and it never goes back.
      expect(Math.sign(xs[i]! - xs[i - 1]!) * direction).toBeGreaterThanOrEqual(0);
    }
    expect(timing).toEqual({
      duration: SEGMENT_MS,
      easing: curve(DIALOG_CURVE),
      fill: 'auto',
    });
  }

  test('the density control: slides, lands, and leaves nothing', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const comfortable = page.locator('[data-segment="comfortable"]');
    const compact = page.locator('[data-segment="compact"]');
    const restingLook = await comfortable.evaluate(groundOf);
    await slideOnce(page, comfortable, compact);
    await expect(compact).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(1, 1);
    await expect.poll(() => compact.evaluate(groundOf)).toEqual(restingLook);
    await expect(compact).not.toHaveAttribute('style', /./);
  });

  test('the basemap control: slides, lands, and leaves nothing', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const dark = page.locator('[data-segment="dark"]');
    const satellite = page.locator('[data-segment="satellite"]');
    await slideOnce(page, dark, satellite);
    await expect(satellite).toHaveAttribute('aria-pressed', 'true');
    await expect(satellite).not.toHaveAttribute('style', /./);
  });

  test('the phone tabs: slide, land, and leave nothing', async ({ browser }) => {
    const { context, page } = await onPhone(browser, SIZES[3]!);
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      const list = page.locator('[data-phone-tab="list"]');
      const map = page.locator('[data-phone-tab="map"]');
      await map.waitFor();
      await quiet(page);
      await slideOnce(page, list, map);
      await expect(map).toHaveAttribute('aria-selected', 'true');
      await expect(map).not.toHaveAttribute('style', /./);
    } finally {
      await context.close();
    }
  });

  test('a second choice takes it up from where it is drawn, with no pile-up', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, overlayFrame);
    const comfortable = (await page.locator('[data-segment="comfortable"]').boundingBox())!;
    const compact = (await page.locator('[data-segment="compact"]').boundingBox())!;
    const distance = Math.abs(compact.x - comfortable.x);
    // In the page, two frames apart, so the second lands well before the first arrives:
    // Playwright's own round trips can outlast most of 180ms and hide a jump.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          document.querySelector<HTMLElement>('[data-segment="compact"]')!.click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              document.querySelector<HTMLElement>('[data-segment="comfortable"]')!.click();
              done();
            }),
          );
        }),
    );
    await expect(page.locator('[data-segment="comfortable"]')).toHaveAttribute('aria-pressed', 'true');
    await expectSlid(page, page.locator('[data-segment="comfortable"]'));
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    const xs = seen.flatMap((f) => (f.x === null ? [] : [f.x]));
    for (let i = 1; i < xs.length; i += 1) {
      // A frame of this curve covers a quarter of the way at most, at its fastest.
      expect(Math.abs(xs[i]! - xs[i - 1]!)).toBeLessThan(distance * 0.35);
    }
  });

  test('D pressed five times fast: one overlay at a time, and the choice is the last', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, overlayFrame);
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('d');
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(1);
  });

  test('a press holds it until it ends', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const compact = (await page.locator('[data-segment="compact"]').boundingBox())!;
    await page.mouse.click(compact.x + 8, compact.y + 8);
    await page.mouse.move(400, 12);
    await page.mouse.down();
    const time = () =>
      page.locator(OVERLAY).evaluate((el) => el.getAnimations()[0]!.currentTime as number);
    const first = await time();
    expect(first).toBeLessThan(SEGMENT_MS);
    await page.waitForTimeout(250);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('a stored choice does not slide on load, nor when the page comes back', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ft.density', 'compact');
      window.localStorage.setItem('ft.basemap', 'satellite');
      const w = window as unknown as { __slides: number };
      w.__slides = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.hasAttribute('data-segment-slide')) w.__slides += 1;
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-segment="satellite"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.locator('[data-row-id]').first().waitFor();
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as unknown as { __slides: number }).__slides)).toBe(0);
  });

  test('a filter chip never slides: it is multi-select', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, overlayFrame);
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('0');
    await quiet(page);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(0);
  });

  test('under reduced motion: no overlay, no animation, and the choice is at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, () => ({
      overlays: document.querySelectorAll('[data-segment-slide]').length,
      animations: document.getAnimations().filter((a) => !(a instanceof CSSAnimation)).length,
    }));
    await page.locator('[data-segment="compact"]').click();
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    // Read past the end of where a slide would be. Stopping here read nothing at all.
    await quiet(page);
    const seen = await frames();
    expect(seen.length).toBeGreaterThan(10);
    expect(Math.max(...seen.map((f) => f.overlays))).toBe(0);
    expect(Math.max(...seen.map((f) => f.animations))).toBe(0);
  });
});

/**
 * Serves `/api/fleet` through `change`, and asks for it now: the same request a poll
 * makes, by the same hook, with no 20s to wait. Returns once the answer is in the page.
 */
async function pollWith(page: Page, change: (rows: FleetRowLike[]) => void) {
  await page.unroute('**/api/fleet');
  await page.route('**/api/fleet', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { fleet: FleetRowLike[] };
    change(body.fleet);
    await route.fulfill({ response, json: body });
  });
  const answered = page.waitForResponse('**/api/fleet');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await answered;
}

type FleetRowLike = { id: string; status: string; computed: string; active: boolean };

/** The first `n` rows are late, and the rest as they were. */
const lateFirst = (n: number) => (rows: FleetRowLike[]) => {
  rows.forEach((row, i) => {
    if (i < n) {
      row.status = 'LATE';
      row.computed = 'LATE';
    }
  });
};

test.describe('step 3, a count rolls when it changes', () => {
  const chip = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).first();
  const cell = (page: Page, name: string) => chip(page, name).locator('[data-roll]');
  const COPY = '[data-roll-copy]';

  const openLong = async (page: Page) => {
    await resetWorld({ extraTrucks: 20 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
  };

  test('0 to 1: two numbers for its length, then a plain number', async ({ page }) => {
    await openLong(page);
    await expect(cell(page, 'Late')).toHaveText('0');
    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    const stop = await watchFrames(page);
    const frames = await record(page, () => ({
      // Per number: a truck going late takes one off another chip in the same poll.
      copies: Math.max(
        0,
        ...[...document.querySelectorAll('[data-roll]')].map(
          (b) => b.querySelectorAll('[data-roll-copy]').length,
        ),
      ),
      // What the Late chip's box is doing on this frame, read where it happens.
      ...(() => {
        const box = (window as unknown as { __chip: Element }).__chip.querySelector('[data-roll]')!;
        const copy = box.querySelector('[data-roll-copy]');
        if (!copy) return { overflow: null, from: null, duration: null, easing: null };
        const number = box.firstElementChild!.getAnimations()[0]?.effect as KeyframeEffect | undefined;
        return {
          overflow: getComputedStyle(box).overflow,
          from: number?.getKeyframes()[0]?.transform ?? null,
          duration: number?.getTiming().duration ?? null,
          easing: number?.getTiming().easing ?? null,
        };
      })(),
    }));
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1', { timeout: 2_000 });
    const seen = await frames();
    const { grew, frames: count } = await stop();
    expect(grew).toEqual([]);
    expect(count).toBeGreaterThan(5);
    expect(seen.filter((f) => f.copies > 0).length).toBeGreaterThan(3);
    expect(Math.max(...seen.map((f) => f.copies))).toBe(1);
    const rolling = seen.filter((f) => f.overflow !== null);
    expect(rolling.length).toBeGreaterThan(3);
    for (const frame of rolling) {
      // It rolls inside its own box. Going up, the new number comes from below.
      expect(frame.overflow).toBe('clip');
      expect(frame.from).toBe('translateY(100%)');
      expect(frame.duration).toBe(ROLL_MS);
      expect(curve(String(frame.easing))).toBe(curve(DIALOG_CURVE));
    }

    // Plain: the number, as text, with nothing on it or around it.
    const rest = await cell(page, 'Late').evaluate((box) => ({
      text: box.textContent,
      children: box.children.length,
      boxStyle: box.getAttribute('style'),
      numberStyle: box.firstElementChild?.getAttribute('style') ?? null,
      animations: box.getAnimations({ subtree: true }).length,
    }));
    expect(rest).toEqual({ text: '1', children: 1, boxStyle: null, numberStyle: null, animations: 0 });

    // Going down, it comes from above.
    const down = await record(page, () => {
      const box = (window as unknown as { __chip: Element }).__chip.querySelector('[data-roll]')!;
      return (box.firstElementChild!.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]
        ?.transform;
    });
    await pollWith(page, lateFirst(0));
    await expect(cell(page, 'Late')).toHaveText('0');
    const ways = new Set((await down()).filter(Boolean));
    expect(ways).toEqual(new Set(['translateY(-100%)']));
  });

  test('a screen reader only ever gets the final number', async ({ page }) => {
    await openLong(page);
    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    const frames = await record(page, () => {
      const el = (window as unknown as { __chip: Element }).__chip;
      const copy = el.querySelector('[data-roll-copy]');
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return {
        spoken: clone.textContent,
        copyHidden: copy ? copy.getAttribute('aria-hidden') : 'none',
      };
    });
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1');
    await expect(page.getByRole('button', { name: /^Late\s*1$/ })).toBeVisible();
    const seen = await frames();
    expect([...new Set(seen.map((f) => f.spoken))]).toEqual(['Late0', 'Late1']);
    expect(seen.some((f) => f.copyHidden === 'true')).toBe(true);
    expect(seen.every((f) => f.copyHidden === 'true' || f.copyHidden === 'none')).toBe(true);
  });

  test('9 to 10: the chip beside it steps once, and nothing moves up or down', async ({ page }) => {
    await openLong(page);
    await pollWith(page, lateFirst(9));
    await expect(cell(page, 'Late')).toHaveText('9');
    await expect(page.locator(COPY)).toHaveCount(0);
    await quiet(page);

    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    await chip(page, 'At risk').evaluate((el) => {
      (window as unknown as { __next: Element }).__next = el;
    });
    const stop = await watchFrames(page);
    const frames = await record(page, () => {
      const w = window as unknown as { __chip: Element; __next: Element };
      const box = w.__chip.querySelector('[data-roll]')!.getBoundingClientRect();
      const chipBox = w.__chip.getBoundingClientRect();
      return {
        nextX: w.__next.getBoundingClientRect().x,
        top: box.top,
        height: box.height,
        chipTop: chipBox.top,
        chipHeight: chipBox.height,
      };
    });
    await pollWith(page, lateFirst(10));
    await expect(cell(page, 'Late')).toHaveText('10');
    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(new Set(seen.map((f) => f.nextX)).size).toBe(2);
    expect(new Set(seen.map((f) => f.chipTop)).size).toBe(1);
    expect(new Set(seen.map((f) => f.chipHeight)).size).toBe(1);
    expect(new Set(seen.map((f) => f.top)).size).toBe(1);
    expect(new Set(seen.map((f) => f.height)).size).toBe(1);
  });

  test('rapid polls: one old number at a time, and it ends on the last', async ({ page }) => {
    await openLong(page);
    const frames = await record(page, () => ({
      most: Math.max(
        0,
        ...[...document.querySelectorAll('[data-roll]')].map(
          (b) => b.querySelectorAll('[data-roll-copy]').length,
        ),
      ),
    }));
    for (const n of [1, 2, 3, 4, 5]) await pollWith(page, lateFirst(n));
    await expect(cell(page, 'Late')).toHaveText('5');
    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.most))).toBe(1);
    expect(await cell(page, 'Late').evaluate((b) => b.getAttribute('style'))).toBeNull();
  });

  test('nothing changed: nothing rolls, and the first paint never does', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __rolls: number };
      w.__rolls = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.hasAttribute('data-roll-copy')) w.__rolls += 1;
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
    await openLong(page);
    await pollWith(page, () => {});
    await quiet(page);
    expect(await page.evaluate(() => (window as unknown as { __rolls: number }).__rolls)).toBe(0);
  });

  test('a press holds it until it ends', async ({ page }) => {
    await openLong(page);
    const box = (await page.locator('[data-row-id]').first().boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 10);
    await page.mouse.down();
    await pollWith(page, lateFirst(1));
    const copy = page.locator(COPY).first();
    await copy.waitFor({ state: 'attached' });
    const time = () => copy.evaluate((el) => el.getAnimations()[0]!.currentTime as number);
    const first = await time();
    await page.waitForTimeout(ROLL_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator(COPY)).toHaveCount(0);
  });

  /** Counts every copy ever added, however briefly. */
  const countCopies = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __rolls: number };
      w.__rolls = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.hasAttribute('data-roll-copy')) w.__rolls += 1;
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
  const copiesEver = (page: Page) =>
    page.evaluate(() => (window as unknown as { __rolls: number }).__rolls);

  test('a tab in the background does not roll: it would play on the way back', async ({ page }) => {
    await countCopies(page);
    await openLong(page);
    await page.evaluate(() =>
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }),
    );
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1');
    expect(await copiesEver(page)).toBe(0);
  });

  test('on a phone, where the chips are not drawn, nothing rolls behind them', async ({ browser }) => {
    const { context, page } = await onPhone(browser, SIZES[3]!);
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await countCopies(page);
      await resetWorld({ extraTrucks: 5 });
      await page.goto('/');
      await page.locator('[data-count-tile="late"]').waitFor();
      await pollWith(page, lateFirst(1));
      await expect(page.locator('[data-count-tile="late"]')).toHaveAttribute('aria-label', 'Late, 1');
      expect(await copiesEver(page)).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('under reduced motion: the new number at once, and no second one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countCopies(page);
    await openLong(page);
    const frames = await record(page, () => document.querySelectorAll('[data-roll-copy]').length);
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1');
    await quiet(page);
    expect(await copiesEver(page)).toBe(0);
    expect(Math.max(...(await frames()))).toBe(0);
    expect(await cell(page, 'Late').evaluate((b) => b.getAnimations({ subtree: true }).length)).toBe(0);
  });

  test('the flash stays the strongest thing: the row keeps its 1.6s, the count only its cell', async ({ page }) => {
    await openLong(page);
    let changed = '';
    const firstRow = (rows: FleetRowLike[]) => {
      changed = rows[0]!.id;
      lateFirst(1)(rows);
    };
    await pollWith(page, firstRow);
    const first = page.locator(`[data-row-id="${changed}"]`);
    const before = (await first.boundingBox())!;
    const flash = first.locator('.animate-flash');
    await flash.waitFor({ state: 'attached' });
    const duration = await flash.evaluate(
      (el) => el.getAnimations()[0]!.effect!.getComputedTiming().duration,
    );
    expect(duration).toBe(FLASH_MS);
    expect(ROLL_MS).toBeLessThan(FLASH_MS / 4);
    // The poll that started it moved no row.
    expect((await first.boundingBox())!.y).toBe(before.y);
    // What rolls is 12px high inside a chip; what flashes is the whole row.
    const rolled = await cell(page, 'Late').boundingBox();
    expect(rolled!.height * rolled!.width).toBeLessThan((before.width * before.height) / 20);
  });

  test('the health strip: a real poll rolls the number that changed, and only it', async ({ page }) => {
    test.setTimeout(120_000);
    await resetWorld({ extraTrucks: 5, appointmentUtc: new Date() });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const strip = page.locator('[data-health-text]');
    const text = (await strip.textContent())!;
    const total = Number(/of (\d+) done/.exec(text)?.[1]);
    await page.route('**/api/health', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { onTime: number; remaining: number };
      body.onTime += 1;
      body.remaining -= 1;
      await route.fulfill({ response, json: body });
    });
    const stop = await watchFrames(page);
    const frames = await record(page, () =>
      [...document.querySelectorAll('[data-health-text] [data-roll]')]
        .filter((b) => b.querySelector('[data-roll-copy]'))
        .map((b) => b.getAttribute('data-roll')),
    );
    await expect(strip).toHaveText(new RegExp(`^1 of ${total} done`), { timeout: 70_000 });
    await expect(strip.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(seen.filter((f) => f.length > 0).length).toBeGreaterThan(3);
    expect(new Set(seen.flat())).toEqual(new Set(['1']));
    expect(await strip.locator('[data-roll]').first().evaluate((b) => b.getAttribute('style'))).toBeNull();
  });
});
