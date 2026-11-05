import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';
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
const PAGE_MS = 180;
const RISE_PX = 6;
const BAR_MS = 200;
const OPEN_MS = 300;
const OPEN_ROW_MS = 120;
const OPEN_GAP_MAX_MS = 20;
const SELECT_MS = 180;
const MAP_MS = 450;
const ZOOM_MS = 150;

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

/**
 * Every Web Animation the page starts, from before the page's own code runs: what it
 * moves and how. A test that something never played reads this, because a frame-by-frame
 * watch can miss what is over between two frames.
 */
const logAnimations = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __started: { from: string; duration: number; easing: string }[] };
    w.__started = [];
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const first = (Array.isArray(frames) ? frames[0] : null) as Keyframe | null;
      const timing = (typeof options === 'object' ? options : { duration: options }) as KeyframeAnimationOptions;
      w.__started.push({
        from: `${String(first?.['transform'] ?? '')}|${String(first?.['opacity'] ?? '')}`,
        duration: Number(timing.duration),
        easing: String(timing.easing ?? ''),
      });
      return real.call(this, frames, options);
    };
  });
const started = (page: Page) =>
  page.evaluate(() => (window as unknown as { __started: { from: string; duration: number; easing: string }[] }).__started);

test.describe('step 4, a page rises', () => {
  const RISE = `translateY(${RISE_PX}px)|0`;
  const rises = async (page: Page) => (await started(page)).filter((s) => s.from === RISE);
  /** The box the template mounts, and the page in it. */
  const riseFrame = () => {
    const box = document.querySelector('[data-page]');
    const inner = box?.firstElementChild;
    const running = inner
      ?.getAnimations()
      .some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation));
    return {
      running: Boolean(running),
      clip: box ? getComputedStyle(box).overflow : '',
      style: box?.getAttribute('style') ?? null,
      opacity: inner ? Number(getComputedStyle(inner).opacity) : 1,
      y: inner ? new DOMMatrixReadOnly(getComputedStyle(inner).transform).m42 : 0,
    };
  };
  const toBoardAndBack = async (page: Page) => {
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await quiet(page);
  };
  const backToBoard = async (page: Page) => {
    await page.keyboard.press('g');
    await page.keyboard.press('b');
  };
  /** The board is drawn and still rising. Checked on each frame, so it does not miss it. */
  const midRise = (page: Page) =>
    page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('[data-row-id]') &&
            document
              .querySelector('[data-page]')
              ?.firstElementChild?.getAnimations()
              .some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)),
        ),
      undefined,
      { polling: 'raf' },
    );

  test('a change of page: it fades and rises 6px in 180ms, and leaves nothing', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const stop = await watchFrames(page);
    const frames = await record(page, riseFrame);
    await toBoardAndBack(page);

    const seen = await frames();
    const { grew, frames: count } = await stop();
    expect(grew).toEqual([]);
    expect(count).toBeGreaterThan(5);
    const [only, ...more] = await rises(page);
    expect(more).toEqual([]);
    expect(only!.duration).toBe(PAGE_MS);
    expect(curve(only!.easing)).toBe(curve(DIALOG_CURVE));

    const rising = seen.filter((f) => f.running);
    expect(rising.length).toBeGreaterThan(2);
    // The box clips for as long as it rises, or 6px of page below the screen scrolls.
    expect(new Set(rising.map((f) => f.clip))).toEqual(new Set(['clip']));
    for (const f of rising) {
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(RISE_PX);
    }
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ running: false, style: null, opacity: 1, y: 0 });
    expect(await page.locator('[data-page]').evaluate((b) => b.firstElementChild!.getAttribute('style'))).toBeNull();
    await expect.poll(() => stillMoving(page)).toBe(0);
  });

  test('the two links that change page rise too: Assignments, and Driver history', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await page.getByRole('link', { name: 'Assignments' }).click();
    await page.waitForURL('**/assignments');
    await expect.poll(async () => (await rises(page)).length).toBe(1);

    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    expect(await rises(page)).toEqual([]);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.locator('[data-menu-history]').click();
    await page.waitForURL('**/history**');
    await expect.poll(async () => (await rises(page)).length).toBe(1);
  });

  test('the first page of a load does not rise', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(await rises(page)).toEqual([]);
    await page.reload();
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(await rises(page)).toEqual([]);
  });

  test('?truck=, a search, a poll and a refetch never replay it, and never remount the board or the map', async ({ page }) => {
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    await page.locator('.mapboxgl-canvas').first().waitFor();
    await quiet(page);
    await page.evaluate(() => {
      const mark = (el: Element | null) => {
        (el as unknown as { __kept: boolean }).__kept = true;
      };
      mark(document.querySelector('[data-page]'));
      mark(document.querySelector('[data-row-id]')!.closest('.overflow-y-auto'));
      mark(document.querySelector('.mapboxgl-canvas'));
    });
    const kept = () =>
      page.evaluate(() =>
        ['[data-page]', '.overflow-y-auto', '.mapboxgl-canvas'].map(
          (s) => (document.querySelector(s) as unknown as { __kept?: boolean } | null)?.__kept === true,
        ),
      );

    await row.click();
    await page.waitForURL(/[?&]truck=/);
    expect(await kept()).toEqual([true, true, true]);

    await pollWith(page, lateFirst(1));
    await quiet(page);
    expect(await kept()).toEqual([true, true, true]);

    await page.keyboard.press('/');
    await page.keyboard.type('10');
    await page.waitForURL(/[?&]q=10/);
    await quiet(page);
    expect(await kept()).toEqual([true, true, true]);

    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await quiet(page);
    expect(await kept()).toEqual([true, true, true]);
    expect(await rises(page)).toEqual([]);
  });

  test('a popover opened mid-rise lands where it does at rest', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const scope = page.locator('[data-scope] [aria-haspopup="menu"]');
    const menu = page.locator('[data-views-menu]');
    const box = (await scope.boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + 8);
    await quiet(page);
    await page.mouse.down();
    await page.mouse.up();
    await menu.waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const atRest = (await menu.boundingBox())!;
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await toBoardAndBack(page);
    // The pointer is already on the button, so the press lands in the rise.
    await page.evaluate(() => {
      const w = window as unknown as { __riseAtPress: boolean | null };
      w.__riseAtPress = null;
      window.addEventListener(
        'pointerdown',
        () => {
          w.__riseAtPress = Boolean(
            document
              .querySelector('[data-page]')
              ?.firstElementChild?.getAnimations()
              .some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)),
          );
        },
        { capture: true, once: true },
      );
    });
    await backToBoard(page);
    await midRise(page);
    await page.mouse.down();
    await page.mouse.up();
    await menu.waitFor();
    expect(await page.evaluate(() => (window as unknown as { __riseAtPress: boolean }).__riseAtPress)).toBe(true);
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await menu.boundingBox()).toEqual(atRest);
  });

  test('a key opens one mid-rise: V, and it lands where it does at rest', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const menu = page.locator('[data-views-menu]');
    await page.keyboard.press('v');
    await menu.waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const atRest = (await menu.boundingBox())!;
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await toBoardAndBack(page);
    await backToBoard(page);
    await midRise(page);
    await page.keyboard.press('v');
    await menu.waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await menu.boundingBox()).toEqual(atRest);
  });

  test('a window opened mid-rise fills the screen from its first frame', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    await row.click();
    await quiet(page);
    await toBoardAndBack(page);
    await backToBoard(page);
    await midRise(page);
    const frames = await record(page, () => {
      const scrim = document.querySelector('[aria-modal="true"]');
      if (!scrim) return null;
      const r = scrim.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    });
    await page.keyboard.press('Enter');
    await page.locator('[aria-modal="true"]').first().waitFor();
    await quiet(page);
    const viewport = page.viewportSize()!;
    const seen = (await frames()).filter((f) => f !== null);
    expect(seen.length).toBeGreaterThan(3);
    for (const f of seen) {
      expect(f).toEqual({ top: 0, left: 0, width: viewport.width, height: viewport.height });
    }
  });

  test('a press in the rise holds it, and the row under the pointer is the row selected', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    const box = (await row.boundingBox())!;
    await quiet(page);
    await toBoardAndBack(page);
    await page.mouse.move(box.x + 300, box.y + box.height / 2);
    await backToBoard(page);
    await midRise(page);
    await page.mouse.down();
    const time = () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-page]')
            ?.firstElementChild?.getAnimations()
            .find((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation))?.currentTime ?? null,
      );
    const first = await time();
    expect(first).not.toBeNull();
    await page.waitForTimeout(PAGE_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator('[data-row-id]').first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => stillMoving(page)).toBe(0);
  });

  test('Reload still asks with typed work, Discard still closes, and only then does a key change page', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    await row.click();
    await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: /^(Edit|New) load for truck/ });
    await modal.waitFor();
    await modal.getByLabel('Load number').fill('TYPED');

    const asked = page.waitForEvent('dialog');
    void page.reload().catch(() => {});
    const stay = await asked;
    expect(stay.type()).toBe('beforeunload');
    await stay.dismiss();
    await expect(modal.getByLabel('Load number')).toHaveValue('TYPED');

    // Focus on a button, where the keys reach the window's guard: no page change.
    await modal.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await quiet(page);
    expect(await rises(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(modal).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await expect.poll(async () => (await rises(page)).length).toBe(1);
  });

  test('under reduced motion: no rise, and the page is there at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, riseFrame);
    await toBoardAndBack(page);
    expect((await frames()).some((f) => f.running)).toBe(false);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 4, the bulk bar comes up into its slot', () => {
  const BAR_FROM = 'translateY(100%)|';
  const bar = (page: Page) => page.locator('.bg-surface-bar button', { hasText: /^Clear/ });
  const footer = (page: Page) => page.getByText(/^Showing/);
  const COPY = '[data-bar-copy]';

  async function openBoard(page: Page) {
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
  }
  const boxes = (page: Page) => page.locator('[data-row-id] input[type="checkbox"]');
  /** A real press on each of two rows' checkboxes. */
  async function checkTwo(page: Page) {
    for (const i of [0, 1]) {
      const b = (await boxes(page).nth(i).boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
  }
  const barFrame = () => {
    const button = [...document.querySelectorAll('.bg-surface-bar button')].find(
      (b) => b.textContent?.trim().startsWith('Clear') && !b.closest('[data-bar-copy]'),
    );
    const real = button?.closest('.bg-surface-bar');
    const slot = real?.parentElement;
    const copy = document.querySelector('[data-bar-copy]');
    return {
      open: Boolean(real),
      y: real ? new DOMMatrixReadOnly(getComputedStyle(real).transform).m42 : null,
      clip: slot ? getComputedStyle(slot).overflow : null,
      copies: document.querySelectorAll('[data-bar-copy]').length,
      copyY: copy?.firstElementChild
        ? new DOMMatrixReadOnly(getComputedStyle(copy.firstElementChild).transform).m42
        : null,
      footer: [...document.querySelectorAll('span, div')].some((n) =>
        n.textContent?.trim().startsWith('Showing'),
      ),
    };
  };

  test('opening: 200ms on the curve, inside its slot, and nothing left', async ({ page }) => {
    await logAnimations(page);
    await openBoard(page);
    const stop = await watchFrames(page);
    const frames = await record(page, barFrame);
    await checkTwo(page);
    await bar(page).waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    const moved = (await started(page)).filter((s) => s.from === BAR_FROM);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.duration).toBe(BAR_MS);
    expect(curve(moved[0]!.easing)).toBe(curve(DIALOG_CURVE));
    const flying = seen.filter((f) => f.open && f.y !== 0);
    expect(flying.length).toBeGreaterThan(2);
    expect(new Set(flying.map((f) => f.clip))).toEqual(new Set(['clip']));
    for (let i = 1; i < flying.length; i += 1) {
      expect(flying[i]!.y!).toBeLessThanOrEqual(flying[i - 1]!.y!);
    }
    const rest = await bar(page).evaluate((b) => {
      const real = b.closest('.bg-surface-bar')!;
      return {
        transform: getComputedStyle(real).transform,
        animations: real.getAnimations().length,
        slotStyle: real.parentElement!.getAttribute('style'),
        barStyle: real.getAttribute('style'),
      };
    });
    expect(rest).toEqual({ transform: 'none', animations: 0, slotStyle: null, barStyle: null });
  });

  test('its buttons work while it is still moving', async ({ page }) => {
    await openBoard(page);
    // Where the button rests, which is where a person is already aiming.
    await checkTwo(page);
    await bar(page).waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const rest = (await bar(page).boundingBox())!;
    await bar(page).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator(COPY)).toHaveCount(0);
    await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);

    // The bar is open again by keys, so the pointer has not moved.
    for (const key of ['ArrowDown', 'x', 'ArrowDown', 'x']) await page.keyboard.press(key);
    await page.waitForFunction(
      () => {
        const clear = [...document.querySelectorAll('.bg-surface-bar button')].find((b) =>
          b.textContent?.trim().startsWith('Clear'),
        );
        const real = clear?.closest('.bg-surface-bar');
        if (!real || real.getAnimations().length === 0) return false;
        // The button has reached the pointer, and the bar has further to go.
        const y = new DOMMatrixReadOnly(getComputedStyle(real).transform).m42;
        return y > 0 && y <= 8;
      },
      undefined,
      { polling: 'raf' },
    );
    await page.mouse.down();
    const moving = await bar(page).evaluate((el) => el.closest('.bg-surface-bar')!.getAnimations().length);
    await page.mouse.up();
    expect(moving).toBe(1);
    await expect(boxes(page).first()).not.toBeChecked();
    await expect(footer(page)).toBeVisible();
  });

  test('closing never waits: the footer is back at once, and a copy nothing can use slides away', async ({ page }) => {
    await openBoard(page);
    await checkTwo(page);
    await bar(page).waitFor();
    await quiet(page);
    const stop = await watchFrames(page);
    const frames = await record(page, barFrame);
    const b = (await bar(page).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(footer(page)).toBeVisible();

    // The copy, while it is there: nothing can find it, press it or read it.
    const facts = await page.locator(COPY).evaluate((holder) => {
      const everything = [holder, ...holder.querySelectorAll('*')];
      const r = holder.getBoundingClientRect();
      return {
        inert: holder.hasAttribute('inert'),
        hidden: holder.getAttribute('aria-hidden'),
        pointer: getComputedStyle(holder).pointerEvents,
        overflow: getComputedStyle(holder).overflow,
        position: getComputedStyle(holder).position,
        identity: everything.flatMap((n) =>
          [...n.attributes]
            .map((a) => a.name)
            .filter((a) => /^(id|name|role|tabindex|aria-(?!hidden)|data-(?!bar-copy))/.test(a)),
        ),
        height: r.height,
        hit: document.elementFromPoint(r.x + 40, r.y + 15)?.closest('[data-bar-copy]') !== null,
      };
    });
    expect(facts).toEqual({
      inert: true,
      hidden: 'true',
      pointer: 'none',
      overflow: 'clip',
      position: 'fixed',
      identity: [],
      height: 30,
      hit: false,
    });

    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(Math.max(...seen.map((f) => f.copies))).toBe(1);
    // In the same frame the bar went, the footer was there.
    const firstClosed = seen.findIndex((f) => !f.open);
    expect(seen[firstClosed]!.footer).toBe(true);
    expect(await page.evaluate(() => document.querySelectorAll('[data-bar-copy]').length)).toBe(0);
  });

  test('closed halfway up, the copy leaves from where the bar was drawn', async ({ page }) => {
    await openBoard(page);
    const frames = await record(page, barFrame);
    await checkTwo(page);
    // In the page, on the frame the bar is partway up, so it is really on its way.
    const closedAt = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const tick = () => {
            const clear = [...document.querySelectorAll<HTMLElement>('.bg-surface-bar button')].find(
              (b) => b.textContent?.trim().startsWith('Clear'),
            );
            const real = clear?.closest('.bg-surface-bar');
            const y = real ? new DOMMatrixReadOnly(getComputedStyle(real).transform).m42 : null;
            if (!clear || y === null || y > 25) {
              requestAnimationFrame(tick);
              return;
            }
            if (y === 0) throw new Error('The bar had already landed.');
            clear.click();
            done(y);
          };
          tick();
        }),
    );
    expect(closedAt).toBeGreaterThan(0);
    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const firstCopy = seen.find((f) => f.copyY !== null)!;
    // Up to one frame's travel below where it was: not back at its resting place, and
    // not all the way out of the slot.
    expect(firstCopy.copyY!).toBeGreaterThanOrEqual(closedAt - 0.01);
    expect(firstCopy.copyY!).toBeLessThan(closedAt + 30 * 0.4);
  });

  test('opening again takes the copy away at once', async ({ page }) => {
    await openBoard(page);
    await checkTwo(page);
    await bar(page).waitFor();
    await quiet(page);
    const frames = await record(page, barFrame);
    // Esc clears the checks, and a shift-free X on each row is too slow here: by hand.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const clear = [...document.querySelectorAll<HTMLElement>('.bg-surface-bar button')].find((b) =>
            b.textContent?.trim().startsWith('Clear'),
          )!;
          clear.click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const [one, two] = document.querySelectorAll<HTMLInputElement>('[data-row-id] input[type="checkbox"]');
              one!.click();
              two!.click();
              done();
            }),
          );
        }),
    );
    await bar(page).waitFor();
    await quiet(page);
    const seen = await frames();
    expect(seen.some((f) => f.copies === 1)).toBe(true);
    const reopened = seen.findIndex((f, i) => i > 0 && f.open && !seen[i - 1]!.open);
    expect(reopened).toBeGreaterThan(0);
    expect(seen.slice(reopened).every((f) => f.copies === 0)).toBe(true);
  });

  test('under reduced motion: no slide and no copy', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await openBoard(page);
    const frames = await record(page, barFrame);
    await checkTwo(page);
    await bar(page).waitFor();
    const b = (await bar(page).boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(footer(page)).toBeVisible();
    await quiet(page);
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.copies))).toBe(0);
    expect(seen.every((f) => f.y === null || f.y === 0)).toBe(true);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 5, the board opens once per page load', () => {
  /** Rows draw in, one after the other: opacity only, linear. */
  const OPENING = '|0';
  const openings = async (page: Page) =>
    (await started(page)).filter((s) => s.from === OPENING && s.duration === OPEN_ROW_MS);

  const rowsInView = (page: Page) =>
    page.evaluate(() => {
      const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
      const view = scroller.getBoundingClientRect();
      return [...document.querySelectorAll('[data-row-id]')].filter((r) => {
        const box = r.getBoundingClientRect();
        return box.bottom > view.top && box.top < view.bottom;
      }).length;
    });

  const logDelays = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __delays: number[] };
      w.__delays = [];
      const real = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        if (typeof options === 'object' && options.fill === 'backwards') {
          w.__delays.push(Number(options.delay ?? 0));
        }
        return real.call(this, frames, options);
      };
    });
  const delays = (page: Page) =>
    page.evaluate(() => (window as unknown as { __delays: number[] }).__delays);

  test('a long board: every row in view, 300ms in all, opacity only and linear', async ({ page }) => {
    await logAnimations(page);
    await logDelays(page);
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    const frames = await record(page, () =>
      [...document.querySelectorAll('[data-row-id]')].some(
        (r) => r.parentElement!.getAnimations().length > 0,
      ),
    );
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    expect(await frames()).toContain(false);

    const inView = await rowsInView(page);
    const theirs = await openings(page);
    expect(theirs.length).toBe(inView);
    expect(new Set(theirs.map((t) => t.duration))).toEqual(new Set([OPEN_ROW_MS]));
    expect(new Set(theirs.map((t) => t.easing))).toEqual(new Set(['linear']));
    const gaps = await delays(page);
    expect(gaps).toHaveLength(inView);
    expect(gaps[0]).toBe(0);
    // All of it in 300ms: the last row's start, and its own 120ms.
    expect(gaps.at(-1)! + OPEN_ROW_MS).toBeCloseTo(OPEN_MS, 5);
    expect(gaps[1]! - gaps[0]!).toBeLessThanOrEqual(OPEN_GAP_MAX_MS);

    // Nothing left on a row: only what the list itself wrote.
    const rest = await page.evaluate(() =>
      [...document.querySelectorAll('[data-row-id]')].map((r) => ({
        animations: r.parentElement!.getAnimations().length,
        opacity: (r.parentElement as HTMLElement).style.opacity,
      })),
    );
    for (const row of rest) expect(row).toEqual({ animations: 0, opacity: '' });
  });

  test('a short board: the gap has a ceiling, so three rows do not take 300ms', async ({ page }) => {
    await logDelays(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => delays(page)).toEqual([0, OPEN_GAP_MAX_MS, OPEN_GAP_MAX_MS * 2]);
  });

  test('a click on the first frame selects: nothing waits for it', async ({ page }) => {
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/');
    // One of the last to draw in, so it is still on its way when the press arrives.
    const row = page.locator('[data-row-id]').nth(17);
    await row.waitFor();
    await quiet(page);
    const box = (await row.boundingBox())!;
    const id = await row.getAttribute('data-row-id');
    await page.mouse.move(box.x + 300, box.y + box.height / 2);

    await page.addInitScript(() => {
      /*
       * A page load keeps the main thread busy, so a real press can arrive after 300ms have
       * gone. The opening is stretched for this one test, so the press is sure to land
       * inside it. Whether a click lands does not depend on how long the fade is.
       */
      const real = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        return real.call(
          this,
          frames,
          typeof options === 'object' && options.fill === 'backwards'
            ? { ...options, duration: Number(options.duration) * 40, delay: Number(options.delay) * 40 }
            : options,
        );
      };
      window.addEventListener(
        'pointerdown',
        (event) => {
          const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-row-id]');
          const wrapper = hit?.parentElement;
          (window as unknown as { __press: unknown }).__press = {
            id: hit?.getAttribute('data-row-id') ?? null,
            opacity: wrapper ? Number(getComputedStyle(wrapper).opacity) : null,
            moving: wrapper ? wrapper.getAnimations().length : null,
          };
        },
        { capture: true, once: true },
      );
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(
      (rowId) => document.querySelector(`[data-row-id="${rowId}"]`)?.parentElement?.getAnimations().length,
      id,
      { polling: 'raf' },
    );
    await page.mouse.down();
    await page.mouse.up();
    const press = await page.evaluate(
      () => (window as unknown as { __press: { id: string; opacity: number; moving: number } }).__press,
    );
    expect(press.id).toBe(id);
    expect(press.moving).toBe(1);
    expect(press.opacity).toBeLessThan(1);
    await expect(page.locator(`[data-row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  });

  test('never again: not on a page change, a chip, a refetch or a poll', async ({ page }) => {
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const once = (await openings(page)).length;
    expect(once).toBeGreaterThan(0);

    await pollWith(page, lateFirst(2));
    await quiet(page);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await quiet(page);
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    await page.keyboard.press('1');
    await quiet(page);
    await page.keyboard.press('0');
    await quiet(page);
    await pollWith(page, lateFirst(3));
    await quiet(page);
    expect((await openings(page)).length).toBe(once);
  });

  test('rows that only arrive after a fetch take it, once', async ({ page }) => {
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/?chips=late');
    // Nothing late, so nothing to draw: the opening is still to come.
    await page.getByText('No trucks in this filter').first().waitFor();
    await quiet(page);
    expect(await openings(page)).toEqual([]);

    await pollWith(page, lateFirst(3));
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(async () => (await openings(page)).length).toBe(3);
    await quiet(page);

    await pollWith(page, lateFirst(4));
    await quiet(page);
    expect((await openings(page)).length).toBe(3);
  });

  test('the server and the first client render are the same: no hydration complaint', async ({ page }) => {
    const complaints: string[] = [];
    page.on('pageerror', (e) => complaints.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /hydrat|#418|#423|#425/i.test(m.text())) complaints.push(m.text());
    });
    await resetWorld({ extraTrucks: 5 });
    const html = await (await page.goto('/'))!.text();
    expect(html).not.toMatch(/opacity:\s*0/);
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(complaints).toEqual([]);
  });

  test('nothing grows while it plays', async ({ page }) => {
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('body').waitFor();
    const stop = await watchFrames(page);
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const { grew } = await stop();
    expect(grew).toEqual([]);
  });

  test('under reduced motion: the rows are simply there', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 6, the selection slides', () => {
  const OVERLAY = '[data-selection-slide]';
  const rowAt = (page: Page, i: number) => page.locator('[data-row-id]').nth(i);

  async function openLong(page: Page) {
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
  }
  const frame = () => {
    const found = [...document.querySelectorAll('[data-selection-slide]')];
    const target = document.querySelector('[data-selection-target]');
    const selected = document.querySelector('[data-row-id][aria-selected="true"]');
    return {
      at: performance.now(),
      count: found.length,
      y: found[0]?.getBoundingClientRect().y ?? null,
      height: found[0]?.getBoundingClientRect().height ?? null,
      target: target ? getComputedStyle(target).backgroundColor : null,
      selected: selected ? getComputedStyle(selected).backgroundColor : null,
      leftOn: selected?.getAttribute('data-row-id') ?? null,
      selectedY: selected?.getBoundingClientRect().y ?? null,
    };
  };
  const SELECTED_GROUND = 'rgb(27, 34, 43)';
  const midpoint = async (page: Page, i: number) => {
    const b = (await rowAt(page, i).boundingBox())!;
    return [b.x + 300, b.y + b.height / 2] as const;
  };

  test('from one row to another: 180ms, on the curve, under the words, and nothing left', async ({ page }) => {
    await openLong(page);
    const [x1, y1] = await midpoint(page, 2);
    await page.mouse.click(x1, y1);
    await expect(rowAt(page, 2)).toHaveAttribute('aria-selected', 'true');
    await quiet(page);

    const stop = await watchFrames(page);
    const frames = await record(page, frame);
    const [x2, y2] = await midpoint(page, 8);
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    await page.mouse.up();
    const timing = await page
      .locator(OVERLAY)
      .evaluate((el) => {
        const t = el.getAnimations()[0]!.effect!.getTiming();
        return { duration: t.duration, easing: String(t.easing) };
      });
    expect(timing.duration).toBe(SELECT_MS);
    expect(curve(timing.easing)).toBe(curve(DIALOG_CURVE));
    await expect(rowAt(page, 8)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);

    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    const flying = seen.filter((f) => f.count === 1);
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    expect(flying.length).toBeGreaterThan(3);
    for (let i = 1; i < flying.length; i += 1) {
      // Down the list, and never back.
      expect(flying[i]!.y!).toBeGreaterThanOrEqual(flying[i - 1]!.y!);
    }
    // It arrives on the row: its last frame is within a few pixels of it, and level with it.
    const landed = (await rowAt(page, 8).boundingBox())!;
    expect(Math.abs(flying.at(-1)!.y! - landed.y)).toBeLessThan(6);
    expect(flying.at(-1)!.height).toBeCloseTo(landed.height, 1);
    // The row it is going to keeps its ground back until it lands, so it is seen once.
    expect(new Set(flying.map((f) => f.target))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
    expect(await rowAt(page, 8).getAttribute('data-selection-target')).toBeNull();
    expect(await rowAt(page, 8).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SELECTED_GROUND);
    // The row it left has its ground off on the frame the slide begins: not a 120ms fade.
    expect(
      await rowAt(page, 2).evaluate((el) => el.getAnimations().filter((a) => a instanceof CSSTransition).length),
    ).toBe(0);
  });

  test('the one it left is plain on the first frame of the slide, not fading beside it', async ({ page }) => {
    await openLong(page);
    const id = await rowAt(page, 2).getAttribute('data-row-id');
    await rowAt(page, 2).click();
    await quiet(page);
    await page.mouse.move(1, 1);
    await quiet(page);
    await page.evaluate((rowId) => {
      (window as unknown as { __old: Element }).__old = document.querySelector(`[data-row-id="${rowId}"]`)!;
    }, id);
    const frames = await record(page, () => {
      const old = (window as unknown as { __old: Element }).__old;
      return {
        flying: document.querySelectorAll('[data-selection-slide]').length,
        ground: getComputedStyle(old).backgroundColor,
      };
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const seen = (await frames()).filter((f) => f.flying > 0);
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen.map((f) => f.ground))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
  });

  test('fast arrow keys: one highlight, no jump, and it ends on the last row', async ({ page }) => {
    await openLong(page);
    await rowAt(page, 0).click();
    await quiet(page);
    const frames = await record(page, frame);
    // A key on every frame, in the page, so each lands long before the last has arrived.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          let left = 6;
          const next = () => {
            if (left === 0) return done();
            left -= 1;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            requestAnimationFrame(next);
          };
          next();
        }),
    );
    await expect(rowAt(page, 6)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    const flying = seen.filter((f) => f.y !== null);
    const ys = flying.map((f) => f.y!);
    expect(ys.length).toBeGreaterThan(3);
    for (let i = 1; i < flying.length; i += 1) {
      // A long frame covers more ground: each key does work beyond the highlight.
      const frames = Math.max(1, (flying[i]!.at - flying[i - 1]!.at) / (1000 / 60));
      expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeLessThan(60 * frames);
    }
    // Taken up from where it is drawn, it falls behind keys this fast. Taken up from the row
    // it was last going to, it would never be more than a row behind the selected one.
    const behind = flying.map((f) => f.selectedY! - f.y!);
    expect(Math.max(...behind)).toBeGreaterThan(44 * 1.5);
  });

  test('the last row on the screen and one more: it slides, the list follows, and nothing grows', async ({ page }) => {
    await openLong(page);
    const inView = await page.evaluate(() => {
      const view = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.getBoundingClientRect();
      return [...document.querySelectorAll('[data-row-id]')].filter((r) => r.getBoundingClientRect().bottom <= view.bottom).length;
    });
    await rowAt(page, inView - 1).click();
    await quiet(page);
    const id = await rowAt(page, inView).getAttribute('data-row-id');
    const stop = await watchFrames(page);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`[data-row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const { grew } = await stop();
    expect(grew).toEqual([]);
  });

  test('the old row off screen: the highlight just appears', async ({ page }) => {
    await openLong(page);
    await rowAt(page, 0).click();
    await quiet(page);
    // Past the top of the view and still drawn, since the list draws a few beyond it: a row
    // not drawn at all would not tell this apart from having nowhere to come from.
    await page.evaluate(() => {
      document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.scrollTop = 200;
    });
    await quiet(page);
    await expect(rowAt(page, 0)).toHaveAttribute('aria-selected', 'true');
    const target = page.locator('[data-row-id]').nth(12);
    const frames = await record(page, frame);
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await quiet(page);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(0);
  });

  test('nothing selected before, or nothing after: no slide', async ({ page }) => {
    await openLong(page);
    const frames = await record(page, frame);
    await rowAt(page, 3).click();
    await quiet(page);
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-row-id][aria-selected="true"]')).toHaveCount(0);
    await quiet(page);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(0);
  });

  test('pinned rows slide too: into the list, out of it, and between themselves', async ({ page }) => {
    await openLong(page);
    for (const i of [1, 2]) {
      await rowAt(page, i).click();
      await page.keyboard.press('p');
    }
    await expect(page.getByText(/^Pinned$/)).toBeVisible();
    await quiet(page);
    // The two pinned rows draw first, above the list.
    const frames = await record(page, frame);
    const first = page.locator('[data-row-id]').nth(0);
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const inList = page.locator('[data-row-id]').nth(6);
    await inList.click();
    await expect(inList).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const seen = await frames();
    // Each of the three moves was seen flying, as one highlight.
    expect(seen.filter((f) => f.count === 1).length).toBeGreaterThan(6);
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    await expect(first).not.toHaveAttribute('data-selection-target', '');
    expect(await first.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SELECTED_GROUND);
  });

  test('a press holds it until it ends', async ({ page }) => {
    await openLong(page);
    await rowAt(page, 0).click();
    await quiet(page);
    await page.keyboard.press('ArrowDown');
    await page.mouse.move(600, 12);
    await page.mouse.down();
    const time = () => page.locator(OVERLAY).evaluate((el) => el.getAnimations()[0]!.currentTime as number);
    const first = await time();
    await page.waitForTimeout(SELECT_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('under reduced motion: no slide, and the selection is at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await rowAt(page, 0).click();
    await rowAt(page, 3).click();
    await expect(rowAt(page, 3)).toHaveAttribute('aria-selected', 'true');
    await quiet(page);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 6, the map travels', () => {
  type MapCall = {
    at: number;
    name: 'easeTo' | 'panBy' | 'stop' | 'moveend';
    center?: [number, number];
    duration?: number;
    easing?: string;
  };
  /** Far apart, so a truck is not already in view and a pan has somewhere to go. */
  const spread = (rows: (FleetRowLike & { lat?: number; lng?: number })[]) => {
    rows.forEach((row, i) => {
      row.lat = 30 + (i % 8) * 2.2;
      row.lng = -115 + i * 3.1;
    });
  };

  /**
   * The real map, found through React, with what is asked of it written down. Only here:
   * a pan's length and curve are arguments, and the pixels of a popup that snaps to whole
   * pixels near the end of a pan say much less about them.
   */
  const spyOnMap = (page: Page) =>
    page.evaluate(() => {
      type Spied = {
        getCenter(): { lat: number; lng: number };
        on(type: string, listener: () => void): void;
      } & Record<string, unknown>;
      const el = document.querySelector('.mapboxgl-map') as unknown as Record<string, unknown>;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'))!;
      type Fiber = { memoizedState: Hook | null; return: Fiber | null };
      type Hook = { memoizedState: unknown; next: Hook | null };
      let fiber = el[key] as Fiber | null;
      let map: Spied | null = null;
      while (fiber && !map) {
        let hook = fiber.memoizedState;
        while (hook && !map) {
          const held = hook.memoizedState as { current?: unknown; map?: unknown } | null;
          const value = (held?.current ?? held) as { getMap?: () => Spied; map?: Spied } | null;
          if (typeof value?.getMap === 'function') map = value.getMap();
          else if (value?.map && typeof (value.map as Spied)['easeTo'] === 'function') map = value.map;
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      if (!map) throw new Error('No map found');
      const w = window as unknown as { __calls: MapCall[] };
      w.__calls = [];
      for (const name of ['easeTo', 'panBy', 'stop'] as const) {
        const real = map[name] as (...args: unknown[]) => unknown;
        map[name] = function (this: unknown, ...args: unknown[]) {
          const options = (name === 'panBy' ? args[1] : args[0]) as
            | { center?: [number, number]; duration?: number; easing?: unknown }
            | undefined;
          // A panBy goes through easeTo: only what the app asked for counts.
          const inner = (window as unknown as { __inPan?: boolean }).__inPan === true;
          if (!(inner && name === 'easeTo')) {
            w.__calls.push({
              at: performance.now(),
              name,
              ...(Array.isArray(options?.center) ? { center: options.center } : {}),
              ...(options?.duration === undefined ? {} : { duration: options.duration }),
              easing: typeof options?.easing,
            });
          }
          if (name === 'panBy') (window as unknown as { __inPan?: boolean }).__inPan = true;
          try {
            return real.apply(this, args);
          } finally {
            if (name === 'panBy') (window as unknown as { __inPan?: boolean }).__inPan = false;
          }
        };
      }
      const spied = map;
      map.on('moveend', () => {
        const c = spied.getCenter();
        w.__calls.push({ at: performance.now(), name: 'moveend', center: [c.lng, c.lat] });
      });
    });
  const calls = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { __calls: MapCall[] };
      const seen = w.__calls;
      w.__calls = [];
      return seen;
    });
  const clearCalls = calls;

  /** Further apart than a popup is wide, so a popup in flight is often off the map. */
  const farApart = (rows: (FleetRowLike & { lat?: number; lng?: number })[]) => {
    rows.forEach((row, i) => {
      row.lat = 25 + (i % 2) * 22;
      row.lng = -150 + i * 17;
    });
  };

  async function openSpread(page: Page, place: typeof spread = spread) {
    await resetWorld({ extraTrucks: 12 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await page.locator('canvas.mapboxgl-canvas').waitFor();
    await pollWith(page, place);
    await quiet(page);
    await spyOnMap(page);
  }
  const selectAndLand = async (page: Page, i: number) => {
    await page.locator('[data-row-id]').nth(i).click();
    await expect.poll(async () => (await page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'moveend'))), { timeout: 5_000 }).toBe(true);
    await page.waitForTimeout(ZOOM_MS + 150);
    await quiet(page);
  };
  /** What the selection asked for, and where the map was when that pan ended. */
  const travelIn = (seen: MapCall[]) => {
    const ease = seen.find((c) => c.name === 'easeTo')!;
    const end = seen.find((c) => c.name === 'moveend' && c.at > ease.at)!;
    // `stop` is Mapbox's own, at the end of every ease.
    return {
      ease,
      end,
      between: seen.filter((c) => c.at > ease.at && c.at < end.at && c.name !== 'stop'),
    };
  };

  test('a selection takes 450ms on the default curve, and ends on the truck', async ({ page }) => {
    await openSpread(page);
    await selectAndLand(page, 3);
    await clearCalls(page);
    await page.locator('[data-row-id]').nth(9).click();
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'moveend'))).toBe(true);
    const { ease, end, between } = travelIn(await calls(page));
    expect(ease.duration).toBe(MAP_MS);
    expect(ease.easing).toBe('undefined');
    expect(between).toEqual([]);
    expect(end.at - ease.at).toBeGreaterThan(MAP_MS - 60);
    expect(end.at - ease.at).toBeLessThan(MAP_MS + 150);
    expect(end.center![0]).toBeCloseTo(ease.center![0], 3);
    expect(end.center![1]).toBeCloseTo(ease.center![1], 3);
  });

  /**
   * Found by this phase. The popup's ResizeObserver asks for the nudge too, and a new truck
   * usually has a popup of another height. So 28ms into the pan a panBy cancelled it, and
   * the map stopped 15 degrees short of the truck.
   */
  test('a popup that changes height on the way does not stop the pan', async ({ page }) => {
    await openSpread(page);
    // Truck 103 has a tall popup and 205 a short one: the case that was seen to fail.
    await selectAndLand(page, 0);
    const tall = (await page.locator('.ft-popup').boundingBox())!.height;
    await clearCalls(page);
    await page.locator('[data-row-id]').nth(6).click();
    await expect.poll(async () => (await page.locator('.ft-popup').boundingBox())!.height).not.toBe(tall);
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'moveend'))).toBe(true);
    const { ease, end, between } = travelIn(await calls(page));
    expect(between).toEqual([]);
    expect(end.center![0]).toBeCloseTo(ease.center![0], 3);
    expect(end.center![1]).toBeCloseTo(ease.center![1], 3);
  });

  test('the other pans keep their 150ms: a zoom, and the nudge that clears a popup', async ({ page }) => {
    await openSpread(page);
    await selectAndLand(page, 0);
    // Truck 103's popup is taller than the room above it, so it is nudged as it lands.
    const nudges = (await calls(page)).filter((c) => c.name === 'panBy');
    expect(nudges.length).toBeGreaterThan(0);
    expect(new Set(nudges.map((c) => c.duration))).toEqual(new Set([ZOOM_MS]));

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'easeTo'))).toBe(true);
    const zoom = (await calls(page)).find((c) => c.name === 'easeTo')!;
    expect(zoom.duration).toBe(ZOOM_MS);
  });

  test('fast arrow keys: no pile-up, and the map ends on the last row', async ({ page }) => {
    await openSpread(page, farApart);
    await selectAndLand(page, 4);
    await clearCalls(page);
    // Faster than a pan, so each key arrives in the middle of the last one's travel.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    await expect(page.locator('[data-row-id]').nth(10)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(MAP_MS + 300);
    const seen = await calls(page);
    const eases = seen.filter((c) => c.name === 'easeTo');
    expect(eases.length).toBe(6);
    const last = eases.at(-1)!;
    // Nothing else moved the map on the way, and nothing cut the last one short.
    const firstEase = eases[0]!;
    const end = seen.find((c) => c.name === 'moveend' && c.at > last.at + MAP_MS - 60)!;
    expect(seen.filter((c) => c.name === 'panBy' && c.at > firstEase.at && c.at < end.at)).toEqual([]);
    expect(end.center![0]).toBeCloseTo(last.center![0], 3);
    expect(end.center![1]).toBeCloseTo(last.center![1], 3);
  });

  /** A nudge is under way, and a new truck is chosen: the old nudge does not go on. */
  test('a new selection while the last popup is being nudged: the nudge stops there', async ({ page }) => {
    await openSpread(page, farApart);
    await selectAndLand(page, 3);
    await clearCalls(page);
    // Truck 103's tall popup is nudged as it lands.
    await page.locator('[data-row-id]').nth(0).click();
    await page.waitForFunction(
      () => (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'panBy'),
      undefined,
      { polling: 'raf' },
    );
    await page.locator('[data-row-id]').nth(9).evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(MAP_MS + 400);
    const seen = await calls(page);
    const last = seen.filter((c) => c.name === 'easeTo').at(-1)!;
    const end = seen.find((c) => c.name === 'moveend' && c.at > last.at + MAP_MS - 60)!;
    expect(seen.filter((c) => c.name === 'panBy' && c.at > last.at && c.at < end.at)).toEqual([]);
    expect(end.center![0]).toBeCloseTo(last.center![0], 3);
    expect(end.center![1]).toBeCloseTo(last.center![1], 3);
  });

  test('a press on the map stops it there, and a drag is left alone', async ({ page }) => {
    await openSpread(page, farApart);
    await selectAndLand(page, 3);
    // Zoomed in, where the map is flat: at the fleet's zoom Mapbox draws a globe, and a far
    // truck's popup never leaves it.
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.waitForTimeout(ZOOM_MS + 80);
    }
    await quiet(page);
    const map = (await page.locator('.mapboxgl-map').boundingBox())!;
    const spot = { x: map.x + 40, y: map.y + map.height - 80 };
    await page.mouse.move(spot.x, spot.y);
    await clearCalls(page);

    await page.locator('[data-row-id]').nth(9).evaluate((el) => (el as HTMLElement).click());
    // Early in a long pan, with the new truck's popup still off the map: the case in which
    // the landing, if it were still armed, would nudge the map under the press.
    await page.waitForFunction(
      () => {
        const popup = document.querySelector('.ft-popup')?.getBoundingClientRect();
        const box = document.querySelector('.mapboxgl-map')?.getBoundingClientRect();
        return Boolean(popup && box && popup.right > box.right + 40);
      },
      undefined,
      { polling: 'raf' },
    );
    await page.mouse.down();
    const stopped = await calls(page);
    expect(stopped.map((c) => c.name)).toContain('stop');
    const held = await page.locator('.ft-popup .mapboxgl-popup-tip').boundingBox();
    await page.waitForTimeout(MAP_MS);
    expect(await page.locator('.ft-popup .mapboxgl-popup-tip').boundingBox()).toEqual(held);

    // The same press as a drag: the popup follows the pointer, and nothing fights it.
    await page.mouse.move(spot.x + 30, spot.y - 20, { steps: 4 });
    await page.mouse.move(spot.x + 60, spot.y - 40, { steps: 4 });
    await page.waitForTimeout(300);
    expect((await calls(page)).filter((c) => c.name === 'panBy')).toEqual([]);
    await page.mouse.up();
  });

  test('under reduced motion it jumps', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSpread(page);
    await selectAndLand(page, 3);
    await clearCalls(page);
    await page.locator('[data-row-id]').nth(9).click();
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'easeTo'))).toBe(true);
    expect((await calls(page)).find((c) => c.name === 'easeTo')!.duration).toBe(0);
  });
});

test.describe('step 6, the popup after a long pan', () => {
  const CENTRE = { lat: 39.5, lng: -95.5 };
  const PLACES = {
    'top-right': { dLat: 10, dLng: 9.5 },
    top: { dLat: 6, dLng: 0 },
    right: { dLat: 0, dLng: 12 },
    bottom: { dLat: -6, dLng: 0 },
    left: { dLat: 0, dLng: -12 },
    'bottom-right': { dLat: -10, dLng: 9.5 },
  } as const;

  for (const [place, { dLat, dLng }] of Object.entries(PLACES)) {
    test(`a truck far off to the ${place}: clear of every edge and control once it lands`, async ({ page }) => {
      await resetWorld();
      const sql = connect();
      try {
        const at = (truckId: string, lat: number, lng: number) => sql`
          insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
          values (${truckId}, ${lat}, ${lng}, null, 0, ${new Date()}, ${'Somewhere, KS'})`;
        await at(IDS.truckChicago, CENTRE.lat + dLat, CENTRE.lng + dLng);
        await at(IDS.truckDallas, CENTRE.lat, CENTRE.lng);
        await at(IDS.truckAtZipStop, CENTRE.lat, CENTRE.lng);
      } finally {
        await sql.end({ timeout: 5 });
      }
      await page.goto('/');
      await page.locator(`[data-row-id="${IDS.truckDallas}"]`).click();
      await expect(page.locator('.ft-popup')).toBeVisible();
      await page.waitForTimeout(MAP_MS + 300);
      await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();

      const clear = async () => {
        const popup = (await page.locator('.ft-popup').boundingBox())!;
        const map = (await page.locator('.mapboxgl-map').boundingBox())!;
        const controls = await Promise.all(
          [
            page.getByRole('group', { name: 'Basemap' }),
            page.getByRole('button', { name: 'Zoom in' }).locator('xpath=..'),
            page.getByText('Marker key', { exact: true }).locator('xpath=..'),
          ].map((c) => c.boundingBox()),
        );
        const under = controls.filter(
          (b) =>
            b &&
            popup.x < b.x + b.width &&
            b.x < popup.x + popup.width &&
            popup.y < b.y + b.height &&
            b.y < popup.y + popup.height,
        ).length;
        return {
          inside:
            popup.x >= map.x - 1 &&
            popup.y >= map.y - 1 &&
            popup.x + popup.width <= map.x + map.width + 1 &&
            popup.y + popup.height <= map.y + map.height + 1,
          under,
        };
      };
      await expect.poll(clear, { timeout: 10_000 }).toEqual({ inside: true, under: 0 });
    });
  }
});
